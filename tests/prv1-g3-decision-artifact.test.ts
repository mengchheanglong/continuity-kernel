/**
 * PRV1 G3 — decision artifact distinct from canonical execution receipt.
 * Throwaway schema/runtime spike; not production authz.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  applyUntrustedRationale,
  attestedDigestOf,
  computeLinkHash,
  createConfirmationResponseInput,
  createDelegationHopInput,
  createRefusalArtifactInput,
  DecisionArtifactLedger,
  ExecutionReceiptStore,
  type AttestedFields,
  type CanonicalExecutionReceipt,
  type DecisionArtifact,
  type Principal,
  type ProvenanceLink,
} from "./prv1-g3-model.js";

const INVOCATION = "inv:prv1-g3:tool-call-001";
const ACTION = "transfer_synthetic_units";
const RESOURCE = "resource:synthetic:acct-9";

const agentPrincipal: Principal = {
  kind: "agent-auth",
  id: "agent:worker-a",
  authSource: "agent-runtime-token",
};

const userPrincipal: Principal = {
  kind: "user-auth",
  id: "user:owner-1",
  authSource: "user-session",
};

const childAgent: Principal = {
  kind: "agent-auth",
  id: "agent:delegate-b",
  authSource: "delegation-grant",
};

function receiptFixture(): CanonicalExecutionReceipt {
  return {
    receiptId: "rcpt:prv1-g3:001",
    requestHash: createHash("sha256").update(INVOCATION).digest("base64url"),
    status: "accepted",
    caseVersion: "4",
    projectionDigest: "proj:synthetic:digest",
    recordedAt: "2026-07-15T12:00:00.000Z",
  };
}

function buildLink(args: {
  sequence: number;
  artifactId: string;
  prevArtifactId: string | null;
  prevLinkHash: string | null;
  attested: AttestedFields;
}): ProvenanceLink {
  const base = {
    sequence: args.sequence,
    artifactId: args.artifactId,
    prevArtifactId: args.prevArtifactId,
    prevLinkHash: args.prevLinkHash,
    attestedDigest: attestedDigestOf(args.attested),
  };
  return {
    ...base,
    linkHash: computeLinkHash(base),
  };
}

/** Cryptographically self-consistent sequence-0 genesis for import schema tests. */
function selfConsistentGenesis(
  kind: DecisionArtifact["kind"],
  attested: AttestedFields,
  artifactId: string,
): DecisionArtifact {
  const tipBase = {
    sequence: 0,
    artifactId,
    prevArtifactId: null as string | null,
    prevLinkHash: null as string | null,
    attestedDigest: attestedDigestOf(attested),
  };
  return {
    artifactId,
    sequence: 0,
    kind,
    attested,
    provenance: [
      {
        ...tipBase,
        linkHash: computeLinkHash(tipBase),
      },
    ],
    recordedAt: "2026-07-15T12:00:04.000Z",
  };
}

describe("PRV1 G3 decision artifact vs canonical execution receipt", () => {
  it("keeps DecisionArtifact append-only and separate from CanonicalExecutionReceipt", () => {
    const ledger = new DecisionArtifactLedger();
    const receipts = new ExecutionReceiptStore();

    const refusalInput = createRefusalArtifactInput({
      invocationHash: INVOCATION,
      principal: agentPrincipal,
      rule: { id: "rule:deny-unconfirmed-transfer", source: "policy://synthetic/v1#R12" },
      actionType: ACTION,
      resourceRef: RESOURCE,
      rationale: "model thinks risk is high",
    });
    const artifact = ledger.append(refusalInput);
    const receipt = receiptFixture();
    receipts.put(receipt);

    expect(artifact.kind).toBe("refusal");
    expect(artifact.attested.rule).toEqual({
      id: "rule:deny-unconfirmed-transfer",
      source: "policy://synthetic/v1#R12",
    });
    expect(receipts.get(receipt.receiptId)).toEqual(receipt);
    expect(receipts.isDecisionArtifact(artifact)).toBe(true);
    expect(receipts.isDecisionArtifact(receipt)).toBe(false);
    // Distinct stores: receipt id is not an artifact id sequence authority.
    expect(ledger.list()).toHaveLength(1);
    expect(ledger.list()[0]?.artifactId).not.toBe(receipt.receiptId);
    expect(ledger.validateChain()).toEqual({ ok: true });
  });

  it("records refusal rule + source on the decision artifact", () => {
    const ledger = new DecisionArtifactLedger();
    const input = createRefusalArtifactInput({
      invocationHash: INVOCATION,
      principal: agentPrincipal,
      rule: { id: "rule:block-pii-exfil", source: "docs/policy.md#pii" },
      actionType: ACTION,
      resourceRef: RESOURCE,
    });
    const artifact = ledger.append(input);
    expect(artifact.attested.rule?.id).toBe("rule:block-pii-exfil");
    expect(artifact.attested.rule?.source).toBe("docs/policy.md#pii");
    expect(artifact.kind).toBe("refusal");
  });

  it("binds confirmation approve/deny payload to the original invocation", () => {
    const ledger = new DecisionArtifactLedger();
    const approve = createConfirmationResponseInput({
      invocationHash: INVOCATION,
      principal: userPrincipal,
      decision: "approve",
      detail: { note: "owner approved synthetic transfer" },
      actionType: ACTION,
      resourceRef: RESOURCE,
    });
    const approveArt = ledger.append(approve);
    expect(approveArt.attested.confirmation?.decision).toBe("approve");
    expect(approveArt.attested.confirmation?.boundInvocationHash).toBe(INVOCATION);
    expect(approveArt.attested.principal.kind).toBe("user-auth");

    const deny = createConfirmationResponseInput({
      invocationHash: INVOCATION,
      principal: userPrincipal,
      decision: "deny",
      detail: { note: "owner denied" },
      actionType: ACTION,
      resourceRef: RESOURCE,
    });
    const denyArt = ledger.append(deny);
    expect(denyArt.attested.confirmation?.decision).toBe("deny");
    expect(denyArt.attested.confirmation?.boundInvocationHash).toBe(INVOCATION);

    const broken = createConfirmationResponseInput({
      invocationHash: INVOCATION,
      principal: userPrincipal,
      decision: "approve",
      detail: { note: "tampered binding" },
      actionType: ACTION,
      resourceRef: RESOURCE,
      boundInvocationHashOverride: "inv:other",
    });
    // Builder may produce the broken attested payload; ledger must reject append/import.
    const imported = ledger.tryImportArtifact({
      artifactId: "art:forced-broken",
      sequence: 99,
      kind: "confirmation_response",
      attested: broken.attested,
      provenance: [],
      recordedAt: "2026-07-15T12:00:01.000Z",
    });
    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      expect(imported.code).toBe("CONFIRMATION_BINDING_MISMATCH");
    }
  });

  it("distinguishes agent-auth and user-auth principals", () => {
    const ledger = new DecisionArtifactLedger();
    const agentArt = ledger.append(
      createRefusalArtifactInput({
        invocationHash: INVOCATION,
        principal: agentPrincipal,
        rule: { id: "rule:x", source: "src:x" },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    const userArt = ledger.append(
      createConfirmationResponseInput({
        invocationHash: INVOCATION,
        principal: userPrincipal,
        decision: "approve",
        detail: {},
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    expect(agentArt.attested.principal.kind).toBe("agent-auth");
    expect(agentArt.attested.principal.authSource).toBe("agent-runtime-token");
    expect(userArt.attested.principal.kind).toBe("user-auth");
    expect(userArt.attested.principal.authSource).toBe("user-session");
  });

  it("records multi-hop delegation with governing principal each hop", () => {
    const ledger = new DecisionArtifactLedger();
    const hop0 = ledger.append(
      createDelegationHopInput({
        invocationHash: INVOCATION,
        hop: {
          hopIndex: 0,
          from: userPrincipal,
          to: agentPrincipal,
          governingPrincipal: userPrincipal,
        },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    const hop1 = ledger.append(
      createDelegationHopInput({
        invocationHash: INVOCATION,
        hop: {
          hopIndex: 1,
          from: agentPrincipal,
          to: childAgent,
          governingPrincipal: userPrincipal,
        },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );

    expect(hop0.attested.delegation?.hopIndex).toBe(0);
    expect(hop0.attested.delegation?.governingPrincipal).toEqual(userPrincipal);
    expect(hop1.attested.delegation?.hopIndex).toBe(1);
    expect(hop1.attested.delegation?.governingPrincipal.id).toBe("user:owner-1");
    expect(hop1.attested.delegation?.to.id).toBe("agent:delegate-b");
    // Continuity: contiguous hop indices and next.from equals prior.to.
    expect(hop1.attested.delegation?.from).toEqual(hop0.attested.delegation?.to);
    expect(hop0.attested.delegation?.governingPrincipal).toBeDefined();
    expect(hop1.attested.delegation?.governingPrincipal).toBeDefined();
    expect(ledger.validateChain()).toEqual({ ok: true });
  });

  it("fails closed on mismatched delegation hop continuity", () => {
    const ledger = new DecisionArtifactLedger();
    ledger.append(
      createDelegationHopInput({
        invocationHash: INVOCATION,
        hop: {
          hopIndex: 0,
          from: userPrincipal,
          to: agentPrincipal,
          governingPrincipal: userPrincipal,
        },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    // from skips prior.to — continuity break must fail closed.
    expect(() =>
      ledger.append(
        createDelegationHopInput({
          invocationHash: INVOCATION,
          hop: {
            hopIndex: 1,
            from: childAgent,
            to: agentPrincipal,
            governingPrincipal: userPrincipal,
          },
          actionType: ACTION,
          resourceRef: RESOURCE,
        }),
      ),
    ).toThrow(/DELEGATION_HOP_MISMATCH/);
  });

  /**
   * Bounded spike policy (non-claim): for one originalInvocationHash, every
   * delegation hop must keep the exact same governing Principal
   * (kind,id,authSource) as hop0. Silent governor change is rejected with
   * DELEGATION_HOP_MISMATCH. A real authority transfer would need a future
   * explicit authority-transition artifact — not modeled/allowed here.
   * This is synthetic continuity ergonomics only, not production authz.
   */
  it("fails closed when hop1 governing principal is non-empty but differs from hop0", () => {
    const ledger = new DecisionArtifactLedger();
    ledger.append(
      createDelegationHopInput({
        invocationHash: INVOCATION,
        hop: {
          hopIndex: 0,
          from: userPrincipal,
          to: agentPrincipal,
          governingPrincipal: userPrincipal,
        },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    const otherGovernor: Principal = {
      kind: "user-auth",
      id: "user:other-owner",
      authSource: "user-session-other",
    };
    // from/to continuity is intact; only governing principal changes.
    expect(() =>
      ledger.append(
        createDelegationHopInput({
          invocationHash: INVOCATION,
          hop: {
            hopIndex: 1,
            from: agentPrincipal,
            to: childAgent,
            governingPrincipal: otherGovernor,
          },
          actionType: ACTION,
          resourceRef: RESOURCE,
        }),
      ),
    ).toThrow(/DELEGATION_HOP_MISMATCH/);
  });

  /**
   * Import path must re-run delegation continuity against
   * [...existing ledger artifacts, candidate] after confirmation + provenance
   * validation — not only malformed-hash shortcuts.
   */
  /**
   * Nonempty ledger must reject a cryptographically self-consistent fresh
   * sequence-0 genesis. Failure must be lineage (prefix/tip attach to ledger),
   * not merely self-chain hash failure or a later unrelated code.
   */
  it("tryImportArtifact fails lineage on valid-hash fresh sequence-0 genesis when ledger is nonempty", () => {
    const ledger = new DecisionArtifactLedger();
    ledger.append(
      createRefusalArtifactInput({
        invocationHash: INVOCATION,
        principal: agentPrincipal,
        rule: { id: "rule:existing", source: "src:existing" },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    expect(ledger.list()).toHaveLength(1);

    const genesisAttested = createRefusalArtifactInput({
      invocationHash: INVOCATION,
      principal: agentPrincipal,
      rule: { id: "rule:fresh-genesis", source: "src:fresh" },
      actionType: ACTION,
      resourceRef: RESOURCE,
    }).attested;
    const genesisId = "art:fresh-genesis-import";
    const tipBase = {
      sequence: 0,
      artifactId: genesisId,
      prevArtifactId: null as string | null,
      prevLinkHash: null as string | null,
      attestedDigest: attestedDigestOf(genesisAttested),
    };
    const tipLink: ProvenanceLink = {
      ...tipBase,
      linkHash: computeLinkHash(tipBase),
    };
    // Self-chain is valid (genesis, null preds, recomputed linkHash + tip digest).
    // Import must still fail because the ledger is already nonempty.
    const candidate: DecisionArtifact = {
      artifactId: genesisId,
      sequence: 0,
      kind: "refusal",
      attested: genesisAttested,
      provenance: [tipLink],
      recordedAt: "2026-07-15T12:00:03.000Z",
    };

    const result = ledger.tryImportArtifact(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Lineage attach to existing tip — not self-hash failure alone.
      expect(result.code).toBe("TAMPERED_PROVENANCE");
      expect(result.message).toMatch(/lineage|ledger|prefix|sequence|import/i);
    }
  });

  it("tryImportArtifact fails DELEGATION_HOP_MISMATCH on valid-hash imported hop with continuity break", () => {
    const ledger = new DecisionArtifactLedger();
    const hop0 = ledger.append(
      createDelegationHopInput({
        invocationHash: INVOCATION,
        hop: {
          hopIndex: 0,
          from: userPrincipal,
          to: agentPrincipal,
          governingPrincipal: userPrincipal,
        },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );

    const otherGovernor: Principal = {
      kind: "user-auth",
      id: "user:other-owner",
      authSource: "user-session-other",
    };
    // Valid from/to adjacency; only governing principal differs from hop0.
    const hop1Attested: AttestedFields = {
      originalInvocationHash: INVOCATION,
      actionType: ACTION,
      resourceRef: RESOURCE,
      principal: { ...otherGovernor },
      delegation: {
        hopIndex: 1,
        from: agentPrincipal,
        to: childAgent,
        governingPrincipal: otherGovernor,
      },
    };

    const prevTip = hop0.provenance[hop0.provenance.length - 1];
    if (prevTip === undefined) {
      throw new Error("expected hop0 provenance tip");
    }
    const candidateId = "art:imported-hop1-gov-mismatch";
    const tipBase = {
      sequence: hop0.sequence + 1,
      artifactId: candidateId,
      prevArtifactId: hop0.artifactId,
      prevLinkHash: prevTip.linkHash,
      attestedDigest: attestedDigestOf(hop1Attested),
    };
    const tipLink: ProvenanceLink = {
      ...tipBase,
      linkHash: computeLinkHash(tipBase),
    };
    // Provenance is cryptographically self-consistent and lineage-valid against
    // the ledger tip; failure must come from delegation continuity, not
    // TAMPERED_PROVENANCE / MISSING_*.
    const candidate: DecisionArtifact = {
      artifactId: candidateId,
      sequence: hop0.sequence + 1,
      kind: "delegation_hop",
      attested: hop1Attested,
      provenance: [...hop0.provenance, tipLink],
      recordedAt: "2026-07-15T12:00:02.000Z",
    };

    const result = ledger.tryImportArtifact(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DELEGATION_HOP_MISMATCH");
    }
  });

  it("fails closed on tampered, missing, reordered, and cyclic provenance", () => {
    const ledger = new DecisionArtifactLedger();
    const a = ledger.append(
      createRefusalArtifactInput({
        invocationHash: INVOCATION,
        principal: agentPrincipal,
        rule: { id: "rule:a", source: "src:a" },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    const b = ledger.append(
      createDelegationHopInput({
        invocationHash: INVOCATION,
        hop: {
          hopIndex: 0,
          from: userPrincipal,
          to: agentPrincipal,
          governingPrincipal: userPrincipal,
        },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    expect(ledger.validateChain()).toEqual({ ok: true });

    // Missing provenance
    const missing: DecisionArtifact = {
      ...b,
      artifactId: "art:missing-prov",
      sequence: 99,
      provenance: [],
    };
    const missingResult = ledger.tryImportArtifact(missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.code).toBe("MISSING_PROVENANCE");

    // Tampered tip link hash
    const tipLink = b.provenance[b.provenance.length - 1];
    if (tipLink === undefined) {
      throw new Error("expected provenance tip");
    }
    const tamperedLink = {
      ...tipLink,
      linkHash: "tampered-hash",
    };
    const tampered: DecisionArtifact = {
      ...b,
      artifactId: "art:tampered",
      sequence: 100,
      provenance: [...b.provenance.slice(0, -1), tamperedLink],
    };
    const tamperedResult = ledger.tryImportArtifact(tampered);
    expect(tamperedResult.ok).toBe(false);
    if (!tamperedResult.ok) expect(tamperedResult.code).toBe("TAMPERED_PROVENANCE");

    // Reordered provenance sequences
    const reordered: DecisionArtifact = {
      ...b,
      artifactId: "art:reordered",
      sequence: 101,
      provenance: [...b.provenance].reverse(),
    };
    const reorderedResult = ledger.tryImportArtifact(reordered);
    expect(reorderedResult.ok).toBe(false);
    // Reverse order fails closed: non-genesis first link is MISSING_PREFIX;
    // non-contiguous sequences after a valid genesis are REORDERED_PROVENANCE.
    if (!reorderedResult.ok) {
      expect(["REORDERED_PROVENANCE", "MISSING_PREFIX"]).toContain(reorderedResult.code);
    }

    // Cyclic provenance: points previous to self
    const cyclicAttested = a.attested;
    const cyclicLink = buildLink({
      sequence: 0,
      artifactId: "art:cyclic",
      prevArtifactId: "art:cyclic",
      prevLinkHash: null,
      attested: cyclicAttested,
    });
    // Force self-ref even if builder refuses prev === id (hash material still includes it).
    cyclicLink.prevArtifactId = "art:cyclic";
    cyclicLink.linkHash = computeLinkHash({
      sequence: cyclicLink.sequence,
      artifactId: cyclicLink.artifactId,
      prevArtifactId: cyclicLink.prevArtifactId,
      prevLinkHash: cyclicLink.prevLinkHash,
      attestedDigest: cyclicLink.attestedDigest,
    });
    const cyclic: DecisionArtifact = {
      ...a,
      artifactId: "art:cyclic",
      sequence: 0,
      provenance: [cyclicLink],
    };
    const cyclicResult = ledger.tryImportArtifact(cyclic);
    expect(cyclicResult.ok).toBe(false);
    if (!cyclicResult.ok) expect(cyclicResult.code).toBe("CYCLIC_PROVENANCE");
  });

  it("fails closed on intermediate historical link hash/pointer tamper", () => {
    const ledger = new DecisionArtifactLedger();
    ledger.append(
      createRefusalArtifactInput({
        invocationHash: INVOCATION,
        principal: agentPrincipal,
        rule: { id: "rule:a", source: "src:a" },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    const b = ledger.append(
      createDelegationHopInput({
        invocationHash: INVOCATION,
        hop: {
          hopIndex: 0,
          from: userPrincipal,
          to: agentPrincipal,
          governingPrincipal: userPrincipal,
        },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    expect(b.provenance.length).toBeGreaterThanOrEqual(2);

    // Tamper only the historical (non-tip) linkHash; tip remains self-consistent alone.
    const hist = b.provenance[0];
    const originalTip = b.provenance[1];
    if (hist === undefined || originalTip === undefined) {
      throw new Error("expected two-link provenance for intermediate tamper");
    }
    const tamperedHist: ProvenanceLink = {
      ...hist,
      sequence: 0,
      linkHash: "tampered-historical-link-hash",
    };
    const tipLinkBase = {
      sequence: 1,
      artifactId: originalTip.artifactId,
      prevArtifactId: tamperedHist.artifactId,
      // Keep declared prevLinkHash pointing at original so only intermediate fails.
      prevLinkHash: hist.linkHash,
      attestedDigest: attestedDigestOf(b.attested),
    };
    const tipLink: ProvenanceLink = {
      ...tipLinkBase,
      linkHash: computeLinkHash(tipLinkBase),
    };
    const histTampered: DecisionArtifact = {
      ...b,
      artifactId: tipLink.artifactId,
      sequence: 1,
      provenance: [tamperedHist, tipLink],
    };

    const hashTamper = ledger.tryImportArtifact(histTampered);
    expect(hashTamper.ok).toBe(false);
    if (!hashTamper.ok) expect(hashTamper.code).toBe("TAMPERED_PROVENANCE");

    // Pointer tamper: break adjacency on intermediate prevArtifactId while recomputing tip.
    const pointerTampered: DecisionArtifact = {
      ...b,
      artifactId: b.artifactId,
      sequence: b.sequence,
      provenance: b.provenance.map((link, i) => {
        if (i === 0) return { ...link };
        if (i === b.provenance.length - 1) {
          const next = {
            ...link,
            prevArtifactId: "art:not-adjacent",
          };
          return {
            ...next,
            linkHash: computeLinkHash({
              sequence: next.sequence,
              artifactId: next.artifactId,
              prevArtifactId: next.prevArtifactId,
              prevLinkHash: next.prevLinkHash,
              attestedDigest: next.attestedDigest,
            }),
          };
        }
        return { ...link };
      }),
    };
    const pointerResult = ledger.tryImportArtifact(pointerTampered);
    expect(pointerResult.ok).toBe(false);
    if (!pointerResult.ok) {
      expect(["TAMPERED_PROVENANCE", "CYCLIC_PROVENANCE"]).toContain(pointerResult.code);
    }
  });

  it("fails closed on missing provenance prefix", () => {
    const ledger = new DecisionArtifactLedger();
    const a = ledger.append(
      createRefusalArtifactInput({
        invocationHash: INVOCATION,
        principal: agentPrincipal,
        rule: { id: "rule:a", source: "src:a" },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    const b = ledger.append(
      createDelegationHopInput({
        invocationHash: INVOCATION,
        hop: {
          hopIndex: 0,
          from: userPrincipal,
          to: agentPrincipal,
          governingPrincipal: userPrincipal,
        },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    void a;

    // Drop genesis; keep only tip.
    const tipOnly = b.provenance[b.provenance.length - 1];
    if (tipOnly === undefined) throw new Error("expected tip");
    const missingPrefix: DecisionArtifact = {
      ...b,
      artifactId: "art:missing-prefix",
      sequence: tipOnly.sequence,
      provenance: [
        {
          ...tipOnly,
          artifactId: "art:missing-prefix",
          attestedDigest: attestedDigestOf(b.attested),
          linkHash: computeLinkHash({
            sequence: tipOnly.sequence,
            artifactId: "art:missing-prefix",
            prevArtifactId: tipOnly.prevArtifactId,
            prevLinkHash: tipOnly.prevLinkHash,
            attestedDigest: attestedDigestOf(b.attested),
          }),
        },
      ],
    };
    const result = ledger.tryImportArtifact(missingPrefix);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["MISSING_PREFIX", "REORDERED_PROVENANCE", "MISSING_PROVENANCE"]).toContain(
        result.code,
      );
    }
  });

  it("fails closed on forward-reference / general cycle", () => {
    const ledger = new DecisionArtifactLedger();
    const tipAttested = createRefusalArtifactInput({
      invocationHash: INVOCATION,
      principal: agentPrincipal,
      rule: { id: "rule:tip", source: "src:tip" },
      actionType: ACTION,
      resourceRef: RESOURCE,
    }).attested;
    const midAttested = createRefusalArtifactInput({
      invocationHash: INVOCATION,
      principal: agentPrincipal,
      rule: { id: "rule:mid", source: "src:mid" },
      actionType: ACTION,
      resourceRef: RESOURCE,
    }).attested;
    const genAttested = createRefusalArtifactInput({
      invocationHash: INVOCATION,
      principal: agentPrincipal,
      rule: { id: "rule:gen", source: "src:gen" },
      actionType: ACTION,
      resourceRef: RESOURCE,
    }).attested;

    const genesisId = "art:gen";
    const midId = "art:mid";
    const tipId = "art:tip-forward";

    const link0 = buildLink({
      sequence: 0,
      artifactId: genesisId,
      prevArtifactId: null,
      prevLinkHash: null,
      attested: genAttested,
    });
    // Forward reference: mid.prev points at tip (later node).
    const link1Base = {
      sequence: 1,
      artifactId: midId,
      prevArtifactId: tipId,
      prevLinkHash: link0.linkHash,
      attestedDigest: attestedDigestOf(midAttested),
    };
    const link1: ProvenanceLink = {
      ...link1Base,
      linkHash: computeLinkHash(link1Base),
    };
    const link2Base = {
      sequence: 2,
      artifactId: tipId,
      prevArtifactId: midId,
      prevLinkHash: link1.linkHash,
      attestedDigest: attestedDigestOf(tipAttested),
    };
    const link2: ProvenanceLink = {
      ...link2Base,
      linkHash: computeLinkHash(link2Base),
    };

    const forward: DecisionArtifact = {
      artifactId: tipId,
      sequence: 2,
      kind: "refusal",
      attested: tipAttested,
      provenance: [link0, link1, link2],
      recordedAt: "2026-07-15T12:00:00.000Z",
    };
    const result = ledger.tryImportArtifact(forward);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["CYCLIC_PROVENANCE", "TAMPERED_PROVENANCE"]).toContain(result.code);
    }
  });

  it("untrusted rationale cannot mutate attested fields", () => {
    const ledger = new DecisionArtifactLedger();
    const base = ledger.append(
      createRefusalArtifactInput({
        invocationHash: INVOCATION,
        principal: agentPrincipal,
        rule: { id: "rule:stable", source: "src:stable" },
        actionType: ACTION,
        resourceRef: RESOURCE,
        rationale: "initial rationale",
      }),
    );

    const patch: Partial<AttestedFields> = {
      originalInvocationHash: "inv:mutated",
      actionType: "mutated_action",
      rule: { id: "rule:evil", source: "src:evil" },
    };
    const { artifact, validation } = applyUntrustedRationale(
      base,
      "attacker rationale trying to rewrite attested authority",
      patch,
    );

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.code).toBe("RATIONALE_MUTATION_ATTEMPT");
    }
    // Attested fields remain the original sealed values.
    expect(artifact.attested.originalInvocationHash).toBe(INVOCATION);
    expect(artifact.attested.actionType).toBe(ACTION);
    expect(artifact.attested.rule).toEqual({ id: "rule:stable", source: "src:stable" });
    // Rationale may update as untrusted text only.
    expect(artifact.untrustedRationale).toBe(
      "attacker rationale trying to rewrite attested authority",
    );
  });

  it("chain verification recomputes every link and tip attested digest", () => {
    const ledger = new DecisionArtifactLedger();
    const a = ledger.append(
      createRefusalArtifactInput({
        invocationHash: INVOCATION,
        principal: agentPrincipal,
        rule: { id: "rule:a", source: "src:a" },
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );
    const b = ledger.append(
      createConfirmationResponseInput({
        invocationHash: INVOCATION,
        principal: userPrincipal,
        decision: "approve",
        detail: {},
        actionType: ACTION,
        resourceRef: RESOURCE,
      }),
    );

    expect(a.provenance).toHaveLength(1);
    expect(b.provenance).toHaveLength(2);
    expect(a.provenance[0]?.sequence).toBe(0);
    expect(a.provenance[0]?.prevArtifactId).toBeNull();
    expect(a.provenance[0]?.prevLinkHash).toBeNull();
    expect(b.provenance[1]?.prevArtifactId).toBe(a.artifactId);
    expect(b.provenance[1]?.prevLinkHash).toBe(a.provenance[0]?.linkHash);
    expect(b.provenance[1]?.attestedDigest).toBe(attestedDigestOf(b.attested));

    for (const link of b.provenance) {
      expect(link.linkHash).toBe(
        computeLinkHash({
          sequence: link.sequence,
          artifactId: link.artifactId,
          prevArtifactId: link.prevArtifactId,
          prevLinkHash: link.prevLinkHash,
          attestedDigest: link.attestedDigest,
        }),
      );
    }
    expect(ledger.validateChain()).toEqual({ ok: true });
  });

  /**
   * Schema gate (G3 remediation): tryImport must validate kind-specific attested
   * shape before provenance/lineage. Self-consistent hashes alone must not accept
   * malformed kind payloads (exact blocker: delegation_hop without delegation).
   */
  it("tryImportArtifact fails INVALID_DECISION_ARTIFACT when delegation_hop lacks delegation", () => {
    const ledger = new DecisionArtifactLedger();
    // Common fields valid; hashes self-consistent; only missing delegation.
    const attested: AttestedFields = {
      originalInvocationHash: INVOCATION,
      actionType: ACTION,
      resourceRef: RESOURCE,
      principal: { ...userPrincipal },
    };
    const candidate = selfConsistentGenesis(
      "delegation_hop",
      attested,
      "art:import-missing-delegation",
    );
    const result = ledger.tryImportArtifact(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_DECISION_ARTIFACT");
    }
  });

  it("tryImportArtifact fails INVALID_DECISION_ARTIFACT when refusal lacks rule", () => {
    const ledger = new DecisionArtifactLedger();
    const attested: AttestedFields = {
      originalInvocationHash: INVOCATION,
      actionType: ACTION,
      resourceRef: RESOURCE,
      principal: { ...agentPrincipal },
    };
    const candidate = selfConsistentGenesis(
      "refusal",
      attested,
      "art:import-refusal-missing-rule",
    );
    const result = ledger.tryImportArtifact(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_DECISION_ARTIFACT");
    }
  });

  it("tryImportArtifact fails INVALID_DECISION_ARTIFACT when confirmation is missing or decision is invalid", () => {
    const ledger = new DecisionArtifactLedger();

    const missingConfirmation = selfConsistentGenesis(
      "confirmation_response",
      {
        originalInvocationHash: INVOCATION,
        actionType: ACTION,
        resourceRef: RESOURCE,
        principal: { ...userPrincipal },
      },
      "art:import-conf-missing",
    );
    const missingResult = ledger.tryImportArtifact(missingConfirmation);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.code).toBe("INVALID_DECISION_ARTIFACT");
    }

    const invalidDecisionAttested: AttestedFields = {
      originalInvocationHash: INVOCATION,
      actionType: ACTION,
      resourceRef: RESOURCE,
      principal: { ...userPrincipal },
      confirmation: {
        // Force an invalid decision string past the type system.
        decision: "maybe" as "approve",
        boundInvocationHash: INVOCATION,
        detail: { note: "not a real decision" },
      },
    };
    const invalidDecision = selfConsistentGenesis(
      "confirmation_response",
      invalidDecisionAttested,
      "art:import-conf-invalid-decision",
    );
    const invalidResult = ledger.tryImportArtifact(invalidDecision);
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) {
      expect(invalidResult.code).toBe("INVALID_DECISION_ARTIFACT");
    }
  });

  it("tryImportArtifact fails INVALID_DECISION_ARTIFACT on malformed principal or principal/governor mismatch", () => {
    const ledger = new DecisionArtifactLedger();

    const malformedPrincipal = selfConsistentGenesis(
      "refusal",
      {
        originalInvocationHash: INVOCATION,
        actionType: ACTION,
        resourceRef: RESOURCE,
        principal: {
          kind: "agent-auth",
          id: "",
          authSource: "agent-runtime-token",
        },
        rule: { id: "rule:x", source: "src:x" },
      },
      "art:import-malformed-principal",
    );
    const malformedResult = ledger.tryImportArtifact(malformedPrincipal);
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) {
      expect(malformedResult.code).toBe("INVALID_DECISION_ARTIFACT");
    }

    // Self-consistent hop0 with valid principals, but attested.principal !== governor.
    const mismatchAttested: AttestedFields = {
      originalInvocationHash: INVOCATION,
      actionType: ACTION,
      resourceRef: RESOURCE,
      principal: { ...agentPrincipal },
      delegation: {
        hopIndex: 0,
        from: userPrincipal,
        to: agentPrincipal,
        governingPrincipal: userPrincipal,
      },
    };
    const mismatch = selfConsistentGenesis(
      "delegation_hop",
      mismatchAttested,
      "art:import-principal-governor-mismatch",
    );
    const mismatchResult = ledger.tryImportArtifact(mismatch);
    expect(mismatchResult.ok).toBe(false);
    if (!mismatchResult.ok) {
      expect(mismatchResult.code).toBe("INVALID_DECISION_ARTIFACT");
    }
  });
});
