import type { ActorObservationV1 } from "../src/actor/deterministic.js";

export const actorChildObservationFixture = Object.freeze({
  observationSchemaVersion: 1,
  actorRuleVersion: 1,
  namespaceId: "ns:test:continuity-kernel-v0",
  caseId: "case:test:001",
  actorId: "agent:test:owner-001",
  grantActorId: "agent:test:owner-001",
  authorizationGrantId: "grant:test:case-001:owner-001",
  authorizationVersion: "7",
  expectedCaseVersion: "3",
  worldTime: "2026-07-11T10:00:02Z",
  caseStatus: "open",
  commitmentDeadline: "2026-07-11T12:00:00Z",
  payloadRef: "payload:test:attachment-001",
  permittedAction: "resolve_case",
  permittedResolution: "completed",
} satisfies ActorObservationV1);
