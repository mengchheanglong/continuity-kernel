/**
 * PRV1 G3 — append-only DecisionArtifact distinct from CanonicalExecutionReceipt.
 * Local synthetic schema spike only. Not production security/compliance.
 *
 * Non-claim: link hashes prove structural chain integrity for synthetic verification
 * only. They are NOT authenticity against an attacker who can rewrite and recompute
 * the entire chain (no external signature/trust anchor in this spike).
 */
import { createHash, randomUUID } from "node:crypto";

export type PrincipalKind = "agent-auth" | "user-auth";

export interface Principal {
  kind: PrincipalKind;
  id: string;
  authSource: string;
}

export interface DecisionRule {
  id: string;
  source: string;
}

export interface ConfirmationPayload {
  decision: "approve" | "deny";
  /** Must equal original invocation hash or validation fails closed. */
  boundInvocationHash: string;
  detail: Record<string, unknown>;
}

export interface DelegationHop {
  hopIndex: number;
  from: Principal;
  to: Principal;
  governingPrincipal: Principal;
}

/**
 * Chain-verifiable synthetic provenance link.
 * Contiguous from genesis (sequence 0), exact prevArtifactId adjacency,
 * prevLinkHash chaining, per-link attestedDigest, recomputed linkHash.
 */
export interface ProvenanceLink {
  sequence: number;
  artifactId: string;
  prevArtifactId: string | null;
  prevLinkHash: string | null;
  attestedDigest: string;
  linkHash: string;
}

export type DecisionKind =
  | "refusal"
  | "confirmation_request"
  | "confirmation_response"
  | "authorization"
  | "delegation_hop";

export interface AttestedFields {
  originalInvocationHash: string;
  actionType: string;
  resourceRef: string;
  principal: Principal;
  rule?: DecisionRule;
  confirmation?: ConfirmationPayload;
  delegation?: DelegationHop;
}

export interface DecisionArtifact {
  artifactId: string;
  sequence: number;
  kind: DecisionKind;
  attested: AttestedFields;
  provenance: ProvenanceLink[];
  /** Untrusted model text — must never mutate attested fields. */
  untrustedRationale?: string;
  recordedAt: string;
}

export interface CanonicalExecutionReceipt {
  receiptId: string;
  requestHash: string;
  status: "accepted" | "rejected";
  caseVersion: string;
  projectionDigest: string;
  recordedAt: string;
}

export type ValidationFailureCode =
  | "MISSING_PROVENANCE"
  | "MISSING_PREFIX"
  | "TAMPERED_PROVENANCE"
  | "REORDERED_PROVENANCE"
  | "CYCLIC_PROVENANCE"
  | "CONFIRMATION_BINDING_MISMATCH"
  | "DELEGATION_HOP_MISMATCH"
  | "RATIONALE_MUTATION_ATTEMPT"
  | "INVALID_DECISION_ARTIFACT"
  | "UNKNOWN_ARTIFACT";

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: ValidationFailureCode; message: string };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

export function attestedDigestOf(attested: AttestedFields): string {
  return createHash("sha256").update(stableStringify(attested)).digest("base64url");
}

export function computeLinkHash(link: {
  sequence: number;
  artifactId: string;
  prevArtifactId: string | null;
  prevLinkHash: string | null;
  attestedDigest: string;
}): string {
  return createHash("sha256")
    .update(
      stableStringify({
        sequence: link.sequence,
        artifactId: link.artifactId,
        prevArtifactId: link.prevArtifactId,
        prevLinkHash: link.prevLinkHash,
        attestedDigest: link.attestedDigest,
      }),
    )
    .digest("base64url");
}

/** @deprecated Prefer computeLinkHash; retained for call-site clarity in older notes. */
export function provenanceLinkHash(
  sequence: number,
  artifactId: string,
  prevArtifactId: string | null,
  attestedCanonical: string,
  prevLinkHash: string | null = null,
): string {
  return computeLinkHash({
    sequence,
    artifactId,
    prevArtifactId,
    prevLinkHash,
    attestedDigest: createHash("sha256").update(attestedCanonical).digest("base64url"),
  });
}

function cloneAttested(attested: AttestedFields): AttestedFields {
  return structuredClone(attested);
}

function principalsEqual(a: Principal, b: Principal): boolean {
  return a.kind === b.kind && a.id === b.id && a.authSource === b.authSource;
}

function provenanceLinksEqual(a: ProvenanceLink, b: ProvenanceLink): boolean {
  return (
    a.sequence === b.sequence &&
    a.artifactId === b.artifactId &&
    a.prevArtifactId === b.prevArtifactId &&
    a.prevLinkHash === b.prevLinkHash &&
    a.attestedDigest === b.attestedDigest &&
    a.linkHash === b.linkHash
  );
}

function validateConfirmationBinding(attested: AttestedFields): ValidationResult {
  if (attested.confirmation === undefined) return { ok: true };
  if (attested.confirmation.boundInvocationHash !== attested.originalInvocationHash) {
    return {
      ok: false,
      code: "CONFIRMATION_BINDING_MISMATCH",
      message: "confirmation payload is not bound to original invocation",
    };
  }
  return { ok: true };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidPrincipal(value: unknown): value is Principal {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const principal = value as Record<string, unknown>;
  return (
    (principal.kind === "agent-auth" || principal.kind === "user-auth") &&
    isNonEmptyString(principal.id) &&
    isNonEmptyString(principal.authSource)
  );
}

function invalidDecisionArtifact(message: string): ValidationResult {
  return {
    ok: false,
    code: "INVALID_DECISION_ARTIFACT",
    message,
  };
}

/**
 * Kind-specific attested schema gate. Shared by append and tryImport.
 * Runs before provenance/lineage so self-consistent hashes cannot smuggle
 * malformed kind payloads (e.g. delegation_hop without delegation).
 */
export function validateAttestedForKind(
  kind: DecisionKind,
  attested: AttestedFields,
): ValidationResult {
  if (!isNonEmptyString(attested.originalInvocationHash)) {
    return invalidDecisionArtifact("originalInvocationHash must be a nonempty string");
  }
  if (!isNonEmptyString(attested.actionType)) {
    return invalidDecisionArtifact("actionType must be a nonempty string");
  }
  if (!isNonEmptyString(attested.resourceRef)) {
    return invalidDecisionArtifact("resourceRef must be a nonempty string");
  }
  if (!isValidPrincipal(attested.principal)) {
    return invalidDecisionArtifact(
      "principal must have kind agent-auth|user-auth and nonempty id/authSource",
    );
  }

  switch (kind) {
    case "refusal": {
      if (attested.confirmation !== undefined) {
        return invalidDecisionArtifact("refusal must not include confirmation");
      }
      if (attested.delegation !== undefined) {
        return invalidDecisionArtifact("refusal must not include delegation");
      }
      const rule = attested.rule;
      if (
        rule === undefined ||
        !isNonEmptyString(rule.id) ||
        !isNonEmptyString(rule.source)
      ) {
        return invalidDecisionArtifact(
          "refusal requires rule with nonempty id and source",
        );
      }
      return { ok: true };
    }
    case "confirmation_response": {
      if (attested.rule !== undefined) {
        return invalidDecisionArtifact("confirmation_response must not include rule");
      }
      if (attested.delegation !== undefined) {
        return invalidDecisionArtifact(
          "confirmation_response must not include delegation",
        );
      }
      const confirmation = attested.confirmation;
      if (confirmation === undefined) {
        return invalidDecisionArtifact("confirmation_response requires confirmation");
      }
      // Runtime-shaped view: import path may carry values outside typed unions.
      const runtimeConfirmation = confirmation as {
        decision?: unknown;
        boundInvocationHash?: unknown;
        detail?: unknown;
      };
      if (
        runtimeConfirmation.decision !== "approve" &&
        runtimeConfirmation.decision !== "deny"
      ) {
        return invalidDecisionArtifact(
          "confirmation decision must be exactly approve or deny",
        );
      }
      if (!isNonEmptyString(runtimeConfirmation.boundInvocationHash)) {
        return invalidDecisionArtifact("boundInvocationHash must be a nonempty string");
      }
      // Binding equality remains CONFIRMATION_BINDING_MISMATCH via existing helper.
      if (
        runtimeConfirmation.detail === null ||
        typeof runtimeConfirmation.detail !== "object" ||
        Array.isArray(runtimeConfirmation.detail)
      ) {
        return invalidDecisionArtifact(
          "confirmation detail must be a non-null non-array object",
        );
      }
      return { ok: true };
    }
    case "delegation_hop": {
      if (attested.rule !== undefined) {
        return invalidDecisionArtifact("delegation_hop must not include rule");
      }
      if (attested.confirmation !== undefined) {
        return invalidDecisionArtifact("delegation_hop must not include confirmation");
      }
      const hop = attested.delegation;
      if (hop === undefined) {
        return invalidDecisionArtifact("delegation_hop requires delegation");
      }
      if (
        typeof hop.hopIndex !== "number" ||
        !Number.isInteger(hop.hopIndex) ||
        hop.hopIndex < 0
      ) {
        return invalidDecisionArtifact("hopIndex must be a nonnegative integer");
      }
      if (
        !isValidPrincipal(hop.from) ||
        !isValidPrincipal(hop.to) ||
        !isValidPrincipal(hop.governingPrincipal)
      ) {
        return invalidDecisionArtifact(
          "delegation from/to/governing principals must be valid",
        );
      }
      if (!principalsEqual(attested.principal, hop.governingPrincipal)) {
        return invalidDecisionArtifact(
          "attested.principal must exactly equal governing principal",
        );
      }
      return { ok: true };
    }
    case "confirmation_request":
    case "authorization": {
      // Spike kinds without dedicated payload contracts yet: common fields only.
      // Reject payloads reserved for other kinds to avoid silent cross-kind smuggling.
      if (attested.rule !== undefined) {
        return invalidDecisionArtifact(`${kind} must not include rule`);
      }
      if (attested.confirmation !== undefined) {
        return invalidDecisionArtifact(`${kind} must not include confirmation`);
      }
      if (attested.delegation !== undefined) {
        return invalidDecisionArtifact(`${kind} must not include delegation`);
      }
      return { ok: true };
    }
    default: {
      return invalidDecisionArtifact(`unsupported decision kind: ${String(kind)}`);
    }
  }
}

/**
 * Full chain verification: genesis contiguous sequence, adjacency, prev-link-hash
 * chaining, every link hash, tip attested digest vs current artifact.
 */
export function validateProvenanceChain(artifact: DecisionArtifact): ValidationResult {
  const chain = artifact.provenance;
  if (chain.length === 0) {
    return {
      ok: false,
      code: "MISSING_PROVENANCE",
      message: "provenance chain is empty",
    };
  }

  const genesis = chain[0];
  if (genesis === undefined) {
    return { ok: false, code: "MISSING_PROVENANCE", message: "missing genesis" };
  }
  if (genesis.sequence !== 0) {
    return {
      ok: false,
      code: "MISSING_PREFIX",
      message: "chain must start at genesis sequence 0",
    };
  }

  const seenIds = new Set<string>();
  const idToIndex = new Map<string, number>();

  for (let i = 0; i < chain.length; i += 1) {
    const link = chain[i];
    if (link === undefined) {
      return { ok: false, code: "MISSING_PROVENANCE", message: "provenance hole" };
    }

    if (link.sequence !== i) {
      return {
        ok: false,
        code: "REORDERED_PROVENANCE",
        message: `expected contiguous sequence ${String(i)}, got ${String(link.sequence)}`,
      };
    }

    // Self-ref before other predecessor checks so it classifies as cycle, not missing prefix.
    if (link.prevArtifactId !== null && link.prevArtifactId === link.artifactId) {
      return {
        ok: false,
        code: "CYCLIC_PROVENANCE",
        message: "self-referential provenance",
      };
    }

    if (seenIds.has(link.artifactId)) {
      return {
        ok: false,
        code: "CYCLIC_PROVENANCE",
        message: "duplicate artifact ids in provenance",
      };
    }

    // Forward reference / general cycle: prev points at current or later node.
    if (link.prevArtifactId !== null) {
      const prevIdx = idToIndex.get(link.prevArtifactId);
      if (prevIdx === undefined) {
        // Outside verified prefix, or points to an id that only appears later.
        const laterIdx = chain.findIndex((l) => l.artifactId === link.prevArtifactId);
        if (laterIdx > i) {
          return {
            ok: false,
            code: "CYCLIC_PROVENANCE",
            message: "forward-reference cycle in provenance",
          };
        }
        if (laterIdx === -1 && i > 0) {
          return {
            ok: false,
            code: "TAMPERED_PROVENANCE",
            message: "prevArtifactId outside verified prefix",
          };
        }
      } else if (prevIdx >= i) {
        return {
          ok: false,
          code: "CYCLIC_PROVENANCE",
          message: "forward-reference or self cycle",
        };
      } else if (prevIdx !== i - 1) {
        return {
          ok: false,
          code: "CYCLIC_PROVENANCE",
          message: "non-adjacent prev creates cycle or skip",
        };
      }
    }

    if (i === 0) {
      if (link.prevArtifactId !== null || link.prevLinkHash !== null) {
        return {
          ok: false,
          code: "MISSING_PREFIX",
          message: "genesis predecessor must be null",
        };
      }
    } else {
      const prev = chain[i - 1];
      if (prev === undefined) {
        return { ok: false, code: "MISSING_PROVENANCE", message: "missing previous link" };
      }
      if (link.prevArtifactId !== prev.artifactId) {
        return {
          ok: false,
          code: "TAMPERED_PROVENANCE",
          message: "prevArtifactId adjacency broken",
        };
      }
      if (link.prevLinkHash !== prev.linkHash) {
        return {
          ok: false,
          code: "TAMPERED_PROVENANCE",
          message: "prevLinkHash chain broken",
        };
      }
    }

    const expectedHash = computeLinkHash({
      sequence: link.sequence,
      artifactId: link.artifactId,
      prevArtifactId: link.prevArtifactId,
      prevLinkHash: link.prevLinkHash,
      attestedDigest: link.attestedDigest,
    });
    if (link.linkHash !== expectedHash) {
      return {
        ok: false,
        code: "TAMPERED_PROVENANCE",
        message: `linkHash mismatch at sequence ${String(i)}`,
      };
    }

    seenIds.add(link.artifactId);
    idToIndex.set(link.artifactId, i);
  }

  const tip = chain[chain.length - 1];
  if (tip === undefined) {
    return { ok: false, code: "MISSING_PROVENANCE", message: "missing tip" };
  }
  if (tip.artifactId !== artifact.artifactId) {
    return {
      ok: false,
      code: "TAMPERED_PROVENANCE",
      message: "tip artifactId mismatch",
    };
  }
  if (tip.sequence !== artifact.sequence) {
    return {
      ok: false,
      code: "TAMPERED_PROVENANCE",
      message: "tip sequence mismatch",
    };
  }
  const tipDigest = attestedDigestOf(artifact.attested);
  if (tip.attestedDigest !== tipDigest) {
    return {
      ok: false,
      code: "TAMPERED_PROVENANCE",
      message: "tip attestedDigest does not match current artifact",
    };
  }

  return { ok: true };
}

/**
 * Bounded delegation policy (spike non-claim): for one originalInvocationHash,
 * every hop's governing Principal (kind,id,authSource) must equal hop0's.
 * Changing the governor is not silently allowed here; it would require a future
 * explicit authority-transition artifact. Synthetic continuity only — not
 * production authorization or real identity proof.
 */
function validateDelegationContinuity(artifacts: readonly DecisionArtifact[]): ValidationResult {
  const byInvocation = new Map<string, DecisionArtifact[]>();
  for (const artifact of artifacts) {
    if (artifact.kind !== "delegation_hop" || artifact.attested.delegation === undefined) {
      continue;
    }
    const key = artifact.attested.originalInvocationHash;
    const list = byInvocation.get(key) ?? [];
    list.push(artifact);
    byInvocation.set(key, list);
  }

  for (const [, hops] of byInvocation) {
    const sorted = [...hops].sort((left, right) => {
      const li = left.attested.delegation?.hopIndex ?? -1;
      const ri = right.attested.delegation?.hopIndex ?? -1;
      return li - ri;
    });
    for (let i = 0; i < sorted.length; i += 1) {
      const art = sorted[i];
      const hop = art?.attested.delegation;
      if (art === undefined || hop === undefined) {
        return {
          ok: false,
          code: "DELEGATION_HOP_MISMATCH",
          message: "missing delegation hop payload",
        };
      }
      if (hop.hopIndex !== i) {
        return {
          ok: false,
          code: "DELEGATION_HOP_MISMATCH",
          message: `hop indices must be contiguous from 0; expected ${String(i)} got ${String(hop.hopIndex)}`,
        };
      }
      if (hop.governingPrincipal.id === "" || hop.governingPrincipal.authSource === "") {
        return {
          ok: false,
          code: "DELEGATION_HOP_MISMATCH",
          message: "each hop requires a governing principal",
        };
      }
      if (i > 0) {
        const prevHop = sorted[i - 1]?.attested.delegation;
        if (prevHop === undefined) {
          return {
            ok: false,
            code: "DELEGATION_HOP_MISMATCH",
            message: "missing prior hop",
          };
        }
        if (!principalsEqual(hop.from, prevHop.to)) {
          return {
            ok: false,
            code: "DELEGATION_HOP_MISMATCH",
            message: "next hop from must equal prior hop to",
          };
        }
        const hop0 = sorted[0]?.attested.delegation;
        if (
          hop0 === undefined ||
          !principalsEqual(hop.governingPrincipal, hop0.governingPrincipal)
        ) {
          return {
            ok: false,
            code: "DELEGATION_HOP_MISMATCH",
            message:
              "governing principal must match hop0 for the same invocation; authority transition requires a future explicit artifact",
          };
        }
      }
    }
  }
  return { ok: true };
}

export class DecisionArtifactLedger {
  private readonly artifacts: DecisionArtifact[] = [];

  append(input: {
    kind: DecisionKind;
    attested: AttestedFields;
    untrustedRationale?: string;
    recordedAt?: string;
  }): DecisionArtifact {
    // Schema before binding/provenance/lineage — fail closed on kind payloads.
    const schema = validateAttestedForKind(input.kind, input.attested);
    if (!schema.ok) {
      throw new Error(`${schema.code}: ${schema.message}`);
    }

    const binding = validateConfirmationBinding(input.attested);
    if (!binding.ok) {
      throw new Error(`${binding.code}: ${binding.message}`);
    }

    if (input.kind === "delegation_hop") {
      // Schema already requires delegation + valid principals; continuity only.
      const hop = input.attested.delegation;
      if (hop === undefined) {
        throw new Error("INVALID_DECISION_ARTIFACT: delegation_hop requires delegation");
      }
      const priorHops = this.artifacts.filter(
        (a) =>
          a.kind === "delegation_hop" &&
          a.attested.originalInvocationHash === input.attested.originalInvocationHash &&
          a.attested.delegation !== undefined,
      );
      const expectedIndex = priorHops.length;
      if (hop.hopIndex !== expectedIndex) {
        throw new Error(
          `DELEGATION_HOP_MISMATCH: hop indices must be contiguous; expected ${String(expectedIndex)} got ${String(hop.hopIndex)}`,
        );
      }
      if (expectedIndex > 0) {
        const prev = priorHops[expectedIndex - 1]?.attested.delegation;
        if (prev === undefined || !principalsEqual(hop.from, prev.to)) {
          throw new Error("DELEGATION_HOP_MISMATCH: next hop from must equal prior hop to");
        }
        const hop0 = priorHops[0]?.attested.delegation;
        if (
          hop0 === undefined ||
          !principalsEqual(hop.governingPrincipal, hop0.governingPrincipal)
        ) {
          throw new Error(
            "DELEGATION_HOP_MISMATCH: governing principal must match hop0 for the same invocation; authority transition requires a future explicit artifact",
          );
        }
      }
    }

    const sequence = this.artifacts.length;
    const artifactId = `art:${String(sequence)}:${randomUUID()}`;
    const prevArtifact =
      sequence === 0 ? undefined : this.artifacts[sequence - 1];
    const prevArtifactId = prevArtifact?.artifactId ?? null;
    const prevTipLink =
      prevArtifact === undefined
        ? undefined
        : prevArtifact.provenance[prevArtifact.provenance.length - 1];
    const prevLinkHash = prevTipLink?.linkHash ?? null;
    const attested = cloneAttested(input.attested);
    const digest = attestedDigestOf(attested);
    const linkBase = {
      sequence,
      artifactId,
      prevArtifactId,
      prevLinkHash,
      attestedDigest: digest,
    };
    const linkHash = computeLinkHash(linkBase);
    const prevChain =
      sequence === 0 ? [] : [...(prevArtifact?.provenance ?? [])];
    const provenance: ProvenanceLink[] = [
      ...prevChain,
      {
        ...linkBase,
        linkHash,
      },
    ];

    const artifact: DecisionArtifact = {
      artifactId,
      sequence,
      kind: input.kind,
      attested,
      provenance,
      recordedAt: input.recordedAt ?? new Date(0).toISOString(),
      ...(input.untrustedRationale !== undefined
        ? { untrustedRationale: input.untrustedRationale }
        : {}),
    };

    const shape = validateProvenanceChain(artifact);
    if (!shape.ok) {
      throw new Error(`${shape.code}: ${shape.message}`);
    }

    // Provisional continuity check including the new hop.
    const continuity = validateDelegationContinuity([...this.artifacts, artifact]);
    if (!continuity.ok) {
      throw new Error(`${continuity.code}: ${continuity.message}`);
    }

    this.artifacts.push(artifact);
    return structuredClone(artifact);
  }

  list(): readonly DecisionArtifact[] {
    return this.artifacts.map((a) => structuredClone(a));
  }

  validateChain(): ValidationResult {
    let expectedPrev: string | null = null;
    for (const artifact of this.artifacts) {
      const binding = validateConfirmationBinding(artifact.attested);
      if (!binding.ok) return binding;
      const shape = validateProvenanceChain(artifact);
      if (!shape.ok) return shape;

      const tip = artifact.provenance[artifact.provenance.length - 1];
      if (tip === undefined) {
        return { ok: false, code: "MISSING_PROVENANCE", message: "missing tip" };
      }
      if (tip.prevArtifactId !== expectedPrev) {
        return {
          ok: false,
          code: "TAMPERED_PROVENANCE",
          message: "ledger tip prevArtifactId mismatch",
        };
      }

      // Cross-check every historical link's attestedDigest against ledger artifacts.
      for (const link of artifact.provenance) {
        const historical = this.artifacts.find((a) => a.artifactId === link.artifactId);
        if (historical !== undefined) {
          if (link.attestedDigest !== attestedDigestOf(historical.attested)) {
            return {
              ok: false,
              code: "TAMPERED_PROVENANCE",
              message: `attestedDigest mismatch for ${link.artifactId}`,
            };
          }
        }
      }

      expectedPrev = artifact.artifactId;
    }
    return validateDelegationContinuity(this.artifacts);
  }

  tryImportArtifact(artifact: DecisionArtifact): ValidationResult {
    // Kind schema before provenance/lineage so hash-valid malformed payloads fail closed.
    const schema = validateAttestedForKind(artifact.kind, artifact.attested);
    if (!schema.ok) return schema;

    const binding = validateConfirmationBinding(artifact.attested);
    if (!binding.ok) return binding;
    const shape = validateProvenanceChain(artifact);
    if (!shape.ok) return shape;

    // After candidate self-chain validation, before delegation: attach lineage
    // to the existing ledger tip. Self-consistent fresh genesis must not replace
    // a nonempty ledger.
    const lineage = this.validateImportLineage(artifact);
    if (!lineage.ok) return lineage;

    // After schema + confirmation + provenance + lineage: continuity against ledger + candidate.
    return validateDelegationContinuity([...this.artifacts, artifact]);
  }

  /**
   * Import must continue the current ledger tip.
   * - empty ledger: only one-link sequence-0 genesis
   * - nonempty: sequence === length, provenance length === length+1,
   *   every prefix link equals tip artifact provenance (all fields),
   *   tip.prevArtifactId/prevLinkHash equal ledger tip id/linkHash
   */
  private validateImportLineage(artifact: DecisionArtifact): ValidationResult {
    const existing = this.artifacts;
    if (existing.length === 0) {
      if (artifact.sequence !== 0 || artifact.provenance.length !== 1) {
        return {
          ok: false,
          code: "TAMPERED_PROVENANCE",
          message: "empty ledger accepts only one-link sequence-0 genesis for import",
        };
      }
      return { ok: true };
    }

    if (artifact.sequence !== existing.length) {
      return {
        ok: false,
        code: "TAMPERED_PROVENANCE",
        message: `import lineage sequence must equal ledger length; expected ${String(existing.length)} got ${String(artifact.sequence)}`,
      };
    }
    if (artifact.provenance.length !== existing.length + 1) {
      return {
        ok: false,
        code: "TAMPERED_PROVENANCE",
        message: `import lineage provenance length must equal ledger length + 1; expected ${String(existing.length + 1)} got ${String(artifact.provenance.length)}`,
      };
    }

    const tipArtifact = existing[existing.length - 1];
    if (tipArtifact === undefined) {
      return {
        ok: false,
        code: "TAMPERED_PROVENANCE",
        message: "import lineage missing ledger tip artifact",
      };
    }

    for (let i = 0; i < tipArtifact.provenance.length; i += 1) {
      const expected = tipArtifact.provenance[i];
      const got = artifact.provenance[i];
      if (expected === undefined || got === undefined || !provenanceLinksEqual(expected, got)) {
        return {
          ok: false,
          code: "TAMPERED_PROVENANCE",
          message: `import lineage provenance prefix mismatch at sequence ${String(i)}`,
        };
      }
    }

    const candidateTip = artifact.provenance[artifact.provenance.length - 1];
    const ledgerTipLink = tipArtifact.provenance[tipArtifact.provenance.length - 1];
    if (candidateTip === undefined || ledgerTipLink === undefined) {
      return {
        ok: false,
        code: "TAMPERED_PROVENANCE",
        message: "import lineage missing tip link",
      };
    }
    if (candidateTip.prevArtifactId !== tipArtifact.artifactId) {
      return {
        ok: false,
        code: "TAMPERED_PROVENANCE",
        message: "import lineage tip prevArtifactId must equal ledger tip artifactId",
      };
    }
    if (candidateTip.prevLinkHash !== ledgerTipLink.linkHash) {
      return {
        ok: false,
        code: "TAMPERED_PROVENANCE",
        message: "import lineage tip prevLinkHash must equal ledger tip linkHash",
      };
    }

    return { ok: true };
  }
}

export class ExecutionReceiptStore {
  private readonly receipts = new Map<string, CanonicalExecutionReceipt>();

  put(receipt: CanonicalExecutionReceipt): void {
    this.receipts.set(receipt.receiptId, structuredClone(receipt));
  }

  get(receiptId: string): CanonicalExecutionReceipt | undefined {
    const value = this.receipts.get(receiptId);
    return value === undefined ? undefined : structuredClone(value);
  }

  isDecisionArtifact(value: unknown): boolean {
    if (value === null || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (
      typeof record.artifactId === "string" &&
      typeof record.sequence === "number" &&
      typeof record.kind === "string" &&
      record.attested !== undefined &&
      Array.isArray(record.provenance)
    );
  }
}

export function createRefusalArtifactInput(args: {
  invocationHash: string;
  principal: Principal;
  rule: DecisionRule;
  actionType: string;
  resourceRef: string;
  rationale?: string;
}): {
  kind: "refusal";
  attested: AttestedFields;
  untrustedRationale?: string;
} {
  const attested: AttestedFields = {
    originalInvocationHash: args.invocationHash,
    actionType: args.actionType,
    resourceRef: args.resourceRef,
    principal: structuredClone(args.principal),
    rule: structuredClone(args.rule),
  };
  return {
    kind: "refusal",
    attested,
    ...(args.rationale !== undefined ? { untrustedRationale: args.rationale } : {}),
  };
}

export function createConfirmationResponseInput(args: {
  invocationHash: string;
  principal: Principal;
  decision: "approve" | "deny";
  detail: Record<string, unknown>;
  actionType: string;
  resourceRef: string;
  /** If set, deliberately break binding for negative tests. */
  boundInvocationHashOverride?: string;
  rationale?: string;
}): {
  kind: "confirmation_response";
  attested: AttestedFields;
  untrustedRationale?: string;
} {
  const bound =
    args.boundInvocationHashOverride !== undefined
      ? args.boundInvocationHashOverride
      : args.invocationHash;
  const attested: AttestedFields = {
    originalInvocationHash: args.invocationHash,
    actionType: args.actionType,
    resourceRef: args.resourceRef,
    principal: structuredClone(args.principal),
    confirmation: {
      decision: args.decision,
      boundInvocationHash: bound,
      detail: structuredClone(args.detail),
    },
  };
  return {
    kind: "confirmation_response",
    attested,
    ...(args.rationale !== undefined ? { untrustedRationale: args.rationale } : {}),
  };
}

export function createDelegationHopInput(args: {
  invocationHash: string;
  hop: DelegationHop;
  actionType: string;
  resourceRef: string;
  rationale?: string;
}): {
  kind: "delegation_hop";
  attested: AttestedFields;
  untrustedRationale?: string;
} {
  const attested: AttestedFields = {
    originalInvocationHash: args.invocationHash,
    actionType: args.actionType,
    resourceRef: args.resourceRef,
    principal: structuredClone(args.hop.governingPrincipal),
    delegation: structuredClone(args.hop),
  };
  return {
    kind: "delegation_hop",
    attested,
    ...(args.rationale !== undefined ? { untrustedRationale: args.rationale } : {}),
  };
}

export function applyUntrustedRationale(
  artifact: DecisionArtifact,
  rationale: string,
  attemptedAttestedPatch: Partial<AttestedFields>,
): { artifact: DecisionArtifact; validation: ValidationResult } {
  const next: DecisionArtifact = {
    ...structuredClone(artifact),
    untrustedRationale: rationale,
  };

  const patchKeys = Object.keys(attemptedAttestedPatch);
  if (patchKeys.length > 0) {
    // Refuse to apply attested mutations from untrusted rationale path.
    return {
      artifact: next,
      validation: {
        ok: false,
        code: "RATIONALE_MUTATION_ATTEMPT",
        message: "untrusted rationale cannot mutate attested fields",
      },
    };
  }

  return { artifact: next, validation: { ok: true } };
}
