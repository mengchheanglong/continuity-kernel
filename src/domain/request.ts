import { z } from "zod";

const nonemptyString = z.string().min(1);
const decimalString = z.string().regex(/^(0|[1-9]\d*)$/u);

export const resolveCaseRequestSchema = z.strictObject({
  requestHashSchemaVersion: z.literal(1),
  namespaceId: nonemptyString, caseId: nonemptyString, actorId: nonemptyString,
  authorizationGrantId: nonemptyString, authorizationVersion: decimalString,
  expectedCaseVersion: decimalString,
  actionType: z.literal("resolve_case"),
  actionPayload: z.strictObject({
    commitmentDeadline: z.iso.datetime(), payloadRef: nonemptyString,
    resolution: z.enum(["completed", "cancelled"]),
  }),
  worldTime: z.iso.datetime(),
});

export type ResolveCaseRequest = z.infer<typeof resolveCaseRequestSchema>;

export const commitInputSchema = z.strictObject({
  commandId: nonemptyString, domainSchemaVersion: z.literal(1), authorizationModelVersion: z.literal(1),
  validatorVersion: z.literal(1), projectionSchemaVersion: z.literal(1),
  serializerVersion: z.literal("rfc8785-sha256-base64url-nopad-v1"),
  runtimeApplicationVersion: z.literal("continuity-kernel-restate-gate-d-v1"),
  request: resolveCaseRequestSchema,
});

export type CommitInput = z.infer<typeof commitInputSchema>;

type RequestValidationCode = "INVALID_REQUEST_SCHEMA" | "UNSUPPORTED_DOMAIN_SCHEMA_VERSION" | "UNSUPPORTED_AUTHORIZATION_MODEL_VERSION" | "UNSUPPORTED_REQUEST_HASH_SCHEMA_VERSION" | "UNSUPPORTED_VALIDATOR_VERSION" | "UNSUPPORTED_PROJECTION_SCHEMA_VERSION" | "UNSUPPORTED_SERIALIZER_VERSION" | "UNSUPPORTED_RUNTIME_APPLICATION_VERSION";

export class RequestValidationError extends Error {
  constructor(readonly code: RequestValidationCode = "INVALID_REQUEST_SCHEMA") { super(); this.message = code; this.name = "RequestValidationError"; }
}

function rejectVersion(value: unknown, key: string, supported: unknown, code: RequestValidationCode): void {
  if (typeof value === "object" && value !== null && Object.hasOwn(value, key) && (value as Record<string, unknown>)[key] !== supported) throw new RequestValidationError(code);
}

export function parseCommitInput(input: unknown): CommitInput {
  rejectVersion(input, "domainSchemaVersion", 1, "UNSUPPORTED_DOMAIN_SCHEMA_VERSION");
  const request = typeof input === "object" && input !== null && !Array.isArray(input) && Object.hasOwn(input, "request")
    ? (input as { request: unknown }).request : undefined;
  const requestObject = typeof request === "object" && request !== null && !Array.isArray(request) ? request : undefined;
  rejectVersion(requestObject, "requestHashSchemaVersion", 1, "UNSUPPORTED_REQUEST_HASH_SCHEMA_VERSION");
  rejectVersion(input, "authorizationModelVersion", 1, "UNSUPPORTED_AUTHORIZATION_MODEL_VERSION");
  rejectVersion(input, "validatorVersion", 1, "UNSUPPORTED_VALIDATOR_VERSION");
  rejectVersion(input, "projectionSchemaVersion", 1, "UNSUPPORTED_PROJECTION_SCHEMA_VERSION");
  rejectVersion(input, "serializerVersion", "rfc8785-sha256-base64url-nopad-v1", "UNSUPPORTED_SERIALIZER_VERSION");
  rejectVersion(input, "runtimeApplicationVersion", "continuity-kernel-restate-gate-d-v1", "UNSUPPORTED_RUNTIME_APPLICATION_VERSION");
  const parsed = commitInputSchema.safeParse(input);
  if (!parsed.success) throw new RequestValidationError();
  return parsed.data;
}

export function buildCommitInput(commandId: unknown, request: unknown): CommitInput {
  return parseCommitInput({ commandId, request, domainSchemaVersion: 1, authorizationModelVersion: 1,
    validatorVersion: 1, projectionSchemaVersion: 1,
    serializerVersion: "rfc8785-sha256-base64url-nopad-v1", runtimeApplicationVersion: "continuity-kernel-restate-gate-d-v1",
  });
}
