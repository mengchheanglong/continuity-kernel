import { setTimeout as delay } from "node:timers/promises";

import postgres from "postgres";

import { canonicalHash } from "../src/domain/canonical.js";

export const fixture = {
  namespaceId: "ns:test:continuity-kernel-v0",
  caseId: "case:test:001",
  ownerAgentId: "agent:test:owner-001",
  otherAgentId: "agent:test:other-001",
  authorizationGrantId: "grant:test:case-001:owner-001",
  authorizationVersion: "7",
  caseVersion: "3",
  commitmentDeadline: "2026-07-11T12:00:00Z",
  worldTime: "2026-07-11T10:00:00Z",
  payloadRef: "payload:test:attachment-001",
} as const;

export interface ResolveCaseRequest {
  requestHashSchemaVersion: number;
  namespaceId: string;
  caseId: string;
  actorId: string;
  authorizationGrantId: string;
  authorizationVersion: string;
  expectedCaseVersion: string;
  actionType: "resolve_case";
  actionPayload: {
    commitmentDeadline: string;
    payloadRef: string;
    resolution: "completed" | "cancelled";
  };
  worldTime: string;
}

export const completedRequest: ResolveCaseRequest = {
  requestHashSchemaVersion: 1,
  namespaceId: fixture.namespaceId,
  caseId: fixture.caseId,
  actorId: fixture.ownerAgentId,
  authorizationGrantId: fixture.authorizationGrantId,
  authorizationVersion: fixture.authorizationVersion,
  expectedCaseVersion: fixture.caseVersion,
  actionType: "resolve_case",
  actionPayload: {
    commitmentDeadline: fixture.commitmentDeadline,
    payloadRef: fixture.payloadRef,
    resolution: "completed",
  },
  worldTime: fixture.worldTime,
};

export const cancelledRequest: ResolveCaseRequest = {
  ...completedRequest,
  actionPayload: { ...completedRequest.actionPayload, resolution: "cancelled" },
};

export const requestHashes = {
  completed: "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY",
  cancelled: "HSr94sXx_grOCvaqM6vMKzDOJeXus8l-2fDBFZJ12qU",
} as const;

export const completedProjection = {
  projectionSchemaVersion: 1,
  namespaceId: fixture.namespaceId,
  case: {
    caseId: fixture.caseId,
    ownerAgentId: fixture.ownerAgentId,
    version: "4",
    status: "resolved",
    commitment: {
      deadline: fixture.commitmentDeadline,
      status: "completed",
    },
  },
} as const;

export const completedProjectionDigest =
  "AEMpcJ6pJpNog4XeTOqNybf6SvWYmyCJVoPeOikywUs";

export interface CommitResult {
  status: "accepted" | "rejected";
  code: string;
  namespaceId: string;
  caseId: string;
  commandId: string;
  requestHash: string;
  authorizationVersion: string;
  caseVersion: string;
  payloadRef: string;
  projectionSchemaVersion?: number;
  projectionDigest?: string;
  projection?: unknown;
}

export interface CommitOptions {
  validatorVersion?: number;
  projectionSchemaVersion?: number;
}

export interface CommitAttempt {
  result: CommitResult;
  attempts: number;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) throw new Error("Deferred is not initialized");
      resolvePromise(value);
    },
    reject(reason) {
      if (rejectPromise === undefined) throw new Error("Deferred is not initialized");
      rejectPromise(reason);
    },
  };
}

const commonOptions = {
  host: "127.0.0.1",
  port: 55432,
  database: "continuity_app_db",
  max: 1,
  connect_timeout: 5,
  idle_timeout: 2,
  prepare: false,
} as const;

export function createAdminSql(applicationName: string): postgres.Sql {
  return postgres({
    ...commonOptions,
    user: "postgres",
    password: "postgres",
    connection: { application_name: applicationName },
  });
}

export function createAppSql(applicationName: string): postgres.Sql {
  return postgres({
    ...commonOptions,
    user: "continuity_app",
    password: "continuity_app",
    connection: { application_name: applicationName },
  });
}

export function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function postgresMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function expectSqlState(
  operation: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const actualCode = postgresCode(error);
    if (actualCode === expectedCode) return;
    throw new Error(
      `Expected PostgreSQL SQLSTATE ${expectedCode}, received ${actualCode ?? "none"}: ${postgresMessage(error)}`,
      { cause: error },
    );
  }
  throw new Error(`Expected PostgreSQL SQLSTATE ${expectedCode}, but the statement succeeded`);
}

export async function resetSyntheticFixture(admin: postgres.Sql): Promise<void> {
  await admin.begin(async (sql) => {
    await sql.unsafe(`
      TRUNCATE TABLE
        continuity.decision_audit,
        continuity.accepted_history,
        continuity.command_receipts,
        continuity.cases,
        continuity.authorization_grants
      RESTART IDENTITY
    `);
    await sql`
      INSERT INTO continuity.authorization_grants (
        namespace_id, authorization_grant_id, case_id, actor_id, version, is_revoked
      ) VALUES (
        ${fixture.namespaceId}, ${fixture.authorizationGrantId}, ${fixture.caseId},
        ${fixture.ownerAgentId}, ${fixture.authorizationVersion}, false
      )
    `;
    await sql`
      INSERT INTO continuity.cases (
        namespace_id, case_id, owner_agent_id, version, status,
        commitment_deadline, commitment_status, payload_ref
      ) VALUES (
        ${fixture.namespaceId}, ${fixture.caseId}, ${fixture.ownerAgentId},
        ${fixture.caseVersion}, 'open', null, null, null
      )
    `;
  });
}

export async function invokeCommit(
  sql: postgres.TransactionSql,
  commandId: string,
  requestHash: string,
  request: ResolveCaseRequest,
  options: CommitOptions = {},
): Promise<CommitResult> {
  const validatorVersion = options.validatorVersion ?? 1;
  const projectionSchemaVersion = options.projectionSchemaVersion ?? 1;
  const rows = await sql<{ result: CommitResult }[]>`
    SELECT continuity.commit_command(
      ${commandId},
      ${requestHash},
      ${sql.json(request as unknown as postgres.JSONValue)},
      ${validatorVersion},
      ${projectionSchemaVersion}
    ) AS result
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("Canonical commit returned no result row");
  if (row.result.projection === undefined) return row.result;
  return { ...row.result, projectionDigest: canonicalHash(row.result.projection) };
}

export async function serializableCommit(
  app: postgres.Sql,
  commandId: string,
  requestHash: string,
  request: ResolveCaseRequest,
  options: CommitOptions = {},
): Promise<CommitAttempt> {
  const maximumAttempts = 4;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const result = await app.begin("isolation level serializable", (sql) =>
        invokeCommit(sql, commandId, requestHash, request, options),
      );
      return { result, attempts: attempt };
    } catch (error) {
      if (postgresCode(error) !== "40001" || attempt === maximumAttempts) throw error;
    }
  }
  throw new Error("Serializable retry loop ended without a result");
}

export async function barrierCommit(
  app: postgres.Sql,
  ready: Deferred<undefined>,
  release: Promise<undefined>,
  commandId: string,
  requestHash: string,
  request: ResolveCaseRequest,
): Promise<CommitAttempt> {
  try {
    const result = await app.begin("isolation level serializable", async (sql) => {
      ready.resolve(undefined);
      await release;
      return invokeCommit(sql, commandId, requestHash, request);
    });
    return { result, attempts: 1 };
  } catch (error) {
    if (postgresCode(error) !== "40001") throw error;
    const retry = await serializableCommit(app, commandId, requestHash, request);
    return { result: retry.result, attempts: retry.attempts + 1 };
  }
}

export async function revokeGrant(revoker: postgres.Sql): Promise<void> {
  const rows = await revoker<{ version: string }[]>`
    UPDATE continuity.authorization_grants
    SET version = 8, is_revoked = true
    WHERE namespace_id = ${fixture.namespaceId}
      AND authorization_grant_id = ${fixture.authorizationGrantId}
    RETURNING version::text AS version
  `;
  if (rows[0]?.version !== "8") throw new Error("Synthetic grant was not revoked at version 8");
}

export async function waitForApplicationLock(
  observer: postgres.Sql,
  applicationName: string,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const rows = await observer<{ blocked: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_stat_activity
        WHERE datname = current_database()
          AND application_name = ${applicationName}
          AND wait_event_type = 'Lock'
      ) AS blocked
    `;
    if (rows[0]?.blocked === true) return;
    await delay(25);
  }
  throw new Error(`Connection ${applicationName} never blocked on the command-first lock barrier`);
}

export interface DomainState {
  version: string;
  status: string;
  commitmentDeadline: string | null;
  commitmentStatus: string | null;
  payloadRef: string | null;
}

export async function readDomainState(admin: postgres.Sql): Promise<DomainState> {
  const rows = await admin<DomainState[]>`
    SELECT
      version::text AS version,
      status,
      commitment_deadline::text AS "commitmentDeadline",
      commitment_status AS "commitmentStatus",
      payload_ref AS "payloadRef"
    FROM continuity.cases
    WHERE namespace_id = ${fixture.namespaceId}
      AND case_id = ${fixture.caseId}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("Synthetic case is missing");
  return row;
}

export interface DomainCounts {
  receipts: number;
  acceptedHistory: number;
}

export async function readDomainCounts(admin: postgres.Sql): Promise<DomainCounts> {
  const rows = await admin<DomainCounts[]>`
    SELECT
      (SELECT count(*)::integer FROM continuity.command_receipts
        WHERE namespace_id = ${fixture.namespaceId}) AS receipts,
      (SELECT count(*)::integer FROM continuity.accepted_history
        WHERE namespace_id = ${fixture.namespaceId}) AS "acceptedHistory"
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("Domain count query returned no row");
  return row;
}

export async function readGrant(admin: postgres.Sql): Promise<{ version: string; isRevoked: boolean }> {
  const rows = await admin<{ version: string; isRevoked: boolean }[]>`
    SELECT version::text AS version, is_revoked AS "isRevoked"
    FROM continuity.authorization_grants
    WHERE namespace_id = ${fixture.namespaceId}
      AND authorization_grant_id = ${fixture.authorizationGrantId}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("Synthetic authorization grant is missing");
  return row;
}

export function unsupportedRequestVersion(version: number): ResolveCaseRequest {
  return { ...completedRequest, requestHashSchemaVersion: version };
}

export function hashRequest(request: ResolveCaseRequest): string {
  return canonicalHash(request);
}
