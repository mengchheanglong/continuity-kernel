import { execFile, fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { submitCommand as submitRestateCommand } from "../src/alternative/restate/client.js";
import { canonicalHash } from "../src/domain/canonical.js";
import { buildCommitInput } from "../src/domain/request.js";
import {
  cancelledRequest,
  completedProjection,
  completedProjectionDigest,
  completedRequest,
  createAdminSql,
  fixture,
  readDomainCounts,
  readDomainState,
  readGrant,
  requestHashes,
  resetSyntheticFixture,
  revokeGrant,
} from "./db-fixture.js";

interface WorkerMessage { type: string; phase?: string; vector?: string; count?: number; error?: string }
interface Worker { child: ChildProcess; logs: string[]; messages: WorkerMessage[] }
type SubmitterMessage =
  | { type: "submitted"; invocationId: string }
  | { type: "terminal"; status: string; code: string };
interface Submitter { child: ChildProcess; messages: SubmitterMessage[]; invalidMessage: boolean }
interface AdvisoryIdentity { database: string; classid: string; objid: string; objsubid: number }
interface AdvisoryLock extends AdvisoryIdentity { pid: number; mode: string; granted: boolean }
interface DecisionAudit {
  commandId: string; requestHash: string; actorId: string; authorizationGrantId: string;
  authorizationVersion: string; validatorVersion: number; decisionCode: string; payloadRef: string | null;
}
interface RestateVersionInfo {
  version: string; min_admin_api_version: number; max_admin_api_version: number;
}
interface RestateServiceInfo {
  name: string; ty: string; deployment_id: string; revision: number; public: boolean;
  handlers: { name: string; ty: string; public: boolean }[];
}
interface RestateDeploymentInfo {
  id: string; uri: string; protocol_type: string; http_version: string;
  min_protocol_version: number; max_protocol_version: number; sdk_version: string;
  services: { name: string; revision: number }[];
}
interface LogicalTextColumn { tableSchema: string; tableName: string; columnName: string }

const admin = createAdminSql("continuity-kernel-gate-d-parent");
const workers = new Set<Worker>();
const submitters = new Set<Submitter>();
const id = (label: string) => `gate-d:foundation:${label}:${randomUUID()}`;

beforeEach(() => resetSyntheticFixture(admin), 30_000);
afterEach(async () => {
  for (const submitter of [...submitters]) await killSubmitter(submitter);
  for (const worker of [...workers]) await kill(worker);
}, 60_000);
afterAll(() => admin.end());

function spawnWorker(failpoint?: string): Worker {
  const child = fork(new URL("./restate-worker.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: { ...process.env, CK_FAILPOINT: failpoint },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const worker: Worker = { child, logs: [], messages: [] };
  child.stdout?.on("data", (chunk: Buffer) => worker.logs.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => worker.logs.push(chunk.toString()));
  child.on("message", (value: unknown) => worker.messages.push(value as WorkerMessage));
  workers.add(worker);
  return worker;
}

function isSubmitterMessage(value: unknown): value is SubmitterMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  const keys = Object.keys(message).sort();
  return message.type === "submitted"
    ? typeof message.invocationId === "string" && keys.join() === "invocationId,type"
    : message.type === "terminal" && typeof message.status === "string" && typeof message.code === "string"
      && keys.join() === "code,status,type";
}

function spawnSubmitter(
  commandId: string,
  workflowId: string,
  requestName: "completed" | "cancelled" = "completed",
): Submitter {
  const child = fork(new URL("./restate-submitter.ts", import.meta.url), [commandId, workflowId, requestName], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: { ...process.env },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const submitter: Submitter = { child, messages: [], invalidMessage: false };
  child.on("message", (value: unknown) => {
    if (isSubmitterMessage(value)) submitter.messages.push(value);
    else submitter.invalidMessage = true;
  });
  submitters.add(submitter);
  return submitter;
}

async function waitSubmitterMessage<T extends SubmitterMessage["type"]>(
  submitter: Submitter,
  type: T,
): Promise<Extract<SubmitterMessage, { type: T }>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (submitter.invalidMessage) throw new Error("Submitter sent an invalid IPC message");
    const index = submitter.messages.findIndex((message) => message.type === type);
    if (index >= 0) {
      const message = submitter.messages.splice(index, 1)[0] as Extract<SubmitterMessage, { type: T }>;
      expect(Object.keys(message).sort()).toEqual(type === "submitted"
        ? ["invocationId", "type"] : ["code", "status", "type"]);
      return message;
    }
    if (submitter.child.exitCode !== null) throw new Error(`Submitter exited ${String(submitter.child.exitCode)}`);
    await delay(10);
  }
  throw new Error(`Submitter ${type} message timeout`);
}

async function killSubmitter(submitter: Submitter): Promise<void> {
  submitters.delete(submitter);
  if (submitter.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => submitter.child.once("exit", () => { resolve(); }));
  submitter.child.kill("SIGKILL");
  await exited;
}

async function waitMessage(worker: Worker, match: (message: WorkerMessage) => boolean): Promise<WorkerMessage> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const error = worker.messages.find((message) => message.type === "error");
    if (error !== undefined) throw new Error(error.error ?? "Worker failed");
    const index = worker.messages.findIndex(match);
    if (index >= 0) return worker.messages.splice(index, 1)[0] as WorkerMessage;
    if (worker.child.exitCode !== null) throw new Error(`Worker exited ${String(worker.child.exitCode)}; logs: ${worker.logs.join("")}`);
    await delay(10);
  }
  throw new Error(`Worker message timeout; logs: ${worker.logs.join("")}`);
}

async function kill(worker: Worker): Promise<void> {
  workers.delete(worker);
  if (worker.child.exitCode === null) {
    const exited = new Promise<void>((resolve) => {
      worker.child.once("exit", () => {
        resolve();
      });
    });
    worker.child.kill("SIGKILL");
    await exited;
  }
  await waitForDatasourceExit();
}

async function waitForDatasourceExit(): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const rows = await admin<{ connected: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE application_name='continuity-kernel-restate') AS connected
    `;
    if (rows[0]?.connected === false) return;
    await delay(25);
  }
  throw new Error("Restate datasource backend remained after worker exit");
}

async function registerDeployment(): Promise<void> {
  const response = await fetch("http://127.0.0.1:9070/deployments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: process.env.CK_RESTATE_DEPLOYMENT_URI ?? "http://host.docker.internal:9080", force: true }),
  });
  if (!response.ok) throw new Error(`Deployment registration failed (${String(response.status)}): ${await response.text()}`);
}

async function queryRestate(query: string): Promise<{ rows: Record<string, unknown>[] }> {
  const response = await fetch("http://127.0.0.1:9070/query", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Restate query failed (${String(response.status)}): ${await response.text()}`);
  return await response.json() as { rows: Record<string, unknown>[] };
}

async function readRestateAdmin<T>(path: string): Promise<T> {
  const response = await fetch(`http://127.0.0.1:9070${path}`);
  if (!response.ok) throw new Error(`Restate Admin read failed (${String(response.status)})`);
  return await response.json() as T;
}

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function readLogicalApplicationText(): Promise<string[]> {
  const columns = await admin<LogicalTextColumn[]>`
    SELECT c.table_schema AS "tableSchema", c.table_name AS "tableName",
      c.column_name AS "columnName"
    FROM information_schema.columns AS c
    JOIN information_schema.tables AS t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE t.table_type = 'BASE TABLE'
      AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND c.table_schema NOT LIKE 'pg_toast%'
      AND NOT (c.table_schema = 'deletable_payload' AND c.table_name = 'objects')
      AND c.data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
    ORDER BY c.table_schema, c.table_name, c.ordinal_position
  `;
  const values: string[] = [];
  for (const column of columns) {
    const schema = quoteIdentifier(column.tableSchema);
    const table = quoteIdentifier(column.tableName);
    const name = quoteIdentifier(column.columnName);
    const rows = await admin.unsafe<{ value: string }[]>(
      `SELECT ${name}::text AS value FROM ${schema}.${table} WHERE ${name} IS NOT NULL`,
    );
    for (const row of rows) values.push(row.value);
  }
  return values;
}

function privatePayloadRepresentations(sentinel: string): string[] {
  const sha256Hex = createHash("sha256").update(sentinel, "utf8").digest("hex");
  const sha256Base64Url = createHash("sha256").update(sentinel, "utf8").digest("base64url");
  return [sentinel, sha256Hex, sha256Base64Url]
    .flatMap((value) => [value, Buffer.from(value, "utf8").toString("hex")])
    .map((value) => value.toLowerCase());
}

function assertNoPrivatePayload(surface: string, values: string[], representations: string[]): void {
  const containsPrivateMaterial = values.some((value) => {
    const normalized = value.toLowerCase();
    return representations.some((representation) => normalized.includes(representation));
  });
  if (containsPrivateMaterial) throw new Error(`${surface} contains forbidden private payload material`);
}

async function readRestateContainerLogs(since: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "docker",
      ["compose", "logs", "--no-color", "--since", since, "restate"],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error("Restate container logs could not be inspected"));
          return;
        }
        resolve(`${stdout}${stderr}`);
      },
    );
  });
}

async function acquireSnapshotBarrier(): Promise<{
  pid: number; identity: AdvisoryIdentity; release: () => Promise<void>;
}> {
  const holder = createAdminSql("continuity-gate-d-snapshot-barrier-parent");
  const connection = await holder.reserve();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try {
      const rows = await connection<{ unlocked: boolean }[]>`
        SELECT pg_catalog.pg_advisory_unlock(
          pg_catalog.hashtextextended('continuity-gate-d-snapshot-barrier', 0)
        ) AS unlocked
      `;
      if (rows[0]?.unlocked !== true) throw new Error("Snapshot barrier parent lock was not held");
    } finally {
      connection.release();
      await holder.end({ timeout: 5 });
    }
  };
  try {
    const pidRows = await connection<{ pid: number }[]>`
      SELECT pg_catalog.pg_backend_pid() AS pid,
        pg_catalog.pg_advisory_lock(
          pg_catalog.hashtextextended('continuity-gate-d-snapshot-barrier', 0)
        )
    `;
    const pid = pidRows[0]?.pid;
    if (pid === undefined) throw new Error("Snapshot barrier parent PID missing");
    const locks = await admin<AdvisoryLock[]>`
      SELECT database::text AS database, classid::text AS classid, objid::text AS objid,
        objsubid, pid, mode, granted
      FROM pg_catalog.pg_locks
      WHERE locktype = 'advisory' AND pid = ${pid}
    `;
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ pid, mode: "ExclusiveLock", granted: true });
    const lock = locks[0];
    if (lock === undefined) throw new Error("Snapshot barrier parent lock missing");
    return {
      pid,
      identity: { database: lock.database, classid: lock.classid, objid: lock.objid, objsubid: lock.objsubid },
      release,
    };
  } catch (error) {
    await release();
    throw error;
  }
}

async function waitForSnapshotWaiters(identity: AdvisoryIdentity, expected: number): Promise<AdvisoryLock[]> {
  const deadline = Date.now() + 30_000;
  let observed: AdvisoryLock[] = [];
  while (Date.now() < deadline) {
    observed = await admin<AdvisoryLock[]>`
      SELECT l.database::text AS database, l.classid::text AS classid, l.objid::text AS objid,
        l.objsubid, l.pid, l.mode, l.granted
      FROM pg_catalog.pg_locks AS l
      JOIN pg_catalog.pg_stat_activity AS a ON a.pid = l.pid
      WHERE l.locktype = 'advisory'
        AND l.database::text = ${identity.database}
        AND l.classid::text = ${identity.classid}
        AND l.objid::text = ${identity.objid}
        AND l.objsubid = ${identity.objsubid}
        AND a.application_name = 'continuity-kernel-restate'
    `;
    if (observed.length === expected
      && new Set(observed.map((row) => row.pid)).size === expected
      && observed.every((row) => row.mode === "ShareLock" && !row.granted)) {
      for (const row of observed) expect(row).toMatchObject({ ...identity, mode: "ShareLock", granted: false });
      return observed;
    }
    await delay(25);
  }
  throw new Error(`Expected ${String(expected)} exact snapshot barrier waiters; observed ${JSON.stringify(observed)}`);
}

async function submitWorkflow(workflowId: string, commandId: string, request: unknown): Promise<string> {
  const response = await fetch(
    `http://127.0.0.1:8080/restate/send/ContinuityCommitT2bV1/${encodeURIComponent(workflowId)}/run`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildCommitInput(commandId, request)),
    },
  );
  if (!response.ok) throw new Error(`Workflow submission failed (${String(response.status)}): ${await response.text()}`);
  const body = await response.json() as { invocationId?: string };
  if (body.invocationId === undefined) throw new Error("Workflow submission returned no invocation ID");
  return body.invocationId;
}

async function attachWorkflow(invocationId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:8080/restate/attach/${encodeURIComponent(invocationId)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Workflow attach failed (${String(response.status)}): ${await response.text()}`);
  return await response.json() as Record<string, unknown>;
}

async function expectAttachedReceipt(invocationId: string, commandId: string): Promise<Record<string, unknown>> {
  const stored = await readStoredReceipt(fixture.namespaceId, commandId);
  const expected = stored.projection === undefined
    ? stored
    : { ...stored, projectionDigest: canonicalHash(stored.projection) };
  const attached = await attachWorkflow(invocationId);
  expect(attached).toEqual(expected);
  return attached;
}

async function readStoredReceipt(namespaceId: string, commandId: string): Promise<Record<string, unknown>> {
  const rows = await admin<{ result: Record<string, unknown> }[]>`
    SELECT result FROM continuity.command_receipts
    WHERE namespace_id = ${namespaceId} AND command_id = ${commandId}
  `;
  if (rows.length !== 1 || rows[0] === undefined) throw new Error("Expected exactly one stored receipt");
  return rows[0].result;
}

async function expectInvocationResults(
  invocationIds: string[], namespaceId: string, commandId: string,
): Promise<Record<string, unknown>> {
  const expected = {
    ...await readStoredReceipt(namespaceId, commandId),
    projectionDigest: completedProjectionDigest,
  };
  for (const invocationId of invocationIds) expect(await attachWorkflow(invocationId)).toEqual(expected);
  return expected;
}

const restateString = (value: string) => `'${value.replaceAll("'", "''")}'`;

async function purgeInvocation(invocationId: string): Promise<void> {
  const literal = restateString(invocationId);
  const beforeInvocation = await queryRestate(`select id, status from sys_invocation where id = ${literal}`);
  const beforeJournal = await queryRestate(`select id from sys_journal where id = ${literal}`);
  expect(beforeInvocation.rows).toEqual([expect.objectContaining({ id: invocationId, status: "completed" })]);
  expect(beforeJournal.rows.length).toBeGreaterThan(0);
  const response = await fetch(
    `http://127.0.0.1:9070/invocations/${encodeURIComponent(invocationId)}/purge`,
    { method: "PATCH" },
  );
  if (response.status !== 200) throw new Error(`Invocation purge failed (${String(response.status)}): ${await response.text()}`);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const invocation = await queryRestate(`select id from sys_invocation where id = ${literal}`);
    const journal = await queryRestate(`select id from sys_journal where id = ${literal}`);
    if (invocation.rows.length === 0 && journal.rows.length === 0) return;
    await delay(25);
  }
  throw new Error("Purged invocation remained in supported Restate introspection");
}

async function requestCancellation(invocationId: string): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:9070/invocations/${encodeURIComponent(invocationId)}/cancel`,
    { method: "PATCH" },
  );
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`Invocation cancellation acknowledgement failed (${String(response.status)})`);
  }
}

async function waitForCanceledInvocation(invocationId: string): Promise<Record<string, unknown>> {
  const literal = restateString(invocationId);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await queryRestate(
      `select status, completion_result, completion_failure from sys_invocation where id = ${literal}`,
    );
    const row = result.rows[0];
    if (row?.status === "completed" && row.completion_result === "failure"
      && row.completion_failure === "[409] Cancelled") return row;
    await delay(25);
  }
  throw new Error("Cancellation-specific Restate terminal state was not confirmed within 10 seconds");
}

async function readDecisionAudits(): Promise<DecisionAudit[]> {
  return await admin<DecisionAudit[]>`
    SELECT command_id AS "commandId", request_hash AS "requestHash", actor_id AS "actorId",
      authorization_grant_id AS "authorizationGrantId", authorization_version AS "authorizationVersion",
      validator_version AS "validatorVersion", decision_code AS "decisionCode", payload_ref AS "payloadRef"
    FROM continuity.decision_audit ORDER BY audit_id
  `;
}

async function expectDirectTerminal(
  label: string,
  mutate: (input: ReturnType<typeof buildCommitInput>) => unknown,
  expectedCode: string,
  forbiddenValues: string[] = [],
): Promise<void> {
  const workflowId = id(label);
  const commandId = id(`${label}-command`);
  const input = mutate(buildCommitInput(commandId, completedRequest));
  const worker = spawnWorker();
  await waitMessage(worker, (message) => message.type === "ready");
  await registerDeployment();

  const response = await fetch(
    `http://127.0.0.1:8080/restate/call/ContinuityCommitT2bV1/${encodeURIComponent(workflowId)}/run`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
  );
  const responseText = await response.text();
  const invocations = await queryRestate(
    `select status, completion_result, completion_failure from sys_invocation where target_service_name = 'ContinuityCommitT2bV1' and target_service_key = '${workflowId}'`,
  );
  const journal = JSON.stringify((await queryRestate(
    `select entry_json from sys_journal where id in (select id from sys_invocation where target_service_name = 'ContinuityCommitT2bV1' and target_service_key = '${workflowId}')`,
  )).rows);
  const failure = String(invocations.rows[0]?.completion_failure);

  expect.soft(response.status).toBe(400);
  expect.soft(responseText).toContain(expectedCode);
  expect.soft(responseText).not.toContain(commandId);
  expect.soft(invocations.rows).toHaveLength(1);
  expect.soft(invocations.rows[0]).toMatchObject({ status: "completed", completion_result: "failure" });
  expect.soft(failure).toContain(expectedCode);
  expect.soft(failure).not.toContain(commandId);
  for (const forbidden of forbiddenValues) {
    expect.soft(responseText).not.toContain(forbidden);
    expect.soft(failure).not.toContain(forbidden);
  }
  expect.soft(journal).not.toContain("canonical commit");
  expect.soft(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
  expect.soft(await readDomainState(admin)).toMatchObject({ version: "3", status: "open", payloadRef: null });
}

describe.sequential("Gate D Restate foundation vectors", () => {
  it("GateD-V1A rejects an out-of-scope actor through Restate", async () => {
    const commandId = id("v1a-out-of-scope-command");
    const request = { ...structuredClone(completedRequest), actorId: fixture.otherAgentId };
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    const result = await submitRestateCommand(commandId, request, id("v1a-out-of-scope-workflow"));

    expect.soft(result).toMatchObject({ status: "rejected", code: "AUTHORIZATION_DENIED", commandId });
    expect.soft(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 0 });
    expect.soft(await readDomainState(admin)).toEqual({
      version: "3", status: "open", commitmentDeadline: null, commitmentStatus: null, payloadRef: null,
    });
    expect.soft(await readDecisionAudits()).toEqual([{
      commandId, requestHash: result.requestHash, actorId: fixture.otherAgentId,
      authorizationGrantId: fixture.authorizationGrantId, authorizationVersion: fixture.authorizationVersion,
      validatorVersion: 1, decisionCode: "AUTHORIZATION_DENIED", payloadRef: fixture.payloadRef,
    }]);
  }, 120_000);

  it("GateD-V1B rejects after grant version 8 commits before Restate validation", async () => {
    const commandId = id("v1b-revocation-first-command");
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();
    await revokeGrant(admin);

    const result = await submitRestateCommand(commandId, completedRequest, id("v1b-revocation-first-workflow"));

    expect.soft(result).toMatchObject({ status: "rejected", commandId });
    expect.soft(["AUTHORIZATION_REVOKED", "AUTHORIZATION_VERSION_CONFLICT"]).toContain(result.code);
    expect.soft(await readGrant(admin)).toEqual({ version: "8", isRevoked: true });
    expect.soft(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 0 });
    expect.soft(await readDomainState(admin)).toEqual({
      version: "3", status: "open", commitmentDeadline: null, commitmentStatus: null, payloadRef: null,
    });
    expect.soft(await readDecisionAudits()).toEqual([{
      commandId, requestHash: result.requestHash, actorId: fixture.ownerAgentId,
      authorizationGrantId: fixture.authorizationGrantId, authorizationVersion: fixture.authorizationVersion,
      validatorVersion: 1, decisionCode: result.code, payloadRef: fixture.payloadRef,
    }]);
  }, 120_000);

  it("GateD-V2A returns one stored receipt for two independent same-hash submitters using the same workflow key", async () => {
    const commandId = id("v2a-same-key-command");
    const workflowId = id("v2a-same-key-workflow");
    const barrier = await acquireSnapshotBarrier();
    let first!: Submitter;
    let second!: Submitter;
    let firstInvocationId!: string;
    let secondInvocationId!: string;
    try {
      const worker = spawnWorker("snapshot_barrier");
      await waitMessage(worker, (message) => message.type === "ready");
      await registerDeployment();
      first = spawnSubmitter(commandId, workflowId);
      firstInvocationId = (await waitSubmitterMessage(first, "submitted")).invocationId;
      const initialWaiters = await waitForSnapshotWaiters(barrier.identity, 1);

      second = spawnSubmitter(commandId, workflowId);
      secondInvocationId = (await waitSubmitterMessage(second, "submitted")).invocationId;
      expect(first.child.pid).toBeDefined();
      expect(second.child.pid).toBeDefined();
      expect(first.child.pid).not.toBe(second.child.pid);
      await delay(50);
      expect(first.messages.some((message) => message.type === "terminal")).toBe(false);
      expect(second.messages.some((message) => message.type === "terminal")).toBe(false);
      expect(first.child.exitCode).toBeNull();
      expect(second.child.exitCode).toBeNull();
      const coalescedWaiters = await waitForSnapshotWaiters(barrier.identity, 1);
      expect(coalescedWaiters[0]?.pid).toBe(initialWaiters[0]?.pid);
      expect((await queryRestate(
        `select id from sys_invocation where target_service_name='ContinuityCommitT2bV1' and target_service_key=${restateString(workflowId)}`,
      )).rows).toHaveLength(1);
      expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
      expect(await readDomainState(admin)).toMatchObject({ version: "3", status: "open" });
    } finally {
      await barrier.release();
    }

    const terminals = await Promise.all([
      waitSubmitterMessage(first, "terminal"),
      waitSubmitterMessage(second, "terminal"),
    ]);
    expect(terminals).toEqual([
      { type: "terminal", status: "accepted", code: "ACCEPTED" },
      { type: "terminal", status: "accepted", code: "ACCEPTED" },
    ]);
    expect(first).toMatchObject({ messages: [], invalidMessage: false });
    expect(second).toMatchObject({ messages: [], invalidMessage: false });
    await expectInvocationResults([firstInvocationId, secondInvocationId], fixture.namespaceId, commandId);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect(await readDomainState(admin)).toMatchObject({ version: "4", status: "resolved" });
  }, 120_000);

  it("GateD-V2A returns one stored receipt for two independent same-hash submitters using distinct workflow keys", async () => {
    const commandId = id("v2a-distinct-key-command");
    const barrier = await acquireSnapshotBarrier();
    let first!: Submitter;
    let second!: Submitter;
    let invocationIds!: string[];
    try {
      const worker = spawnWorker("snapshot_barrier");
      await waitMessage(worker, (message) => message.type === "ready");
      await registerDeployment();
      first = spawnSubmitter(commandId, id("v2a-distinct-key-workflow-a"));
      second = spawnSubmitter(commandId, id("v2a-distinct-key-workflow-b"));
      expect(first.child.pid).toBeDefined();
      expect(second.child.pid).toBeDefined();
      expect(first.child.pid).not.toBe(second.child.pid);
      const submissions = await Promise.all([
        waitSubmitterMessage(first, "submitted"),
        waitSubmitterMessage(second, "submitted"),
      ]);
      invocationIds = submissions.map((message) => message.invocationId);
      expect(new Set(invocationIds).size).toBe(2);
      const waiters = await waitForSnapshotWaiters(barrier.identity, 2);
      expect(new Set(waiters.map((waiter) => waiter.pid)).size).toBe(2);
      expect(first.messages.some((message) => message.type === "terminal")).toBe(false);
      expect(second.messages.some((message) => message.type === "terminal")).toBe(false);
      expect(first.child.exitCode).toBeNull();
      expect(second.child.exitCode).toBeNull();
      expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
      expect(await readDomainState(admin)).toMatchObject({ version: "3", status: "open" });
    } finally {
      await barrier.release();
    }

    const terminals = await Promise.all([
      waitSubmitterMessage(first, "terminal"),
      waitSubmitterMessage(second, "terminal"),
    ]);
    for (const terminal of terminals) expect(terminal).toEqual({ type: "terminal", status: "accepted", code: "ACCEPTED" });
    expect(first).toMatchObject({ messages: [], invalidMessage: false });
    expect(second).toMatchObject({ messages: [], invalidMessage: false });
    await expectInvocationResults(invocationIds, fixture.namespaceId, commandId);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect(await readDomainState(admin)).toMatchObject({ version: "4", status: "resolved" });
  }, 120_000);

  it("GateD-V2B rejects different hash across same and new workflow keys", async () => {
    const commandId = id("v2b-different-hash-command");
    const workflowId = id("v2b-different-hash-workflow");
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    const accepted = await submitRestateCommand(commandId, completedRequest, workflowId);
    const sameKey = await submitRestateCommand(commandId, cancelledRequest, workflowId);
    const newKey = await submitRestateCommand(commandId, cancelledRequest, id("v2b-different-hash-new-workflow"));

    expect(accepted).toEqual({
      ...await readStoredReceipt(fixture.namespaceId, commandId),
      projectionDigest: completedProjectionDigest,
    });
    expect(sameKey).toEqual({
      status: "rejected", code: "IDEMPOTENCY_KEY_REUSED", commandId, requestHash: requestHashes.cancelled,
    });
    expect(newKey).toMatchObject({
      status: "rejected", code: "IDEMPOTENCY_KEY_REUSED", namespaceId: fixture.namespaceId,
      caseId: fixture.caseId, commandId, requestHash: requestHashes.cancelled,
    });
    expect(await readDecisionAudits()).toEqual([expect.objectContaining({
      commandId, requestHash: requestHashes.cancelled, decisionCode: "IDEMPOTENCY_KEY_REUSED",
    })]);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect(await readDomainState(admin)).toMatchObject({ version: "4", status: "resolved", commitmentStatus: "completed" });
  }, 120_000);

  it("GateD-V2B preserves receipt authority after endpoint restart and supported invocation purge", async () => {
    const commandId = id("v2b-purge-command");
    let worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();
    const invocationId = await submitWorkflow(id("v2b-purge-initial-workflow"), commandId, completedRequest);
    const initial = await attachWorkflow(invocationId);
    expect(initial).toEqual({
      ...await readStoredReceipt(fixture.namespaceId, commandId),
      projectionDigest: completedProjectionDigest,
    });

    await purgeInvocation(invocationId);
    await kill(worker);
    worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    const replay = await submitRestateCommand(commandId, completedRequest, id("v2b-purge-replay-workflow"));
    const mismatch = await submitRestateCommand(commandId, cancelledRequest, id("v2b-purge-mismatch-workflow"));
    expect(replay).toEqual(initial);
    expect(mismatch).toMatchObject({
      status: "rejected", code: "IDEMPOTENCY_KEY_REUSED", namespaceId: fixture.namespaceId,
      caseId: fixture.caseId, commandId, requestHash: requestHashes.cancelled,
    });
    expect(await readDecisionAudits()).toEqual([expect.objectContaining({
      commandId, requestHash: requestHashes.cancelled, decisionCode: "IDEMPOTENCY_KEY_REUSED",
    })]);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect(await readDomainState(admin)).toMatchObject({ version: "4", status: "resolved", commitmentStatus: "completed" });
  }, 120_000);

  it("GateD-V3 returns one accepted and one expected-version conflict without a queue", async () => {
    const commands = [
      { commandId: id("v3-race-completed-command"), requestName: "completed" as const },
      { commandId: id("v3-race-cancelled-command"), requestName: "cancelled" as const },
    ] as const;
    const barrier = await acquireSnapshotBarrier();
    let worker!: Worker;
    let first!: Submitter;
    let second!: Submitter;
    let invocationIds!: [string, string];
    try {
      worker = spawnWorker("snapshot_barrier");
      await waitMessage(worker, (message) => message.type === "ready");
      await registerDeployment();
      first = spawnSubmitter(commands[0].commandId, id("v3-race-completed-workflow"), commands[0].requestName);
      second = spawnSubmitter(commands[1].commandId, id("v3-race-cancelled-workflow"), commands[1].requestName);
      expect(first.child.pid).toBeDefined();
      expect(second.child.pid).toBeDefined();
      expect(first.child.pid).not.toBe(second.child.pid);
      const submissions = await Promise.all([
        waitSubmitterMessage(first, "submitted"),
        waitSubmitterMessage(second, "submitted"),
      ]);
      invocationIds = [submissions[0].invocationId, submissions[1].invocationId];
      expect(new Set(invocationIds).size).toBe(2);
      const waiters = await waitForSnapshotWaiters(barrier.identity, 2);
      expect(barrier.pid).toBeGreaterThan(0);
      expect(new Set(waiters.map((waiter) => waiter.pid)).size).toBe(2);
      expect(first.messages.some((message) => message.type === "terminal")).toBe(false);
      expect(second.messages.some((message) => message.type === "terminal")).toBe(false);
      expect(first.child.exitCode).toBeNull();
      expect(second.child.exitCode).toBeNull();
      expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
      expect(await readDomainState(admin)).toMatchObject({ version: "3", status: "open" });
    } finally {
      await barrier.release();
    }

    const terminals = await Promise.all([
      waitSubmitterMessage(first, "terminal"),
      waitSubmitterMessage(second, "terminal"),
    ]);
    expect(terminals).toEqual(expect.arrayContaining([
      { type: "terminal", status: "accepted", code: "ACCEPTED" },
      { type: "terminal", status: "rejected", code: "EXPECTED_VERSION_CONFLICT" },
    ]));
    const retried = await waitMessage(
      worker,
      (message) => message.type === "attempt" && message.vector === "V3" && (message.count ?? 0) > 1,
    );
    expect(retried).toEqual({ type: "attempt", vector: "V3", count: 2 });
    expect(first).toMatchObject({ messages: [], invalidMessage: false });
    expect(second).toMatchObject({ messages: [], invalidMessage: false });
    const outcomes = await Promise.all([
      expectAttachedReceipt(invocationIds[0], commands[0].commandId),
      expectAttachedReceipt(invocationIds[1], commands[1].commandId),
    ]);
    const winner = outcomes.find((outcome) => outcome.status === "accepted");
    if (winner === undefined) throw new Error("V3 race returned no accepted winner");
    const expectedResolution = winner.commandId === commands[0].commandId ? "completed" : "cancelled";
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "accepted", code: "ACCEPTED", caseVersion: "4" }),
      expect.objectContaining({ status: "rejected", code: "EXPECTED_VERSION_CONFLICT", caseVersion: "4" }),
    ]));
    expect(await readDomainCounts(admin)).toEqual({ receipts: 2, acceptedHistory: 1 });
    expect(await readDomainState(admin)).toEqual({
      version: "4", status: "resolved", commitmentDeadline: "2026-07-11 12:00:00+00",
      commitmentStatus: expectedResolution, payloadRef: fixture.payloadRef,
    });
    const history = await admin<{ commandId: string; position: string }[]>`
      SELECT command_id AS "commandId", position::text AS position
      FROM continuity.accepted_history
      WHERE namespace_id = ${fixture.namespaceId} AND case_id = ${fixture.caseId}
    `;
    expect(history).toEqual([{ commandId: winner.commandId, position: "4" }]);
  }, 120_000);

  it("GateD-V3 durably cancels retrying invocation and observes no late commit", async () => {
    const workflowId = id("v3-watchdog-workflow");
    const commandId = id("v3-watchdog-command");
    let worker = spawnWorker("retry_forever");
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();
    const started = Date.now();
    const watchdog = delay(5_000).then(async () => {
      const elapsed = Date.now() - started;
      await kill(worker);
      return elapsed;
    });
    const invocationId = await submitWorkflow(workflowId, commandId, completedRequest);
    const repeated = await waitMessage(
      worker,
      (message) => message.type === "attempt" && message.vector === "V3" && (message.count ?? 0) > 1,
    );
    expect(repeated.count).toBeGreaterThan(1);
    const watchdogElapsed = await watchdog;
    expect(watchdogElapsed).toBeGreaterThanOrEqual(4_900);
    expect(watchdogElapsed).toBeLessThanOrEqual(6_000);
    expect(worker.child.exitCode !== null || worker.child.signalCode !== null).toBe(true);
    const attempts = [repeated, ...worker.messages.filter((message) => message.type === "attempt")];
    for (const attempt of attempts) {
      expect(Object.keys(attempt).sort()).toEqual(["count", "type", "vector"]);
      expect(attempt).toMatchObject({ type: "attempt", vector: "V3" });
      expect(attempt.count).toBeGreaterThan(0);
    }
    expect(attempts.length).toBeGreaterThan(1);
    expect(Math.max(...attempts.map((attempt) => attempt.count ?? 0))).toBeGreaterThan(5);
    await requestCancellation(invocationId);
    worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();
    const cancellation = await waitForCanceledInvocation(invocationId);
    expect(cancellation).toEqual({
      status: "completed", completion_result: "failure", completion_failure: "[409] Cancelled",
    });
    const attachedCancellation = await fetch(
      `http://127.0.0.1:8080/restate/attach/${encodeURIComponent(invocationId)}`,
    );
    expect(attachedCancellation.status).toBe(409);
    expect(await attachedCancellation.json()).toEqual({ code: 409, message: "Cancelled" });
    expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
    expect(await readDomainState(admin)).toEqual({
      version: "3", status: "open", commitmentDeadline: null, commitmentStatus: null, payloadRef: null,
    });

    await delay(5_000);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
    expect(await readDomainState(admin)).toEqual({
      version: "3", status: "open", commitmentDeadline: null, commitmentStatus: null, payloadRef: null,
    });
  }, 120_000);

  it("GateD supporting assertion keeps command IDs independent across namespaces", async () => {
    const secondNamespace = `ns:test:continuity-kernel-v0:${randomUUID()}`;
    const commandId = id("cross-namespace-command");
    await admin`
      INSERT INTO continuity.authorization_grants (
        namespace_id, authorization_grant_id, case_id, actor_id, version, is_revoked
      ) VALUES (
        ${secondNamespace}, ${fixture.authorizationGrantId}, ${fixture.caseId},
        ${fixture.ownerAgentId}, ${fixture.authorizationVersion}, false
      )
    `;
    await admin`
      INSERT INTO continuity.cases (namespace_id, case_id, owner_agent_id, version, status)
      VALUES (${secondNamespace}, ${fixture.caseId}, ${fixture.ownerAgentId}, ${fixture.caseVersion}, 'open')
    `;
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    const secondRequest = { ...structuredClone(completedRequest), namespaceId: secondNamespace };
    const results = await Promise.all([
      submitRestateCommand(commandId, completedRequest, id("cross-namespace-primary-workflow")),
      submitRestateCommand(commandId, secondRequest, id("cross-namespace-secondary-workflow")),
    ]);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "accepted", code: "ACCEPTED", namespaceId: fixture.namespaceId, commandId }),
      expect.objectContaining({ status: "accepted", code: "ACCEPTED", namespaceId: secondNamespace, commandId }),
    ]));
    const rows = await admin<{ namespaceId: string; version: string; receipts: number; acceptedHistory: number }[]>`
      SELECT c.namespace_id AS "namespaceId", c.version::text AS version,
        (SELECT count(*)::integer FROM continuity.command_receipts AS r
          WHERE r.namespace_id = c.namespace_id AND r.command_id = ${commandId}) AS receipts,
        (SELECT count(*)::integer FROM continuity.accepted_history AS h
          WHERE h.namespace_id = c.namespace_id AND h.command_id = ${commandId}) AS "acceptedHistory"
      FROM continuity.cases AS c
      WHERE c.namespace_id IN (${fixture.namespaceId}, ${secondNamespace}) AND c.case_id = ${fixture.caseId}
      ORDER BY c.namespace_id
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ version: "4", receipts: 1, acceptedHistory: 1 });
    expect(rows.map((row) => row.namespaceId).sort()).toEqual([fixture.namespaceId, secondNamespace].sort());
  }, 120_000);

  it("GateD-V5 returns the exact frozen projection digest after endpoint restart", async () => {
    const commandId = id("v5-restart-digest-command");
    let worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();
    const initial = await submitRestateCommand(
      commandId,
      completedRequest,
      id("v5-restart-digest-initial-workflow"),
    );
    const expected = {
      status: "accepted",
      code: "ACCEPTED",
      namespaceId: fixture.namespaceId,
      caseId: fixture.caseId,
      commandId,
      requestHash: requestHashes.completed,
      authorizationVersion: fixture.authorizationVersion,
      caseVersion: "4",
      payloadRef: fixture.payloadRef,
      projectionSchemaVersion: 1,
      projection: completedProjection,
      projectionDigest: completedProjectionDigest,
    };
    expect(initial).toEqual(expected);
    expect(canonicalHash(initial.projection)).toBe(completedProjectionDigest);

    await kill(worker);
    worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();
    const afterRestart = await submitRestateCommand(
      commandId,
      completedRequest,
      id("v5-restart-digest-replay-workflow"),
    );
    expect(afterRestart).toEqual(expected);
    expect(canonicalHash(afterRestart.projection)).toBe(completedProjectionDigest);
    const storedReceipt = await readStoredReceipt(fixture.namespaceId, commandId);
    expect({ ...storedReceipt, projectionDigest: canonicalHash(storedReceipt.projection) }).toEqual(expected);
    expect(canonicalHash(storedReceipt.projection)).toBe(completedProjectionDigest);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect(await readDomainState(admin)).toEqual({
      version: "4", status: "resolved", commitmentDeadline: "2026-07-11 12:00:00+00",
      commitmentStatus: "completed", payloadRef: fixture.payloadRef,
    });
    const history = await admin<{ commandId: string; position: string }[]>`
      SELECT command_id AS "commandId", position::text AS position
      FROM continuity.accepted_history
      WHERE namespace_id = ${fixture.namespaceId} AND case_id = ${fixture.caseId}
    `;
    expect(history).toEqual([{ commandId, position: "4" }]);
  }, 120_000);

  it("GateD-V5 records supported Restate service/deployment version through public introspection", async () => {
    const workflowId = id("v5-public-version-workflow");
    const commandId = id("v5-public-version-command");
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    const service = await readRestateAdmin<RestateServiceInfo>("/services/ContinuityCommitT2bV1");
    const deployment = await readRestateAdmin<RestateDeploymentInfo>(
      `/deployments/${encodeURIComponent(service.deployment_id)}`,
    );
    const version = await readRestateAdmin<RestateVersionInfo>("/version");
    const result = await submitRestateCommand(commandId, completedRequest, workflowId);
    const invocation = await queryRestate(
      `select pinned_deployment_id, pinned_service_protocol_version, created_using_restate_version,`
      + ` status, completion_result, completion_failure is null as has_no_completion_failure`
      + ` from sys_invocation where target_service_name = 'ContinuityCommitT2bV1'`
      + ` and target_service_key = ${restateString(workflowId)}`,
    );
    const deployedService = deployment.services.find(({ name }) => name === "ContinuityCommitT2bV1");
    const expectedUri = new URL(
      process.env.CK_RESTATE_DEPLOYMENT_URI ?? "http://host.docker.internal:9080",
    ).toString();

    expect(version).toMatchObject({ version: "1.7.2", min_admin_api_version: 2, max_admin_api_version: 4 });
    expect(service).toMatchObject({
      name: "ContinuityCommitT2bV1", ty: "Workflow", public: true,
      deployment_id: deployment.id,
    });
    expect(Number.isSafeInteger(service.revision) && service.revision > 0).toBe(true);
    expect(service.handlers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "run", ty: "Workflow", public: true }),
    ]));
    expect(deployment).toMatchObject({
      id: service.deployment_id,
      uri: expectedUri,
      protocol_type: "BidiStream",
      http_version: "HTTP/2.0",
      min_protocol_version: 5,
      max_protocol_version: 7,
      sdk_version: "restate-sdk-typescript/1.15.1",
    });
    expect(deployedService).toMatchObject({ name: service.name, revision: service.revision });
    expect(invocation.rows).toEqual([expect.objectContaining({
      pinned_deployment_id: service.deployment_id,
      pinned_service_protocol_version: 6,
      created_using_restate_version: "1.7.2",
      status: "completed",
      completion_result: "success",
      has_no_completion_failure: true,
    })]);
    expect(result).toMatchObject({
      status: "accepted", code: "ACCEPTED", commandId,
      requestHash: requestHashes.completed, projectionDigest: completedProjectionDigest,
    });
  }, 120_000);

  it("GateD-V5 rejects undeclared optional payload bytes before workflow submission", async () => {
    const sentinel = "CK_PRIVATE_PAYLOAD_SENTINEL_20260711_A9F4C2E7";
    const workflowId = id("v5-undeclared-payload");
    const request = {
      ...structuredClone(completedRequest),
      privatePayload: sentinel,
    };
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    let rejection: unknown;
    try {
      await submitRestateCommand(id("v5-undeclared-payload-command"), request, workflowId);
    } catch (error) {
      rejection = error;
    }

    const invocations = await queryRestate(
      `select id from sys_invocation where target_service_name = 'ContinuityCommitT2bV1' and target_service_key = '${workflowId}'`,
    );
    const counts = await readDomainCounts(admin);
    const state = await readDomainState(admin);

    const rejectionText = rejection instanceof Error
      ? `${rejection.name}:${rejection.message}`
      : String(rejection);
    expect.soft(rejection).toBeInstanceOf(Error);
    expect.soft(rejection).toMatchObject({ code: "INVALID_REQUEST_SCHEMA" });
    expect.soft(rejectionText).not.toContain(sentinel);
    expect.soft(rejectionText).not.toContain("privatePayload");
    expect.soft(invocations.rows).toHaveLength(0);
    expect.soft(counts).toEqual({ receipts: 0, acceptedHistory: 0 });
    expect.soft(state).toEqual({
      version: "3",
      status: "open",
      commitmentDeadline: null,
      commitmentStatus: null,
      payloadRef: null,
    });
  }, 120_000);

  it("GateD-V5 rejects invalid canonical request before workflow submission", async () => {
    const sentinel = "CK_INVALID_CANONICAL_SENTINEL_20260711_";
    const workflowId = id("v5-invalid-canonical");
    const commandId = id("v5-invalid-canonical-command");
    const request = structuredClone(completedRequest);
    request.actionPayload.payloadRef = `${sentinel}${String.fromCharCode(0xd800)}`;
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    let rejection: unknown;
    try {
      await submitRestateCommand(commandId, request, workflowId);
    } catch (error) {
      rejection = error;
    }

    const invocations = await queryRestate(
      `select id from sys_invocation where target_service_name = 'ContinuityCommitT2bV1' and target_service_key = '${workflowId}'`,
    );
    const rejectionText = rejection instanceof Error ? `${rejection.name}:${rejection.message}` : String(rejection);
    expect.soft(rejection).toBeInstanceOf(Error);
    expect.soft(rejection).toMatchObject({ code: "INVALID_CANONICAL_REQUEST" });
    for (const forbidden of [sentinel, commandId, "payloadRef"]) expect.soft(rejectionText).not.toContain(forbidden);
    expect.soft(invocations.rows).toHaveLength(0);
    expect.soft(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
    expect.soft(await readDomainState(admin)).toMatchObject({ version: "3", status: "open", payloadRef: null });
  }, 120_000);

  it("GateD-V5 rejects invalid canonical request at direct ingress", async () => {
    const sentinel = "CK_INVALID_CANONICAL_DIRECT_SENTINEL_20260711_";
    await expectDirectTerminal(
      "v5-invalid-canonical-direct",
      (input) => ({ ...input, request: { ...input.request, actionPayload: {
        ...input.request.actionPayload, payloadRef: `${sentinel}${String.fromCharCode(0xd800)}`,
      } } }),
      "INVALID_CANONICAL_REQUEST",
      [sentinel, "payloadRef"],
    );
  }, 120_000);

  it("GateD-V5 fails explicitly for unsupported domain schema version at direct ingress", async () => {
    await expectDirectTerminal(
      "v5-unsupported-domain",
      (input) => ({ ...input, domainSchemaVersion: 2 }),
      "UNSUPPORTED_DOMAIN_SCHEMA_VERSION",
    );
  }, 120_000);

  it("GateD-V5 fails explicitly for unsupported request-hash schema version at direct ingress", async () => {
    await expectDirectTerminal(
      "v5-unsupported-request-hash",
      (input) => ({ ...input, request: { ...input.request, requestHashSchemaVersion: 2 } }),
      "UNSUPPORTED_REQUEST_HASH_SCHEMA_VERSION",
    );
  }, 120_000);

  it("GateD-V5 fails explicitly for unsupported authorization model version at direct ingress", async () => {
    await expectDirectTerminal(
      "v5-unsupported-authorization",
      (input) => ({ ...input, authorizationModelVersion: 2 }),
      "UNSUPPORTED_AUTHORIZATION_MODEL_VERSION",
    );
  }, 120_000);

  it("GateD-V5 fails explicitly for unsupported validator version at direct ingress", async () => {
    await expectDirectTerminal(
      "v5-unsupported-validator",
      (input) => ({ ...input, validatorVersion: 2 }),
      "UNSUPPORTED_VALIDATOR_VERSION",
    );
  }, 120_000);

  it("GateD-V5 fails explicitly for unsupported projection schema version at direct ingress", async () => {
    await expectDirectTerminal(
      "v5-unsupported-projection",
      (input) => ({ ...input, projectionSchemaVersion: 2 }),
      "UNSUPPORTED_PROJECTION_SCHEMA_VERSION",
    );
  }, 120_000);

  it("GateD-V5 fails explicitly for unsupported serializer version at direct ingress", async () => {
    await expectDirectTerminal(
      "v5-unsupported-serializer",
      (input) => ({ ...input, serializerVersion: "rfc8785-sha256-base64url-nopad-v2" }),
      "UNSUPPORTED_SERIALIZER_VERSION",
    );
  }, 120_000);

  it("GateD-V5 fails explicitly for unsupported runtime application version at direct ingress", async () => {
    await expectDirectTerminal(
      "v5-unsupported-runtime",
      (input) => ({ ...input, runtimeApplicationVersion: "continuity-kernel-restate-gate-d-v2" }),
      "UNSUPPORTED_RUNTIME_APPLICATION_VERSION",
    );
  }, 120_000);

  it("GateD-V6 erases optional payload bytes without application, journal, metadata, result, error, or log leakage", async () => {
    const sentinel = "CK_PRIVATE_PAYLOAD_SENTINEL_20260711_A9F4C2E7";
    const representations = privatePayloadRepresentations(sentinel);
    const workflowId = id("v6-erasure-workflow");
    const commandId = id("v6-erasure-command");
    await admin.unsafe("CREATE SCHEMA IF NOT EXISTS deletable_payload");
    await admin.unsafe(
      "CREATE TABLE IF NOT EXISTS deletable_payload.objects (payload_ref text PRIMARY KEY, body text NOT NULL)",
    );
    await admin.unsafe("DELETE FROM deletable_payload.objects");

    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();
    const logSince = new Date().toISOString();
    await admin`
      INSERT INTO deletable_payload.objects (payload_ref, body)
      VALUES (${fixture.payloadRef}, ${sentinel})
    `;
    const payloadRows = await admin<{ payloadRef: string; body: string }[]>`
      SELECT payload_ref AS "payloadRef", body FROM deletable_payload.objects
      WHERE payload_ref = ${fixture.payloadRef}
    `;
    if (payloadRows.length !== 1 || payloadRows[0]?.payloadRef !== fixture.payloadRef
      || payloadRows[0].body !== sentinel) {
      throw new Error("Deletable payload store did not contain the exact synthetic fixture");
    }
    assertNoPrivatePayload(
      "logical application storage before submission",
      await readLogicalApplicationText(),
      representations,
    );

    let deletedRows = 0;
    const result = await (async () => {
      try {
        return await submitRestateCommand(commandId, completedRequest, workflowId);
      } finally {
        const deleted = await admin<{ payloadRef: string }[]>`
          DELETE FROM deletable_payload.objects WHERE payload_ref = ${fixture.payloadRef}
          RETURNING payload_ref AS "payloadRef"
        `;
        deletedRows = deleted.length;
      }
    })();
    expect(deletedRows).toBe(1);
    const remaining = await admin<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM deletable_payload.objects
      WHERE payload_ref = ${fixture.payloadRef}
    `;
    expect(remaining).toEqual([{ count: 0 }]);

    const applicationText = await readLogicalApplicationText();
    const invocation = await queryRestate(
      `select *, completion_failure is null as has_no_completion_failure`
      + ` from sys_invocation where target_service_name = 'ContinuityCommitT2bV1'`
      + ` and target_service_key = ${restateString(workflowId)}`,
    );
    const journal = await queryRestate(
      `select raw, entry_json, entry_lite_json from sys_journal`
      + ` where id in (select id from sys_invocation`
      + ` where target_service_name = 'ContinuityCommitT2bV1'`
      + ` and target_service_key = ${restateString(workflowId)}) order by index`,
    );
    const containerLogs = await readRestateContainerLogs(logSince);
    const storedReceipt = await readStoredReceipt(fixture.namespaceId, commandId);
    const history = await admin<{
      commandId: string; requestHash: string; position: string; payloadRef: string;
    }[]>`
      SELECT command_id AS "commandId", request_hash AS "requestHash",
        position::text AS position, payload_ref AS "payloadRef"
      FROM continuity.accepted_history
      WHERE namespace_id = ${fixture.namespaceId} AND case_id = ${fixture.caseId}
    `;

    expect(result).toEqual({
      status: "accepted", code: "ACCEPTED", namespaceId: fixture.namespaceId,
      caseId: fixture.caseId, commandId, requestHash: requestHashes.completed,
      authorizationVersion: fixture.authorizationVersion, caseVersion: "4",
      payloadRef: fixture.payloadRef, projectionSchemaVersion: 1,
      projection: completedProjection, projectionDigest: completedProjectionDigest,
    });
    expect(storedReceipt).toEqual({
      status: "accepted", code: "ACCEPTED", namespaceId: fixture.namespaceId,
      caseId: fixture.caseId, commandId, requestHash: requestHashes.completed,
      authorizationVersion: fixture.authorizationVersion, caseVersion: "4",
      payloadRef: fixture.payloadRef, projectionSchemaVersion: 1,
      projection: completedProjection,
    });
    expect(canonicalHash(storedReceipt.projection)).toBe(completedProjectionDigest);
    expect(history).toEqual([{
      commandId, requestHash: requestHashes.completed, position: "4", payloadRef: fixture.payloadRef,
    }]);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect(await readDomainState(admin)).toEqual({
      version: "4", status: "resolved", commitmentDeadline: "2026-07-11 12:00:00+00",
      commitmentStatus: "completed", payloadRef: fixture.payloadRef,
    });
    expect(invocation.rows).toHaveLength(1);
    expect(invocation.rows[0]).toMatchObject({
      target_service_name: "ContinuityCommitT2bV1", target_service_key: workflowId,
      target_handler_name: "run", target_service_ty: "workflow", invoked_by: "ingress",
      created_using_restate_version: "1.7.2", status: "completed",
      completion_result: "success", has_no_completion_failure: true,
    });
    expect(typeof invocation.rows[0]?.pinned_deployment_id).toBe("string");
    expect(journal.rows.length).toBeGreaterThan(0);

    assertNoPrivatePayload("logical application storage after erasure", applicationText, representations);
    assertNoPrivatePayload("supported Restate invocation metadata and failure", [
      JSON.stringify(invocation.rows),
    ], representations);
    assertNoPrivatePayload("supported Restate raw and JSON journal", [
      JSON.stringify(journal.rows),
    ], representations);
    assertNoPrivatePayload("approved result and stored receipt", [
      JSON.stringify(result), JSON.stringify(storedReceipt), JSON.stringify(history),
    ], representations);
    assertNoPrivatePayload("worker stdout and stderr", worker.logs, representations);
    assertNoPrivatePayload("Restate container logs", [containerLogs], representations);
  }, 120_000);
});
