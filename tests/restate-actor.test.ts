import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { executeObservation } from "../src/actor/execute.js";
import {
  selectProposal,
  type ActorObservationV1,
  type ActorProposalV1,
} from "../src/actor/deterministic.js";
import { canonicalHash } from "../src/domain/canonical.js";
import { canonicalRequestHash } from "../src/domain/request.js";
import * as childModule from "./actor-child.js";
import * as observationFixtureModule from "./actor-observation-fixture.js";
import {
  completedProjection,
  completedProjectionDigest,
  fixture,
  requestHashes,
} from "./db-fixture.js";

const observationKeys = [
  "actorId",
  "actorRuleVersion",
  "authorizationGrantId",
  "authorizationVersion",
  "caseId",
  "caseStatus",
  "commitmentDeadline",
  "expectedCaseVersion",
  "grantActorId",
  "namespaceId",
  "observationSchemaVersion",
  "payloadRef",
  "permittedAction",
  "permittedResolution",
  "worldTime",
] as const;

interface ObservationAuthority {
  namespaceId: string;
  caseId: string;
  actorId: string;
  authorizationGrantId: string;
  authorizationVersion: string;
}

interface StoredReceipt {
  namespaceId: string;
  caseId: string;
  commandId: string;
  requestHash: string;
  outcomeStatus: string;
  decisionCode: string;
  authorizationVersion: string;
  caseVersion: string;
  payloadRef: string;
  projectionSchemaVersion: number;
  result: Record<string, unknown>;
}

interface AcceptedHistory {
  namespaceId: string;
  caseId: string;
  position: string;
  commandId: string;
  requestHash: string;
  actorId: string;
  authorizationGrantId: string;
  authorizationVersion: string;
  validatorVersion: number;
  actionType: string;
  payloadRef: string;
}

interface DecisionAudit {
  namespaceId: string;
  caseId: string;
  commandId: string;
  requestHash: string;
  actorId: string;
  authorizationGrantId: string;
  authorizationVersion: string;
  validatorVersion: number;
  decisionCode: string;
  payloadRef: string;
}

interface CaseState {
  namespaceId: string;
  caseId: string;
  ownerAgentId: string;
  version: string;
  status: string;
  commitmentDeadline: string | null;
  commitmentStatus: string | null;
  payloadRef: string | null;
}

interface CommandEvidence {
  receipt: StoredReceipt | null;
  acceptedHistory: AcceptedHistory[];
  decisionAudits: DecisionAudit[];
}

interface CleanupEvidence {
  actorChildren: number;
  workers: number;
  datasourceBackends: number;
  advisoryLocks: number;
}

interface ActorIntegrationHarness {
  reset(): Promise<void>;
  startWorker(): Promise<void>;
  registerDeployment(uri: string): Promise<void>;
  stopAll(): Promise<void>;
  close(): Promise<void>;
  readCleanupEvidence(): Promise<CleanupEvidence>;
  observe(authority: ObservationAuthority): Promise<ActorObservationV1 | null>;
  revokeGrant(): Promise<void>;
  setGrantVersion(version: string): Promise<void>;
  readCommandEvidence(namespaceId: string, commandId: string): Promise<CommandEvidence>;
  readCaseState(): Promise<CaseState>;
  readNamespaceCounts(namespaceId: string): Promise<CountEvidence>;
  readGlobalCounts(): Promise<CountEvidence>;
}

interface CountEvidence {
  receipts: number;
  acceptedHistory: number;
  decisionAudits: number;
}

interface ProposalMessage {
  type: "proposal";
  commandId: string;
  proposalDigest: string;
}

interface ActorChildController {
  waitForProposal(timeoutMs: number): Promise<ProposalMessage>;
  kill(signal: "SIGKILL", timeoutMs: number): Promise<void>;
  waitForExit(timeoutMs: number): Promise<{ signal: string | null; exitCode: number | null }>;
  getLaunchEvidence(): { argv: string[]; environmentKeys: string[]; stdout: string; stderr: string };
}

type CreateHarness = () => Promise<ActorIntegrationHarness>;
type SpawnActorChild = (observation: ActorObservationV1) => ActorChildController;

const createHarness = (observationFixtureModule as unknown as {
  createActorIntegrationHarness: CreateHarness;
}).createActorIntegrationHarness;
const spawnActorChild = (childModule as unknown as {
  spawnActorChild: SpawnActorChild;
}).spawnActorChild;
const bindActorChildObservation = (childModule as unknown as {
  bindActorChildObservation: (observation: ActorObservationV1) => void;
}).bindActorChildObservation;

const authority: ObservationAuthority = {
  namespaceId: fixture.namespaceId,
  caseId: fixture.caseId,
  actorId: fixture.ownerAgentId,
  authorizationGrantId: fixture.authorizationGrantId,
  authorizationVersion: fixture.authorizationVersion,
};
const deploymentUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
const workflowId = (label: string) => `t4:${label}:${randomUUID()}`;
let harness: ActorIntegrationHarness;

function requireDeploymentUri(): string {
  if (deploymentUri === undefined || deploymentUri.length === 0) {
    throw new Error("CK_RESTATE_DEPLOYMENT_URI is required for the proven Restate route");
  }
  return deploymentUri;
}

async function trustedObservation(): Promise<ActorObservationV1> {
  const observation = await harness.observe(authority);
  if (observation === null) throw new Error("Trusted synthetic observation fixture returned no row");
  return observation;
}

function expectOpenVersionThree(state: CaseState): void {
  expect(state).toEqual({
    namespaceId: fixture.namespaceId,
    caseId: fixture.caseId,
    ownerAgentId: fixture.ownerAgentId,
    version: "3",
    status: "open",
    commitmentDeadline: null,
    commitmentStatus: null,
    payloadRef: null,
  });
}

function expectRejectedEvidence(
  evidence: CommandEvidence,
  proposal: ActorProposalV1,
  expectedCode: string,
  caseVersion = "3",
): void {
  const requestHash = canonicalRequestHash(proposal.request);
  if (evidence.receipt === null) throw new Error("Expected one rejected command receipt");
  const { result, ...receiptColumns } = evidence.receipt;
  expect(receiptColumns).toEqual({
    namespaceId: proposal.request.namespaceId,
    caseId: proposal.request.caseId,
    commandId: proposal.commandId,
    requestHash,
    outcomeStatus: "rejected",
    decisionCode: expectedCode,
    authorizationVersion: proposal.request.authorizationVersion,
    caseVersion,
    payloadRef: proposal.request.actionPayload.payloadRef,
    projectionSchemaVersion: 1,
  });
  expect(result).toEqual({
    status: "rejected",
    code: expectedCode,
    namespaceId: proposal.request.namespaceId,
    caseId: proposal.request.caseId,
    commandId: proposal.commandId,
    requestHash,
    authorizationVersion: proposal.request.authorizationVersion,
    caseVersion,
    payloadRef: proposal.request.actionPayload.payloadRef,
  });
  expect(evidence.acceptedHistory).toEqual([]);
  expect(evidence.decisionAudits).toEqual([{
    namespaceId: proposal.request.namespaceId,
    caseId: proposal.request.caseId,
    commandId: proposal.commandId,
    requestHash,
    actorId: proposal.request.actorId,
    authorizationGrantId: proposal.request.authorizationGrantId,
    authorizationVersion: proposal.request.authorizationVersion,
    validatorVersion: 1,
    decisionCode: expectedCode,
    payloadRef: proposal.request.actionPayload.payloadRef,
  }]);
}

beforeAll(async () => {
  harness = await createHarness();
});

beforeEach(async () => {
  await harness.reset();
  await harness.startWorker();
  await harness.registerDeployment(requireDeploymentUri());
}, 60_000);

afterEach(async () => {
  await harness.stopAll();
  expect(await harness.readCleanupEvidence()).toEqual({
    actorChildren: 0,
    workers: 0,
    datasourceBackends: 0,
    advisoryLocks: 0,
  });
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe("frozen T4 Restate actor integration contract", () => {
  it("proves exact trusted observation provenance and independently denies every authority mismatch", async () => {
    const observation = await trustedObservation();
    expect(Object.keys(observation).sort()).toEqual([...observationKeys].sort());
    expect(observation).toEqual({
      observationSchemaVersion: 1,
      actorRuleVersion: 1,
      namespaceId: fixture.namespaceId,
      caseId: fixture.caseId,
      actorId: fixture.ownerAgentId,
      grantActorId: fixture.ownerAgentId,
      authorizationGrantId: fixture.authorizationGrantId,
      authorizationVersion: fixture.authorizationVersion,
      expectedCaseVersion: fixture.caseVersion,
      worldTime: fixture.worldTime,
      caseStatus: "open",
      commitmentDeadline: fixture.commitmentDeadline,
      payloadRef: fixture.payloadRef,
      permittedAction: "resolve_case",
      permittedResolution: "completed",
    });
    const mismatches = [
      { ...authority, namespaceId: "ns:test:unauthorized" },
      { ...authority, caseId: "case:test:unauthorized" },
      { ...authority, actorId: fixture.otherAgentId },
      { ...authority, authorizationGrantId: "grant:test:unauthorized" },
      { ...authority, authorizationVersion: "6" },
    ];
    for (const mismatch of mismatches) expect(await harness.observe(mismatch)).toBeNull();
    await harness.revokeGrant();
    expect(await harness.observe(authority)).toBeNull();

    await harness.stopAll();
    expect(await harness.readCleanupEvidence()).toEqual({
      actorChildren: 0,
      workers: 0,
      datasourceBackends: 0,
      advisoryLocks: 0,
    });
  }, 120_000);

  it("T4-V2B preserves exact authoritative authorization rejections in isolated subcases", async () => {
    const noArrange = () => Promise.resolve();
    const subcases = [
      { label: "revoked", code: "AUTHORIZATION_REVOKED", mutate: (value: ActorObservationV1) => value,
        arrange: () => harness.revokeGrant() },
      { label: "wrong-actor", code: "AUTHORIZATION_DENIED",
        mutate: (value: ActorObservationV1) => ({ ...value, actorId: fixture.otherAgentId,
          grantActorId: fixture.otherAgentId }), arrange: noArrange },
      { label: "wrong-case", code: "AUTHORIZATION_DENIED",
        mutate: (value: ActorObservationV1) => ({ ...value, caseId: "case:test:unauthorized" }),
        arrange: noArrange },
      { label: "wrong-namespace", code: "AUTHORIZATION_DENIED",
        mutate: (value: ActorObservationV1) => ({ ...value, namespaceId: "ns:test:unauthorized" }),
        arrange: noArrange },
      { label: "stale-authorization-version", code: "AUTHORIZATION_VERSION_CONFLICT",
        mutate: (value: ActorObservationV1) => ({ ...value, authorizationVersion: "6" }),
        arrange: noArrange },
    ] as const;

    for (const subcase of subcases) {
      await harness.reset();
      const observation = subcase.mutate(await trustedObservation());
      await subcase.arrange();
      const proposal = selectProposal(observation);
      const consequence = await executeObservation(observation, workflowId(`v2b-${subcase.label}`));

      const { result, ...consequenceIdentity } = consequence;
      expect(consequenceIdentity).toEqual({
        consequenceSchemaVersion: 1,
        proposalSchemaVersion: 1,
        actorRuleVersion: 1,
        commandId: proposal.commandId,
        proposalDigest: proposal.proposalDigest,
      });
      expect(result).toMatchObject({
        status: "rejected",
        code: subcase.code,
        commandId: proposal.commandId,
        requestHash: canonicalRequestHash(proposal.request),
      });
      const evidence = await harness.readCommandEvidence(proposal.request.namespaceId, proposal.commandId);
      expectRejectedEvidence(evidence, proposal, subcase.code);
      if (evidence.receipt === null) throw new Error("Expected exact stored rejection result");
      expect(result).toEqual(evidence.receipt.result);
      expect(await harness.readNamespaceCounts(proposal.request.namespaceId)).toEqual({
        receipts: 1,
        acceptedHistory: 0,
        decisionAudits: 1,
      });
      if (subcase.label === "wrong-namespace") {
        expect(await harness.readNamespaceCounts(fixture.namespaceId)).toEqual({
          receipts: 0,
          acceptedHistory: 0,
          decisionAudits: 0,
        });
      }
      expectOpenVersionThree(await harness.readCaseState());
    }
  }, 120_000);

  it("T4-V3 records one accepted causal trace consistently across every available surface", async () => {
    const observation = await trustedObservation();
    const proposal = selectProposal(observation);
    const consequence = await executeObservation(observation, workflowId("v3-accepted"));
    const evidence = await harness.readCommandEvidence(proposal.request.namespaceId, proposal.commandId);
    const state = await harness.readCaseState();
    const requestHash = canonicalRequestHash(proposal.request);

    expect(consequence).toEqual({
      consequenceSchemaVersion: 1,
      proposalSchemaVersion: 1,
      actorRuleVersion: 1,
      commandId: proposal.commandId,
      proposalDigest: proposal.proposalDigest,
      result: {
        status: "accepted",
        code: "ACCEPTED",
        namespaceId: fixture.namespaceId,
        caseId: fixture.caseId,
        commandId: proposal.commandId,
        requestHash,
        authorizationVersion: fixture.authorizationVersion,
        caseVersion: "4",
        payloadRef: fixture.payloadRef,
        projectionSchemaVersion: 1,
        projection: completedProjection,
        projectionDigest: completedProjectionDigest,
      },
    });
    expect(requestHash).toBe(requestHashes.completed);
    if (evidence.receipt === null) throw new Error("Expected one accepted command receipt");
    const { result: storedResult, ...receiptColumns } = evidence.receipt;
    expect(receiptColumns).toEqual({
      namespaceId: fixture.namespaceId,
      caseId: fixture.caseId,
      commandId: proposal.commandId,
      requestHash,
      outcomeStatus: "accepted",
      decisionCode: "ACCEPTED",
      authorizationVersion: fixture.authorizationVersion,
      caseVersion: "4",
      payloadRef: fixture.payloadRef,
      projectionSchemaVersion: 1,
    });
    expect(storedResult).toEqual({
      status: "accepted", code: "ACCEPTED", namespaceId: fixture.namespaceId,
      caseId: fixture.caseId, commandId: proposal.commandId, requestHash,
      authorizationVersion: fixture.authorizationVersion, caseVersion: "4",
      payloadRef: fixture.payloadRef, projectionSchemaVersion: 1, projection: completedProjection,
    });
    expect(canonicalHash(storedResult.projection)).toBe(completedProjectionDigest);
    expect(evidence.acceptedHistory).toEqual([{
      namespaceId: fixture.namespaceId,
      caseId: fixture.caseId,
      position: "4",
      commandId: proposal.commandId,
      requestHash,
      actorId: fixture.ownerAgentId,
      authorizationGrantId: fixture.authorizationGrantId,
      authorizationVersion: fixture.authorizationVersion,
      validatorVersion: 1,
      actionType: "resolve_case",
      payloadRef: fixture.payloadRef,
    }]);
    expect(evidence.decisionAudits).toEqual([]);
    expect(state).toEqual({
      namespaceId: fixture.namespaceId,
      caseId: fixture.caseId,
      ownerAgentId: fixture.ownerAgentId,
      version: "4",
      status: "resolved",
      commitmentDeadline: "2026-07-11 12:00:00+00",
      commitmentStatus: "completed",
      payloadRef: fixture.payloadRef,
    });
    expect(await harness.readNamespaceCounts(proposal.request.namespaceId)).toEqual({
      receipts: 1,
      acceptedHistory: 1,
      decisionAudits: 0,
    });
  }, 120_000);

  it("T4-V4 returns the same stored acceptance for duplicate proposals on distinct workflows", async () => {
    const observation = await trustedObservation();
    const firstProposal = selectProposal(observation);
    const firstWorkflowId = workflowId("v4-first");
    const secondWorkflowId = workflowId("v4-second");
    expect(firstWorkflowId).not.toBe(secondWorkflowId);
    const first = await executeObservation(observation, firstWorkflowId);
    const repeatedObservation = structuredClone(observation);
    const secondProposal = selectProposal(repeatedObservation);
    const second = await executeObservation(repeatedObservation, secondWorkflowId);
    const evidence = await harness.readCommandEvidence(
      firstProposal.request.namespaceId,
      firstProposal.commandId,
    );

    expect(secondProposal).toEqual(firstProposal);
    expect(second).toEqual(first);
    const { projectionDigest, ...durableResult } = first.result;
    expect(projectionDigest).toBe(completedProjectionDigest);
    expect(durableResult).toEqual(evidence.receipt?.result);
    expect(first).toMatchObject({
      commandId: firstProposal.commandId,
      proposalDigest: firstProposal.proposalDigest,
      result: { status: "accepted", code: "ACCEPTED", caseVersion: "4" },
    });
    expect(evidence.acceptedHistory).toHaveLength(1);
    expect(evidence.acceptedHistory[0]).toMatchObject({ commandId: firstProposal.commandId, position: "4" });
    expect(await harness.readNamespaceCounts(firstProposal.request.namespaceId)).toEqual({
      receipts: 1,
      acceptedHistory: 1,
      decisionAudits: 0,
    });
    expect(await harness.readCaseState()).toMatchObject({
      version: "4",
      status: "resolved",
      commitmentStatus: "completed",
    });
  }, 120_000);

  it("T4-V5 rejects a stale proposal after one exact competing transition", async () => {
    const observation = await trustedObservation();
    const staleProposal = selectProposal(observation);
    const competingObservation = { ...observation, worldTime: "2026-07-11T10:00:01Z" };
    const competingProposal = selectProposal(competingObservation);
    const competing = await executeObservation(competingObservation, workflowId("v5-competing"));
    const stale = await executeObservation(observation, workflowId("v5-stale"));
    const staleEvidence = await harness.readCommandEvidence(
      staleProposal.request.namespaceId,
      staleProposal.commandId,
    );

    expect(competing).toMatchObject({
      commandId: competingProposal.commandId,
      proposalDigest: competingProposal.proposalDigest,
      result: { status: "accepted", code: "ACCEPTED", caseVersion: "4",
        projection: completedProjection, projectionDigest: completedProjectionDigest },
    });
    expect(stale).toMatchObject({
      commandId: staleProposal.commandId,
      proposalDigest: staleProposal.proposalDigest,
      result: {
        status: "rejected",
        code: "EXPECTED_VERSION_CONFLICT",
        caseVersion: "4",
        commandId: staleProposal.commandId,
        requestHash: requestHashes.completed,
      },
    });
    expectRejectedEvidence(staleEvidence, staleProposal, "EXPECTED_VERSION_CONFLICT", "4");
    if (staleEvidence.receipt === null) throw new Error("Expected exact stored stale rejection result");
    expect(stale.result).toEqual(staleEvidence.receipt.result);
    expect(staleEvidence.receipt.caseVersion).toBe("4");
    expect(staleEvidence.acceptedHistory).toEqual([]);
    expect(await harness.readNamespaceCounts(staleProposal.request.namespaceId)).toEqual({
      receipts: 2,
      acceptedHistory: 1,
      decisionAudits: 1,
    });
    expect(await harness.readCaseState()).toEqual({
      namespaceId: fixture.namespaceId,
      caseId: fixture.caseId,
      ownerAgentId: fixture.ownerAgentId,
      version: "4",
      status: "resolved",
      commitmentDeadline: "2026-07-11 12:00:00+00",
      commitmentStatus: "completed",
      payloadRef: fixture.payloadRef,
    });
  }, 120_000);

  it("T4-V6 proves process-independent deterministic reproduction only, not restart or reacquisition", async () => {
    const observation = { ...await trustedObservation(), worldTime: "2026-07-11T10:00:02Z" };
    const parentProposal = selectProposal(observation);
    bindActorChildObservation(observation);
    const prohibitedLaunchValues = [
      "observation",
      "request",
      "payload",
      "grant",
      "requestHash",
      "commandId",
      "proposalDigest",
      JSON.stringify(observation),
      JSON.stringify(parentProposal.request),
      fixture.payloadRef,
      fixture.authorizationGrantId,
      canonicalRequestHash(parentProposal.request),
      parentProposal.commandId,
      parentProposal.proposalDigest,
    ];
    const expectSanitizedLaunch = (child: ActorChildController): void => {
      const launch = child.getLaunchEvidence();
      expect(Object.keys(launch).sort()).toEqual(["argv", "environmentKeys", "stderr", "stdout"]);
      expect(launch.environmentKeys).toEqual(["NODE_ENV"]);
      expect(launch.stdout).toBe("");
      expect(launch.stderr).toBe("");
      for (const argument of launch.argv) {
        for (const prohibited of prohibitedLaunchValues) expect(argument).not.toContain(prohibited);
      }
    };
    expect(() => spawnActorChild({
      ...observation,
      worldTime: "2026-07-11T10:00:03Z",
    })).toThrowError(/^ACTOR_CHILD_OBSERVATION_MISMATCH$/u);
    const expectNoChildEffects = async (): Promise<void> => {
      expect(await harness.readCommandEvidence(
        parentProposal.request.namespaceId,
        parentProposal.commandId,
      )).toEqual({ receipt: null, acceptedHistory: [], decisionAudits: [] });
      expect(await harness.readGlobalCounts()).toEqual({
        receipts: 0,
        acceptedHistory: 0,
        decisionAudits: 0,
      });
      expectOpenVersionThree(await harness.readCaseState());
    };
    const firstChild = spawnActorChild(observation);
    expectSanitizedLaunch(firstChild);
    const firstMessage = await firstChild.waitForProposal(5_000);

    expect(Object.keys(firstMessage).sort()).toEqual(["commandId", "proposalDigest", "type"]);
    expect(firstMessage).toEqual({
      type: "proposal",
      commandId: parentProposal.commandId,
      proposalDigest: parentProposal.proposalDigest,
    });
    const firstIpc = JSON.stringify(firstMessage);
    expect(firstIpc).not.toContain(fixture.payloadRef);
    expect(firstIpc).not.toContain(fixture.authorizationGrantId);
    expect(firstIpc).not.toContain(requestHashes.completed);
    await firstChild.kill("SIGKILL", 5_000);
    expect(await firstChild.waitForExit(5_000)).toMatchObject({ signal: "SIGKILL" });
    await expectNoChildEffects();

    const secondChild = spawnActorChild(structuredClone(observation));
    expectSanitizedLaunch(secondChild);
    const secondMessage = await secondChild.waitForProposal(5_000);
    expect(Object.keys(secondMessage).sort()).toEqual(["commandId", "proposalDigest", "type"]);
    expect(secondMessage).toEqual(firstMessage);
    expect(JSON.stringify(secondMessage)).toBe(firstIpc);
    await secondChild.kill("SIGKILL", 5_000);
    expect(await secondChild.waitForExit(5_000)).toMatchObject({ signal: "SIGKILL" });
    await expectNoChildEffects();

    const consequence = await executeObservation(observation, workflowId("v6-parent-submit-once"));
    expect(consequence).toMatchObject({
      commandId: firstMessage.commandId,
      proposalDigest: firstMessage.proposalDigest,
      result: { status: "accepted", code: "ACCEPTED", caseVersion: "4" },
    });
    expect(await harness.readGlobalCounts()).toEqual({
      receipts: 1,
      acceptedHistory: 1,
      decisionAudits: 0,
    });
    expect(await harness.readCaseState()).toMatchObject({
      version: "4",
      status: "resolved",
      commitmentStatus: "completed",
    });
  }, 120_000);
});
