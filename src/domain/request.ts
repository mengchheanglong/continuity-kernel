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
  commandId: nonemptyString,
  domainSchemaVersion: z.literal(1), authorizationModelVersion: z.literal(1),
  validatorVersion: z.literal(1), projectionSchemaVersion: z.literal(1),
  serializerVersion: z.literal("rfc8785-sha256-base64url-nopad-v1"),
  runtimeApplicationVersion: z.literal("continuity-kernel-restate-gate-d-v1"),
  request: resolveCaseRequestSchema,
});

export type CommitInput = z.infer<typeof commitInputSchema>;

type RequestValidationCode = "INVALID_REQUEST_SCHEMA" | "UNSUPPORTED_DOMAIN_SCHEMA_VERSION";

export class RequestValidationError extends Error {
  constructor(readonly code: RequestValidationCode = "INVALID_REQUEST_SCHEMA") { super(); this.message = code; this.name = "RequestValidationError"; }
}

export function parseCommitInput(input: unknown): CommitInput {
  if (typeof input === "object" && input !== null && Object.hasOwn(input, "domainSchemaVersion")
      && (input as { domainSchemaVersion: unknown }).domainSchemaVersion !== 1) {
    throw new RequestValidationError("UNSUPPORTED_DOMAIN_SCHEMA_VERSION");
  }
  const parsed = commitInputSchema.safeParse(input);
  if (!parsed.success) throw new RequestValidationError();
  return parsed.data;
}

export function buildCommitInput(commandId: unknown, request: unknown): CommitInput {
  return parseCommitInput({
    commandId, request, domainSchemaVersion: 1, authorizationModelVersion: 1,
    validatorVersion: 1, projectionSchemaVersion: 1,
    serializerVersion: "rfc8785-sha256-base64url-nopad-v1",
    runtimeApplicationVersion: "continuity-kernel-restate-gate-d-v1",
  });
}
