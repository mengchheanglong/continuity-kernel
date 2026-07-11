import { z } from "zod";

import { canonicalHash } from "../domain/canonical.js";
import type { ResolveCaseRequest } from "../domain/request.js";

const nonemptyString = z.string().min(1);
const decimalString = z.string().regex(/^(0|[1-9]\d*)$/u);

export const actorObservationSchema = z.strictObject({
  observationSchemaVersion: z.literal(1),
  actorRuleVersion: z.literal(1),
  namespaceId: nonemptyString,
  caseId: nonemptyString,
  actorId: nonemptyString,
  grantActorId: nonemptyString,
  authorizationGrantId: nonemptyString,
  authorizationVersion: decimalString,
  expectedCaseVersion: decimalString,
  worldTime: z.iso.datetime(),
  caseStatus: nonemptyString,
  commitmentDeadline: z.iso.datetime(),
  payloadRef: nonemptyString,
  permittedAction: nonemptyString,
  permittedResolution: nonemptyString,
});

export type ActorObservationV1 = z.infer<typeof actorObservationSchema>;

export interface ActorProposalV1 {
  proposalSchemaVersion: 1;
  actorRuleVersion: 1;
  commandId: string;
  request: ResolveCaseRequest;
  proposalDigest: string;
}

export type ActorDecisionCode =
  | "UNSUPPORTED_OBSERVATION_SCHEMA_VERSION"
  | "UNSUPPORTED_ACTOR_RULE_VERSION"
  | "INVALID_OBSERVATION_SCHEMA"
  | "LOCAL_ACTOR_GRANT_MISMATCH"
  | "CASE_NOT_OPEN"
  | "ACTION_NOT_PERMITTED"
  | "RESOLUTION_NOT_PERMITTED"
  | "DEADLINE_EXCEEDED";

export class ActorDecisionError extends Error {
  readonly code: ActorDecisionCode;

  constructor(code: ActorDecisionCode) {
    super(code);
    this.name = "ActorDecisionError";
    this.code = code;
  }
}

function rejectUnsupportedVersion(
  input: unknown,
  key: "observationSchemaVersion" | "actorRuleVersion",
  code: ActorDecisionCode,
): void {
  if (typeof input === "object" && input !== null && Object.hasOwn(input, key)
    && (input as Record<string, unknown>)[key] !== 1) {
    throw new ActorDecisionError(code);
  }
}

function rejectWhen(condition: boolean, code: ActorDecisionCode): void {
  if (condition) throw new ActorDecisionError(code);
}

export function selectProposal(input: unknown): ActorProposalV1 {
  rejectUnsupportedVersion(input, "observationSchemaVersion", "UNSUPPORTED_OBSERVATION_SCHEMA_VERSION");
  rejectUnsupportedVersion(input, "actorRuleVersion", "UNSUPPORTED_ACTOR_RULE_VERSION");
  const result = actorObservationSchema.safeParse(input);
  if (!result.success) throw new ActorDecisionError("INVALID_OBSERVATION_SCHEMA");
  const observation = result.data;
  rejectWhen(observation.actorId !== observation.grantActorId, "LOCAL_ACTOR_GRANT_MISMATCH");
  rejectWhen(observation.caseStatus !== "open", "CASE_NOT_OPEN");
  rejectWhen(observation.permittedAction !== "resolve_case", "ACTION_NOT_PERMITTED");
  rejectWhen(observation.permittedResolution !== "completed", "RESOLUTION_NOT_PERMITTED");
  rejectWhen(Date.parse(observation.worldTime) > Date.parse(observation.commitmentDeadline), "DEADLINE_EXCEEDED");
  const request: ResolveCaseRequest = {
    requestHashSchemaVersion: 1,
    namespaceId: observation.namespaceId,
    caseId: observation.caseId,
    actorId: observation.actorId,
    authorizationGrantId: observation.authorizationGrantId,
    authorizationVersion: observation.authorizationVersion,
    expectedCaseVersion: observation.expectedCaseVersion,
    actionType: "resolve_case",
    actionPayload: {
      commitmentDeadline: observation.commitmentDeadline,
      payloadRef: observation.payloadRef,
      resolution: "completed",
    },
    worldTime: observation.worldTime,
  };
  const commandId = `proposal:t4:v1:${canonicalHash(observation)}`;
  const identity = { proposalSchemaVersion: 1 as const, actorRuleVersion: 1 as const, commandId, request };
  return { ...identity, proposalDigest: canonicalHash(identity) };
}
