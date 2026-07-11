import { setTimeout as delay } from "node:timers/promises";

import { afterAll, describe, expect, it } from "vitest";

import { canonicalHash } from "../src/domain/canonical.js";
import { buildCommitInput } from "../src/domain/request.js";
import {
  barrierCommit,
  cancelledRequest,
  completedProjection,
  completedProjectionDigest,
  completedRequest,
  createAdminSql,
  createAppSql,
  deferred,
  expectSqlState,
  fixture,
  hashRequest,
  invokeCommit,
  readDomainCounts,
  readDomainState,
  readGrant,
  requestHashes,
  resetSyntheticFixture,
  revokeGrant,
  serializableCommit,
  unsupportedRequestVersion,
  waitForApplicationLock,
  type CommitResult,
  type ResolveCaseRequest,
} from "./db-fixture.js";

const admin = createAdminSql("continuity-kernel-test-admin");
const appOne = createAppSql("continuity-kernel-test-app-one");
const appTwo = createAppSql("continuity-kernel-test-app-two");
const revokerName = "continuity-kernel-test-revoker";
const revoker = createAdminSql(revokerName);

afterAll(async () => {
  await Promise.all([admin.end(), appOne.end(), appTwo.end(), revoker.end()]);
});

function expectAccepted(result: CommitResult, commandId: string): void {
  expect(result).toMatchObject({
    status: "accepted",
    code: "ACCEPTED",
    namespaceId: fixture.namespaceId,
    caseId: fixture.caseId,
    commandId,
    authorizationVersion: "7",
    caseVersion: "4",
    payloadRef: fixture.payloadRef,
    projectionSchemaVersion: 1,
  });
}

function expectRejected(result: CommitResult, code: string): void {
  expect(result).toMatchObject({
    status: "rejected",
    code,
    namespaceId: fixture.namespaceId,
    caseId: fixture.caseId,
  });
}

async function expectPriorState(): Promise<void> {
  const state = await readDomainState(admin);
  expect(state).toEqual({
    version: "3",
    status: "open",
    commitmentDeadline: null,
    commitmentStatus: null,
    payloadRef: null,
  });
  expect((await readDomainCounts(admin)).acceptedHistory).toBe(0);
}

async function concurrentCommits(
  first: { commandId: string; requestHash: string; request: ResolveCaseRequest },
  second: { commandId: string; requestHash: string; request: ResolveCaseRequest },
) {
  const firstReady = deferred<undefined>();
  const secondReady = deferred<undefined>();
  const release = deferred<undefined>();
  const firstCommit = barrierCommit(
    appOne,
    firstReady,
    release.promise,
    first.commandId,
    first.requestHash,
    first.request,
  );
  const secondCommit = barrierCommit(
    appTwo,
    secondReady,
    release.promise,
    second.commandId,
    second.requestHash,
    second.request,
  );
  await Promise.all([firstReady.promise, secondReady.promise]);
  release.resolve(undefined);
  return Promise.all([firstCommit, secondCommit]);
}

const canonicalTables = [
  "authorization_grants",
  "cases",
  "command_receipts",
  "accepted_history",
  "decision_audit",
] as const;

const forbiddenDml = canonicalTables.flatMap((table) => [
  { name: `INSERT continuity.${table}`, sql: `INSERT INTO continuity.${table} DEFAULT VALUES` },
  { name: `UPDATE continuity.${table}`, sql: `UPDATE continuity.${table} SET namespace_id = namespace_id WHERE false` },
  { name: `DELETE continuity.${table}`, sql: `DELETE FROM continuity.${table} WHERE false` },
  { name: `TRUNCATE continuity.${table}`, sql: `TRUNCATE TABLE continuity.${table}` },
]);

describe.sequential("frozen direct-PostgreSQL canonical core", () => {
  it.each(forbiddenDml)("denies app direct $name", async ({ sql }) => {
    await expectSqlState(async () => {
      await appOne.unsafe(sql);
    }, "42501");
  });

  it("denies transaction-local SET ROLE continuity_owner without session residue", async () => {
    await expectSqlState(async () => {
      await appOne.begin(async (sql) => {
        await sql.unsafe("SET LOCAL ROLE continuity_owner");
      });
    }, "42501");
    const rows = await appOne<{ currentUser: string; sessionUser: string }[]>`
      SELECT current_user AS "currentUser", session_user AS "sessionUser"
    `;
    expect(rows[0]).toEqual({ currentUser: "continuity_app", sessionUser: "continuity_app" });
  });

  it("GateD privileges keep canonical objects owned by continuity_owner", async () => {
    const database = await admin<{ owner: string }[]>`
      SELECT pg_catalog.pg_get_userbyid(datdba) AS owner
      FROM pg_catalog.pg_database WHERE datname = current_database()
    `;
    const schema = await admin<{ owner: string }[]>`
      SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner
      FROM pg_catalog.pg_namespace WHERE nspname = 'continuity'
    `;
    const relations = await admin<{ name: string; kind: string; owner: string }[]>`
      SELECT c.relname AS name, c.relkind::text AS kind,
        pg_catalog.pg_get_userbyid(c.relowner) AS owner
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'continuity' AND c.relkind IN ('r', 'S', 'i')
      ORDER BY c.relname
    `;
    const functions = await admin<{ identity: string; owner: string }[]>`
      SELECT p.oid::regprocedure::text AS identity,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'continuity'
      ORDER BY identity
    `;

    expect(database).toEqual([{ owner: "continuity_owner" }]);
    expect(schema).toEqual([{ owner: "continuity_owner" }]);
    expect(relations.length).toBeGreaterThan(6);
    expect(relations.every(({ owner }) => owner === "continuity_owner")).toBe(true);
    expect(relations.filter(({ kind }) => kind !== "i").map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: "accepted_history", kind: "r" },
      { name: "authorization_grants", kind: "r" },
      { name: "cases", kind: "r" },
      { name: "command_receipts", kind: "r" },
      { name: "decision_audit", kind: "r" },
      { name: "decision_audit_audit_id_seq", kind: "S" },
    ]);
    expect(functions).toEqual([{
      identity: "continuity.commit_command(text,text,jsonb,integer,integer)",
      owner: "continuity_owner",
    }]);
  }, 120_000);

  it("GateD privileges deny continuity_app ownership, owner-role membership, direct DML/truncate/read, and role escalation", async () => {
    const role = await admin<{
      canLogin: boolean; superuser: boolean; createRole: boolean; createDb: boolean;
      inherit: boolean; replication: boolean; bypassRls: boolean; ownerMember: boolean;
    }[]>`
      SELECT r.rolcanlogin AS "canLogin", r.rolsuper AS superuser,
        r.rolcreaterole AS "createRole", r.rolcreatedb AS "createDb", r.rolinherit AS inherit,
        r.rolreplication AS replication, r.rolbypassrls AS "bypassRls",
        pg_catalog.pg_has_role('continuity_app', 'continuity_owner', 'MEMBER') AS "ownerMember"
      FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'continuity_app'
    `;
    const ownership = await admin<{ owned: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'continuity'
          AND pg_catalog.pg_get_userbyid(c.relowner) = 'continuity_app'
        UNION ALL
        SELECT 1 FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'continuity'
          AND pg_catalog.pg_get_userbyid(p.proowner) = 'continuity_app'
      ) AS owned
    `;
    const tablePrivileges = await admin<{
      tableName: string; select: boolean; insert: boolean; update: boolean;
      delete: boolean; truncate: boolean; references: boolean; trigger: boolean;
    }[]>`
      SELECT c.relname AS "tableName",
        pg_catalog.has_table_privilege('continuity_app', c.oid, 'SELECT') AS select,
        pg_catalog.has_table_privilege('continuity_app', c.oid, 'INSERT') AS insert,
        pg_catalog.has_table_privilege('continuity_app', c.oid, 'UPDATE') AS update,
        pg_catalog.has_table_privilege('continuity_app', c.oid, 'DELETE') AS delete,
        pg_catalog.has_table_privilege('continuity_app', c.oid, 'TRUNCATE') AS truncate,
        pg_catalog.has_table_privilege('continuity_app', c.oid, 'REFERENCES') AS references,
        pg_catalog.has_table_privilege('continuity_app', c.oid, 'TRIGGER') AS trigger
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'continuity' AND c.relkind = 'r'
      ORDER BY c.relname
    `;

    expect(role).toEqual([{
      canLogin: true, superuser: false, createRole: false, createDb: false,
      inherit: false, replication: false, bypassRls: false, ownerMember: false,
    }]);
    expect(ownership).toEqual([{ owned: false }]);
    expect(tablePrivileges.map(({ tableName }) => tableName)).toEqual([...canonicalTables].sort());
    for (const privileges of tablePrivileges) {
      expect([
        privileges.select, privileges.insert, privileges.update, privileges.delete,
        privileges.truncate, privileges.references, privileges.trigger,
      ].some(Boolean)).toBe(false);
    }
    for (const table of canonicalTables) {
      await expectSqlState(async () => {
        await appTwo.begin(async (sql) => {
          await sql.unsafe(`SELECT * FROM continuity.${table} LIMIT 0`);
        });
      }, "42501");
    }
  }, 120_000);

  it("GateD privileges revoke PUBLIC execution while continuity_app retains only approved function execution", async () => {
    const functions = await admin<{
      identity: string; owner: string; securityDefiner: boolean; appExecute: boolean;
      publicExecute: boolean; appDirectExecute: boolean; settings: string[];
    }[]>`
      SELECT p.oid::regprocedure::text AS identity,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS "securityDefiner",
        pg_catalog.has_function_privilege('continuity_app', p.oid, 'EXECUTE') AS "appExecute",
        EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) AS "publicExecute",
        EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
          JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
          WHERE grantee.rolname = 'continuity_app' AND acl.privilege_type = 'EXECUTE'
            AND acl.is_grantable = false
        ) AS "appDirectExecute",
        COALESCE(p.proconfig, ARRAY[]::text[]) AS settings
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'continuity'
      ORDER BY identity
    `;
    const schemaPrivileges = await admin<{ usage: boolean; create: boolean }[]>`
      SELECT pg_catalog.has_schema_privilege('continuity_app', 'continuity', 'USAGE') AS usage,
        pg_catalog.has_schema_privilege('continuity_app', 'continuity', 'CREATE') AS create
    `;
    const sequencePrivileges = await admin<{ usage: boolean; select: boolean; update: boolean }[]>`
      SELECT pg_catalog.has_sequence_privilege(
          'continuity_app', 'continuity.decision_audit_audit_id_seq', 'USAGE'
        ) AS usage,
        pg_catalog.has_sequence_privilege(
          'continuity_app', 'continuity.decision_audit_audit_id_seq', 'SELECT'
        ) AS select,
        pg_catalog.has_sequence_privilege(
          'continuity_app', 'continuity.decision_audit_audit_id_seq', 'UPDATE'
        ) AS update
    `;

    expect(functions).toEqual([{
      identity: "continuity.commit_command(text,text,jsonb,integer,integer)",
      owner: "continuity_owner", securityDefiner: true, appExecute: true,
      publicExecute: false, appDirectExecute: true, settings: ["search_path=pg_catalog"],
    }]);
    expect(schemaPrivileges).toEqual([{ usage: true, create: false }]);
    expect(sequencePrivileges).toEqual([{ usage: false, select: false, update: false }]);

    await resetSyntheticFixture(admin);
    const rollbackMarker = new Error("rollback approved-function privilege probe");
    let observed: unknown;
    try {
      await admin.begin("isolation level serializable", async (sql) => {
        await sql.unsafe("SET LOCAL ROLE continuity_app");
        const users = await sql<{ currentUser: string; sessionUser: string }[]>`
          SELECT current_user AS "currentUser", session_user AS "sessionUser"
        `;
        expect(users[0]).toEqual({ currentUser: "continuity_app", sessionUser: "postgres" });
        expectAccepted(await invokeCommit(
          sql,
          "cmd:test:privilege-approved-function-001",
          requestHashes.completed,
          completedRequest,
        ), "cmd:test:privilege-approved-function-001");
        throw rollbackMarker;
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(rollbackMarker);
    await expectPriorState();
    expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
  }, 120_000);

  it("accepts one authorized canonical commit", async () => {
    await resetSyntheticFixture(admin);
    const commandId = "cmd:test:authorized-001";
    const { result } = await serializableCommit(
      appOne,
      commandId,
      requestHashes.completed,
      completedRequest,
    );

    expectAccepted(result, commandId);
    expect(result.requestHash).toBe(requestHashes.completed);
    expect(await readDomainState(admin)).toEqual({
      version: "4",
      status: "resolved",
      commitmentDeadline: "2026-07-11 12:00:00+00",
      commitmentStatus: "completed",
      payloadRef: fixture.payloadRef,
    });
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
  });

  it("returns one stored outcome for concurrent same-ID same-hash commands", async () => {
    await resetSyntheticFixture(admin);
    const commandId = "cmd:test:resolve-001";
    const attempts = await concurrentCommits(
      { commandId, requestHash: requestHashes.completed, request: completedRequest },
      { commandId, requestHash: requestHashes.completed, request: completedRequest },
    );

    expect(attempts[0].result).toEqual(attempts[1].result);
    expectAccepted(attempts[0].result, commandId);
    expect(attempts.every(({ attempts: count }) => count >= 1)).toBe(true);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect((await readDomainState(admin)).version).toBe("4");
  });

  it("rejects same-ID different-hash reuse without a second transition", async () => {
    await resetSyntheticFixture(admin);
    const commandId = "cmd:test:resolve-001";
    const accepted = await serializableCommit(
      appOne,
      commandId,
      requestHashes.completed,
      completedRequest,
    );
    const mismatched = await serializableCommit(
      appTwo,
      commandId,
      requestHashes.cancelled,
      cancelledRequest,
    );
    const replay = await serializableCommit(
      appOne,
      commandId,
      requestHashes.completed,
      completedRequest,
    );

    expectAccepted(accepted.result, commandId);
    expectRejected(mismatched.result, "IDEMPOTENCY_KEY_REUSED");
    expect(replay.result).toEqual(accepted.result);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect((await readDomainState(admin)).commitmentStatus).toBe("completed");
  });

  it("linearizes distinct IDs racing on expected version 3", async () => {
    await resetSyntheticFixture(admin);
    const completedId = "cmd:test:race-completed-001";
    const cancelledId = "cmd:test:race-cancelled-001";
    const attempts = await concurrentCommits(
      { commandId: completedId, requestHash: requestHashes.completed, request: completedRequest },
      { commandId: cancelledId, requestHash: requestHashes.cancelled, request: cancelledRequest },
    );
    const accepted = attempts.find(({ result }) => result.status === "accepted");
    const rejected = attempts.find(({ result }) => result.status === "rejected");

    expect(accepted).toBeDefined();
    expect(rejected).toBeDefined();
    if (accepted === undefined || rejected === undefined) throw new Error("Race did not return one outcome of each kind");
    expectAccepted(accepted.result, accepted.result.commandId);
    expectRejected(rejected.result, "EXPECTED_VERSION_CONFLICT");
    expect([completedId, cancelledId]).toContain(accepted.result.commandId);
    const expectedStatus = accepted.result.commandId === completedId ? "completed" : "cancelled";
    expect((await readDomainState(admin)).commitmentStatus).toBe(expectedStatus);
    expect((await readDomainState(admin)).version).toBe("4");
    expect((await readDomainCounts(admin)).acceptedHistory).toBe(1);
    expect(attempts.every(({ attempts: count }) => Number.isInteger(count) && count >= 1)).toBe(true);
  }, 10_000);

  it("rejects when revocation version 8 commits before validation", async () => {
    await resetSyntheticFixture(admin);
    await revokeGrant(revoker);
    const { result } = await serializableCommit(
      appOne,
      "cmd:test:revocation-first-001",
      requestHashes.completed,
      completedRequest,
    );

    expect(result.status).toBe("rejected");
    expect(["AUTHORIZATION_REVOKED", "AUTHORIZATION_VERSION_CONFLICT"]).toContain(result.code);
    expect(await readGrant(admin)).toEqual({ version: "8", isRevoked: true });
    await expectPriorState();
  });

  it("commits command-first while revocation waits on its grant lock", async () => {
    await resetSyntheticFixture(admin);
    const commandId = "cmd:test:command-first-001";
    const validated = deferred<CommitResult>();
    const releaseCommand = deferred<undefined>();
    const command = appOne.begin("isolation level serializable", async (sql) => {
      const result = await invokeCommit(
        sql,
        commandId,
        requestHashes.completed,
        completedRequest,
      );
      validated.resolve(result);
      await releaseCommand.promise;
      return result;
    });
    void command.catch((error: unknown) => {
      validated.reject(error);
    });

    const stagedResult = await validated.promise;
    const revocation = revokeGrant(revoker);
    try {
      await waitForApplicationLock(admin, revokerName);
    } finally {
      releaseCommand.resolve(undefined);
    }
    const [committedResult] = await Promise.all([command, revocation]);

    expectAccepted(stagedResult, commandId);
    expect(committedResult).toEqual(stagedResult);
    expect(await readGrant(admin)).toEqual({ version: "8", isRevoked: true });
    expect((await readDomainState(admin)).version).toBe("4");
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
  }, 10_000);

  it("rolls back state, receipt, and history with the enclosing transaction", async () => {
    await resetSyntheticFixture(admin);
    const rollbackMarker = new Error("intentional test rollback");
    let observed: unknown;
    try {
      await appOne.begin("isolation level serializable", async (sql) => {
        const result = await invokeCommit(
          sql,
          "cmd:test:rollback-001",
          requestHashes.completed,
          completedRequest,
        );
        expectAccepted(result, "cmd:test:rollback-001");
        throw rollbackMarker;
      });
    } catch (error) {
      observed = error;
    }

    expect(observed).toBe(rollbackMarker);
    await expectPriorState();
    expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
  });

  it("returns the exact frozen projection and projection hash", async () => {
    await resetSyntheticFixture(admin);
    const { result } = await serializableCommit(
      appOne,
      "cmd:test:projection-001",
      requestHashes.completed,
      completedRequest,
    );

    expectAccepted(result, "cmd:test:projection-001");
    expect(result.projection).toEqual(completedProjection);
    expect(result.projectionDigest).toBe(completedProjectionDigest);
    expect(canonicalHash(result.projection)).toBe(completedProjectionDigest);
  });

  it("GateD invariant 8 maps root-command causation and case correlation to durable fields", async () => {
    await resetSyntheticFixture(admin);
    const commandId = "cmd:test:invariant-8-root-001";
    const { result } = await serializableCommit(
      appOne,
      commandId,
      requestHashes.completed,
      completedRequest,
    );
    const rows = await admin<{
      commandId: string; requestHash: string; namespaceId: string; caseId: string;
      actorId: string; authorizationGrantId: string; authorizationVersion: string;
      validatorVersion: number; position: string; resultingNamespaceId: string;
      resultingCaseId: string; resultingVersion: string; resultingStatus: string;
      receiptResult: CommitResult;
    }[]>`
      SELECT h.command_id AS "commandId", h.request_hash AS "requestHash",
        h.namespace_id AS "namespaceId", h.case_id AS "caseId", h.actor_id AS "actorId",
        h.authorization_grant_id AS "authorizationGrantId",
        h.authorization_version::text AS "authorizationVersion",
        h.validator_version AS "validatorVersion", h.position::text AS position,
        c.namespace_id AS "resultingNamespaceId", c.case_id AS "resultingCaseId",
        c.version::text AS "resultingVersion", c.status AS "resultingStatus",
        r.result AS "receiptResult"
      FROM continuity.accepted_history AS h
      JOIN continuity.command_receipts AS r
        ON r.namespace_id = h.namespace_id AND r.command_id = h.command_id
      JOIN continuity.cases AS c
        ON c.namespace_id = h.namespace_id AND c.case_id = h.case_id
      WHERE h.namespace_id = ${fixture.namespaceId} AND h.command_id = ${commandId}
    `;
    const row = rows[0];
    if (row === undefined) throw new Error("Invariant 8 durable mapping is missing");
    const { projectionDigest, ...durableResult } = result;
    expect(projectionDigest).toBe(completedProjectionDigest);

    expect({ commandId: row.commandId, requestHash: row.requestHash }).toEqual({
      commandId,
      requestHash: requestHashes.completed,
    });
    expect({ namespaceId: row.namespaceId, caseId: row.caseId }).toEqual({
      namespaceId: fixture.namespaceId,
      caseId: fixture.caseId,
    });
    expect({
      actorId: row.actorId,
      authorizationGrantId: row.authorizationGrantId,
      authorizationVersion: row.authorizationVersion,
      validatorVersion: row.validatorVersion,
      position: row.position,
      resultingRecord: {
        namespaceId: row.resultingNamespaceId,
        caseId: row.resultingCaseId,
        version: row.resultingVersion,
        status: row.resultingStatus,
        receipt: row.receiptResult,
      },
    }).toEqual({
      actorId: fixture.ownerAgentId,
      authorizationGrantId: fixture.authorizationGrantId,
      authorizationVersion: fixture.authorizationVersion,
      validatorVersion: 1,
      position: "4",
      resultingRecord: {
        namespaceId: fixture.namespaceId,
        caseId: fixture.caseId,
        version: "4",
        status: "resolved",
        receipt: durableResult,
      },
    });
  }, 120_000);

  it("GateD invariant 9 distinguishes semantic world time, canonical ingestion sample, and non-authoritative operational clock", async () => {
    const clockMicros = async (): Promise<bigint> => {
      const rows = await admin<{ value: string }[]>`
        SELECT pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()) * 1000000)::bigint::text AS value
      `;
      const value = rows[0]?.value;
      if (value === undefined) throw new Error("PostgreSQL clock sample is missing");
      return BigInt(value);
    };
    const commitAndRead = async (commandId: string) => {
      await resetSyntheticFixture(admin);
      const before = await clockMicros();
      const { result } = await serializableCommit(
        appOne,
        commandId,
        requestHashes.completed,
        completedRequest,
      );
      const after = await clockMicros();
      const times = await admin<{
        historyWorldTime: string; receiptWorldTime: string;
        historyIngestionMicros: string; receiptIngestionMicros: string;
        historyRequestHash: string; receiptRequestHash: string;
      }[]>`
        SELECT
          pg_catalog.to_char(h.world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "historyWorldTime",
          pg_catalog.to_char(r.world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "receiptWorldTime",
          pg_catalog.floor(EXTRACT(EPOCH FROM h.ingestion_time) * 1000000)::bigint::text AS "historyIngestionMicros",
          pg_catalog.floor(EXTRACT(EPOCH FROM r.ingestion_time) * 1000000)::bigint::text AS "receiptIngestionMicros",
          h.request_hash AS "historyRequestHash", r.request_hash AS "receiptRequestHash"
        FROM continuity.accepted_history AS h
        JOIN continuity.command_receipts AS r
          ON r.namespace_id = h.namespace_id AND r.command_id = h.command_id
        WHERE h.namespace_id = ${fixture.namespaceId} AND h.command_id = ${commandId}
      `;
      const time = times[0];
      if (time === undefined) throw new Error("Invariant 9 durable clock evidence is missing");
      const ingestion = BigInt(time.historyIngestionMicros);
      expect(time).toMatchObject({
        historyWorldTime: fixture.worldTime,
        receiptWorldTime: fixture.worldTime,
        historyRequestHash: requestHashes.completed,
        receiptRequestHash: requestHashes.completed,
        receiptIngestionMicros: time.historyIngestionMicros,
      });
      expect(ingestion >= before && ingestion <= after).toBe(true);
      return { result, state: await readDomainState(admin), ingestion };
    };

    expect(Object.keys(completedRequest).sort()).toEqual([
      "actionPayload", "actionType", "actorId", "authorizationGrantId", "authorizationVersion",
      "caseId", "expectedCaseVersion", "namespaceId", "requestHashSchemaVersion", "worldTime",
    ]);
    expect(Object.keys(completedRequest.actionPayload).sort()).toEqual([
      "commitmentDeadline", "payloadRef", "resolution",
    ]);
    for (const field of ["operationalClock", "randomness", "modelOutput", "externalObservation"]) {
      expect(() => buildCommitInput(
        "cmd:test:invariant-9-schema-001",
        { ...completedRequest, [field]: "synthetic-prohibited-input" },
      )).toThrowError("INVALID_REQUEST_SCHEMA");
    }
    expect(canonicalHash(completedRequest)).toBe(requestHashes.completed);
    expect(canonicalHash({ ...completedRequest, worldTime: "2026-07-11T10:00:01Z" }))
      .not.toBe(requestHashes.completed);

    const first = await commitAndRead("cmd:test:invariant-9-first-001");
    await delay(50);
    const second = await commitAndRead("cmd:test:invariant-9-second-001");
    const expectedState = {
      version: "4", status: "resolved", commitmentDeadline: "2026-07-11 12:00:00+00",
      commitmentStatus: "completed", payloadRef: fixture.payloadRef,
    };

    expect(first.ingestion < second.ingestion).toBe(true);
    expect(first.state).toEqual(expectedState);
    expect(second.state).toEqual(expectedState);
    for (const outcome of [first.result, second.result]) {
      expect(outcome.requestHash).toBe(requestHashes.completed);
      expect(outcome.projection).toEqual(completedProjection);
      expect(outcome.projectionDigest).toBe(completedProjectionDigest);
      expect(canonicalHash(outcome.projection)).toBe(completedProjectionDigest);
      expect(Object.hasOwn(outcome, "worldTime")).toBe(false);
      expect(Object.hasOwn(outcome, "ingestionTime")).toBe(false);
      expect(Object.hasOwn(outcome, "operationalClock")).toBe(false);
      expect(Object.hasOwn(outcome, "randomness")).toBe(false);
      expect(Object.hasOwn(outcome, "modelOutput")).toBe(false);
      expect(Object.hasOwn(outcome, "externalObservation")).toBe(false);
    }
    expect(canonicalHash(completedRequest)).toBe(requestHashes.completed);
    expect(canonicalHash(completedProjection)).toBe(completedProjectionDigest);
  }, 120_000);

  it("fails closed on an unsupported request-hash schema version", async () => {
    await resetSyntheticFixture(admin);
    const request = unsupportedRequestVersion(2);
    const { result } = await serializableCommit(
      appOne,
      "cmd:test:unsupported-request-version-001",
      hashRequest(request),
      request,
    );

    expectRejected(result, "UNSUPPORTED_REQUEST_HASH_SCHEMA_VERSION");
    await expectPriorState();
  });

  it("fails closed on an unsupported projection schema version", async () => {
    await resetSyntheticFixture(admin);
    const { result } = await serializableCommit(
      appOne,
      "cmd:test:unsupported-projection-version-001",
      requestHashes.completed,
      completedRequest,
      { projectionSchemaVersion: 2 },
    );

    expectRejected(result, "UNSUPPORTED_PROJECTION_SCHEMA_VERSION");
    await expectPriorState();
  });

  it("fails closed on an unsupported validator version", async () => {
    await resetSyntheticFixture(admin);
    const { result } = await serializableCommit(
      appOne,
      "cmd:test:unsupported-validator-version-001",
      requestHashes.completed,
      completedRequest,
      { validatorVersion: 2 },
    );

    expectRejected(result, "UNSUPPORTED_VALIDATOR_VERSION");
    await expectPriorState();
  });
});
