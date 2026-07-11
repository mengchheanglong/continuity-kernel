import { afterAll, describe, expect, it } from "vitest";

import { canonicalHash } from "../src/domain/canonical.js";
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

  it("denies SET ROLE continuity_owner", async () => {
    await expectSqlState(async () => {
      await appOne.unsafe("SET ROLE continuity_owner");
    }, "42501");
    const rows = await appOne<{ currentUser: string }[]>`
      SELECT current_user AS "currentUser"
    `;
    expect(rows[0]?.currentUser).toBe("continuity_app");
  });

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
