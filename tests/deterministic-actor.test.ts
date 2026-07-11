import { describe, expect, it, vi } from "vitest";

vi.mock("../src/alternative/restate/client.js", () => ({
  submitCommand: vi.fn(),
}));

import { submitCommand } from "../src/alternative/restate/client.js";
import { canonicalRequestHash, type ResolveCaseRequest } from "../src/domain/request.js";

const observation = {
  observationSchemaVersion: 1,
  actorRuleVersion: 1,
  namespaceId: "ns:test:continuity-kernel-v0",
  caseId: "case:test:001",
  actorId: "agent:test:owner-001",
  grantActorId: "agent:test:owner-001",
  authorizationGrantId: "grant:test:case-001:owner-001",
  authorizationVersion: "7",
  expectedCaseVersion: "3",
  worldTime: "2026-07-11T10:00:00Z",
  caseStatus: "open",
  commitmentDeadline: "2026-07-11T12:00:00Z",
  payloadRef: "payload:test:attachment-001",
  permittedAction: "resolve_case",
  permittedResolution: "completed",
} as const;

const expectedRequest = {
  requestHashSchemaVersion: 1,
  namespaceId: "ns:test:continuity-kernel-v0",
  caseId: "case:test:001",
  actorId: "agent:test:owner-001",
  authorizationGrantId: "grant:test:case-001:owner-001",
  authorizationVersion: "7",
  expectedCaseVersion: "3",
  actionType: "resolve_case",
  actionPayload: {
    commitmentDeadline: "2026-07-11T12:00:00Z",
    payloadRef: "payload:test:attachment-001",
    resolution: "completed",
  },
  worldTime: "2026-07-11T10:00:00Z",
} as const;

const expectedObservationHash = "r4d75VeJMmN00lQMiyQNF_49HiZwkT0zDkVVICcgxtA";
const expectedCommandId = `proposal:t4:v1:${expectedObservationHash}`;
const expectedRequestHash = "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY";
const expectedProposalDigest = "OyMGgOGM7dluoFBHe1yUrEdnYb85_c7bV-sOTJYyGjU";

type DecisionCode =
  | "UNSUPPORTED_OBSERVATION_SCHEMA_VERSION"
  | "UNSUPPORTED_ACTOR_RULE_VERSION"
  | "INVALID_OBSERVATION_SCHEMA"
  | "LOCAL_ACTOR_GRANT_MISMATCH"
  | "CASE_NOT_OPEN"
  | "ACTION_NOT_PERMITTED"
  | "RESOLUTION_NOT_PERMITTED"
  | "DEADLINE_EXCEEDED";

interface ActorProposalSurface {
  commandId: string;
  request: ResolveCaseRequest;
  proposalDigest: string;
}

interface DeterministicActorSurface {
  ActorDecisionError: typeof Error;
  selectProposal(input: unknown): ActorProposalSurface;
}

async function loadDeterministicActor(): Promise<DeterministicActorSurface> {
  const loaded: unknown = await import("../src/actor/deterministic.js");
  return loaded as DeterministicActorSurface;
}

async function loadExecuteObservation(): Promise<(input: unknown, workflowId?: string) => Promise<unknown>> {
  const loaded: unknown = await import("../src/actor/execute.js");
  return (loaded as {
    executeObservation: (input: unknown, workflowId?: string) => Promise<unknown>;
  }).executeObservation;
}

function expectDecisionCode(
  actor: DeterministicActorSurface,
  input: unknown,
  code: DecisionCode,
): void {
  let caught: unknown;
  try {
    actor.selectProposal(input);
  } catch (error) {
    caught = error;
  }
  expectDecisionErrorSurface(actor, caught, code);
}

function expectDecisionErrorSurface(
  actor: DeterministicActorSurface,
  caught: unknown,
  code: DecisionCode,
): void {
  expect(caught).toBeInstanceOf(actor.ActorDecisionError);
  expect(Object.getOwnPropertyNames(caught).sort()).toEqual(["code", "message", "name", "stack"]);
  expect(Object.getOwnPropertySymbols(caught)).toEqual([]);
  const error = caught as Error & { code: DecisionCode };
  expect({ code: error.code, message: error.message, name: error.name }).toEqual({
    code,
    message: code,
    name: "ActorDecisionError",
  });
  expect(error.stack).toEqual(expect.any(String));
  expect(error.stack?.startsWith(`ActorDecisionError: ${code}\n`)).toBe(true);
}

describe("frozen T4 pure deterministic actor contract", () => {
  it("selects the exact deterministic proposal fixture", async () => {
    const actor = await loadDeterministicActor();
    const proposal = actor.selectProposal(observation);

    expect(proposal).toEqual({
      proposalSchemaVersion: 1,
      actorRuleVersion: 1,
      commandId: expectedCommandId,
      request: expectedRequest,
      proposalDigest: expectedProposalDigest,
    });
    expect(proposal.commandId).toBe(`proposal:t4:v1:${expectedObservationHash}`);
    expect(canonicalRequestHash(proposal.request)).toBe(expectedRequestHash);
    expect(proposal.proposalDigest).toBe(expectedProposalDigest);
  });

  it("repeats exactly after a real delay without changing canonical identity", async () => {
    const actor = await loadDeterministicActor();
    const first = actor.selectProposal(observation);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const second = actor.selectProposal(observation);

    expect(second).toEqual(first);
    expect(second.commandId).toBe(expectedCommandId);
    expect(canonicalRequestHash(second.request)).toBe(expectedRequestHash);
    expect(second.proposalDigest).toBe(expectedProposalDigest);
  });

  it("rejects an unsupported observation schema version with a fixed data-free code", async () => {
    expectDecisionCode(
      await loadDeterministicActor(),
      { ...observation, observationSchemaVersion: 2, hiddenContext: "synthetic:undeclared" },
      "UNSUPPORTED_OBSERVATION_SCHEMA_VERSION",
    );
  });

  it("rejects an unsupported actor rule version with a fixed data-free code", async () => {
    expectDecisionCode(
      await loadDeterministicActor(),
      { ...observation, actorRuleVersion: 2, hiddenContext: "synthetic:undeclared" },
      "UNSUPPORTED_ACTOR_RULE_VERSION",
    );
  });

  it("rejects an undeclared hidden field as a representation schema error", async () => {
    expectDecisionCode(
      await loadDeterministicActor(),
      { ...observation, hiddenContext: "synthetic:undeclared" },
      "INVALID_OBSERVATION_SCHEMA",
    );
  });

  it("rejects declared actor and grant-actor mismatch as local consistency only", async () => {
    expectDecisionCode(
      await loadDeterministicActor(),
      { ...observation, grantActorId: "agent:test:other-001" },
      "LOCAL_ACTOR_GRANT_MISMATCH",
    );
  });

  it("rejects a non-open case locally with a fixed data-free code", async () => {
    expectDecisionCode(
      await loadDeterministicActor(),
      { ...observation, caseStatus: "resolved" },
      "CASE_NOT_OPEN",
    );
  });

  it("rejects undeclared action and resolution values with distinct fixed codes", async () => {
    const actor = await loadDeterministicActor();
    expectDecisionCode(actor, { ...observation, permittedAction: "reassign_case" }, "ACTION_NOT_PERMITTED");
    expectDecisionCode(
      actor,
      { ...observation, permittedResolution: "cancelled" },
      "RESOLUTION_NOT_PERMITTED",
    );
  });

  it("rejects semantic world time after the commitment deadline", async () => {
    const actor = await loadDeterministicActor();
    const atDeadline = actor.selectProposal({
      ...observation,
      worldTime: "2026-07-11T12:00:00Z",
    });

    expect(atDeadline).toEqual({
      proposalSchemaVersion: 1,
      actorRuleVersion: 1,
      commandId: "proposal:t4:v1:UeLnze3NVYlAAhDCOuPn0IrrK6YpeUAZB8SnlBqtpuc",
      request: {
        ...expectedRequest,
        worldTime: "2026-07-11T12:00:00Z",
      },
      proposalDigest: "z2-CWtLQx22bd2BrplU09vaPDg-Nb_TSPVZmxfyDXsY",
    });
    expect(canonicalRequestHash(atDeadline.request)).toBe("YthmUm0aVqogoEqiZpySQlc2cAv3l0GPqrZulCXWD2o");
    expectDecisionCode(
      actor,
      { ...observation, worldTime: "2026-07-11T12:00:01Z" },
      "DEADLINE_EXCEEDED",
    );
  });

  it("submits nothing for every executeObservation V2A local rejection category", async () => {
    vi.mocked(submitCommand).mockClear();
    const actor = await loadDeterministicActor();
    const executeObservation = await loadExecuteObservation();
    const rejections: ReadonlyArray<readonly [unknown, DecisionCode]> = [
      [
        { ...observation, observationSchemaVersion: 2, hiddenContext: "synthetic:undeclared" },
        "UNSUPPORTED_OBSERVATION_SCHEMA_VERSION",
      ],
      [
        { ...observation, actorRuleVersion: 2, hiddenContext: "synthetic:undeclared" },
        "UNSUPPORTED_ACTOR_RULE_VERSION",
      ],
      [{ ...observation, hiddenContext: "synthetic:undeclared" }, "INVALID_OBSERVATION_SCHEMA"],
      [{ ...observation, grantActorId: "agent:test:other-001" }, "LOCAL_ACTOR_GRANT_MISMATCH"],
      [{ ...observation, caseStatus: "resolved" }, "CASE_NOT_OPEN"],
      [{ ...observation, permittedAction: "reassign_case" }, "ACTION_NOT_PERMITTED"],
      [{ ...observation, permittedResolution: "cancelled" }, "RESOLUTION_NOT_PERMITTED"],
      [{ ...observation, worldTime: "2026-07-11T12:00:01Z" }, "DEADLINE_EXCEEDED"],
    ];

    for (const [input, code] of rejections) {
      let caught: unknown;
      try {
        await executeObservation(input);
      } catch (error) {
        caught = error;
      }
      expectDecisionErrorSurface(actor, caught, code);
    }

    expect(submitCommand).toHaveBeenCalledTimes(0);
  });
});
