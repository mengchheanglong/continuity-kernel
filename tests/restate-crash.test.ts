import { fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { submitCommand as submitRestateCommand } from "../src/alternative/restate/client.js";
import { buildCommitInput } from "../src/domain/request.js";
import {
  cancelledRequest,
  completedProjectionDigest,
  completedRequest,
  createAdminSql,
  readDomainCounts,
  readDomainState,
  requestHashes,
  resetSyntheticFixture,
} from "./db-fixture.js";

interface WorkerMessage { type: string; phase?: string; result?: Record<string, unknown>; error?: string }
interface Worker { child: ChildProcess; logs: string[]; messages: WorkerMessage[] }

const admin = createAdminSql("continuity-kernel-restate-parent");
const workers = new Set<Worker>();
const id = (label: string) => `t2b:crash:${label}:${randomUUID()}`;

beforeEach(() => resetSyntheticFixture(admin), 30_000);
afterEach(async () => { for (const worker of [...workers]) await kill(worker); }, 60_000);
afterAll(() => admin.end());

function spawnWorker(failpoint?: string): Worker {
  const child = fork(new URL("./restate-worker.ts", import.meta.url), [], {
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

async function waitMessage(worker: Worker, match: (message: WorkerMessage) => boolean, timeoutMs = 30_000): Promise<WorkerMessage> {
  const deadline = Date.now() + timeoutMs;
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

async function submitWorkflow(workflowId: string, commandId: string): Promise<string> {
  const response = await fetch(
    `http://127.0.0.1:8080/restate/send/ContinuityCommitT2bV1/${encodeURIComponent(workflowId)}/run`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildCommitInput(commandId, completedRequest)),
    },
  );
  if (!response.ok) throw new Error(`Workflow submission failed (${String(response.status)}): ${await response.text()}`);
  const body = await response.json() as { invocationId?: string };
  if (body.invocationId === undefined) throw new Error("Workflow submission returned no invocationId");
  return body.invocationId;
}

async function attachWorkflow(invocationId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:8080/restate/attach/${encodeURIComponent(invocationId)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Workflow attach failed (${String(response.status)}): ${await response.text()}`);
  return await response.json() as Record<string, unknown>;
}

async function startInvocation(failpoint: string, workflowId: string, commandId: string): Promise<{ worker: Worker; invocationId: string }> {
  const worker = spawnWorker(failpoint);
  await waitMessage(worker, (message) => message.type === "ready");
  await registerDeployment();
  return { worker, invocationId: await submitWorkflow(workflowId, commandId) };
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

async function waitForPgSleep(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await admin<{ sleeping: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE application_name='continuity-kernel-restate' AND wait_event='PgSleep') AS sleeping
    `;
    if (rows[0]?.sleeping === true) return;
    await delay(25);
  }
  throw new Error("Restate datasource never reached the after-write PgSleep boundary");
}

async function expectPriorState(): Promise<void> {
  expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
  expect(await readDomainState(admin)).toEqual({
    version: "3",
    status: "open",
    commitmentDeadline: null,
    commitmentStatus: null,
    payloadRef: null,
  });
}

async function expectOneCommit(result: Record<string, unknown>): Promise<void> {
  expect(result).toMatchObject({ status: "accepted", code: "ACCEPTED", projectionDigest: completedProjectionDigest });
  expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
  expect((await readDomainState(admin)).version).toBe("4");
}

async function restartAtRecoveryBarrier(): Promise<Worker> {
  const worker = spawnWorker("before_recovery");
  await waitMessage(worker, (message) => message.type === "ready");
  await waitMessage(worker, (message) => message.type === "phase" && message.phase === "before_recovery");
  return worker;
}

describe.sequential("Restate external crash and recovery vectors", () => {
  it("T2b-V4A Restate recovers exactly once after a pre-transaction worker kill", async () => {
    const workflowId = id("before-tx");
    const { worker, invocationId } = await startInvocation("before_transaction", workflowId, id("before-tx-command"));
    await waitMessage(worker, (message) => message.type === "phase" && message.phase === "before_transaction");
    await kill(worker);
    await expectPriorState();

    const recovery = await restartAtRecoveryBarrier();
    await expectPriorState();
    recovery.child.send({ type: "continue" });
    await expectOneCommit(await attachWorkflow(invocationId));
    await kill(recovery);
  }, 120_000);

  it("T2b-V4B Restate rolls back then recovers exactly once after a mid-transaction worker kill", async () => {
    const workflowId = id("after-write");
    const { worker, invocationId } = await startInvocation("after_write", workflowId, id("after-write-command"));
    await waitForPgSleep();
    await kill(worker);
    await expectPriorState();

    const recovery = await restartAtRecoveryBarrier();
    await expectPriorState();
    recovery.child.send({ type: "continue" });
    await expectOneCommit(await attachWorkflow(invocationId));
    await kill(recovery);
  }, 120_000);

  it("T2b-V4C Restate deduplicates recovery after commit before step completion", async () => {
    const workflowId = id("after-commit");
    const { worker, invocationId } = await startInvocation("after_commit", workflowId, id("after-commit-command"));
    await waitMessage(worker, (message) => message.type === "phase" && message.phase === "after_commit");
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    await kill(worker);

    const recovery = spawnWorker();
    await waitMessage(recovery, (message) => message.type === "ready");
    await expectOneCommit(await attachWorkflow(invocationId));
    await kill(recovery);
  }, 120_000);

  it("rejects semantic reuse of the same Restate workflow key at the caller boundary", async () => {
    const workflowId = id("key-reuse");
    const commandId = id("key-reuse-command");
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    await expectOneCommit(await submitRestateCommand(commandId, completedRequest, workflowId));
    expect(await submitRestateCommand(commandId, cancelledRequest, workflowId)).toEqual({
      status: "rejected",
      code: "IDEMPOTENCY_KEY_REUSED",
      commandId,
      requestHash: requestHashes.cancelled,
    });
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect(await readDomainState(admin)).toEqual({
      version: "4",
      status: "resolved",
      commitmentDeadline: "2026-07-11 12:00:00+00",
      commitmentStatus: "completed",
      payloadRef: completedRequest.actionPayload.payloadRef,
    });
    await kill(worker);
  }, 120_000);
  it("cannot bypass the canonical command receipt with a new Restate workflow key", async () => {
    const commandId = id("receipt-command");
    const worker = spawnWorker();
    await waitMessage(worker, (message) => message.type === "ready");
    await registerDeployment();

    await expectOneCommit(await submitRestateCommand(commandId, completedRequest, id("receipt-first")));
    expect(await submitRestateCommand(commandId, cancelledRequest, id("receipt-second"))).toMatchObject({
      status: "rejected",
      code: "IDEMPOTENCY_KEY_REUSED",
      commandId,
      requestHash: requestHashes.cancelled,
    });
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect((await readDomainState(admin)).version).toBe("4");
    await kill(worker);
  }, 120_000);

  it("never journals or logs optional payload bytes or plaintext-derived hashes", async () => {
    const sentinel = "CK_PRIVATE_PAYLOAD_SENTINEL_20260711_A9F4C2E7";
    const digestHex = createHash("sha256").update(sentinel).digest("hex");
    const digestBase64Url = createHash("sha256").update(sentinel).digest("base64url");
    const workflowId = id("privacy");
    const worker = spawnWorker();
    try {
      await admin.unsafe("CREATE SCHEMA IF NOT EXISTS deletable_payload");
      await admin.unsafe("CREATE TABLE IF NOT EXISTS deletable_payload.objects (payload_ref text PRIMARY KEY, body text NOT NULL)");
      await admin`INSERT INTO deletable_payload.objects VALUES (${completedRequest.actionPayload.payloadRef},${sentinel}) ON CONFLICT (payload_ref) DO UPDATE SET body=EXCLUDED.body`;
      await waitMessage(worker, (message) => message.type === "ready");
      await registerDeployment();
      await expectOneCommit(await submitRestateCommand(id("privacy-command"), completedRequest, workflowId));

      const journal = JSON.stringify((await queryRestate(
        `select raw, entry_json from sys_journal where id in (select id from sys_invocation where target_service_name = 'ContinuityCommitT2bV1' and target_service_key = '${workflowId}')`,
      )).rows);
      const logs = worker.logs.join("");
      for (const forbidden of [sentinel, digestHex, digestBase64Url]) {
        expect(logs).not.toContain(forbidden);
        expect(journal).not.toContain(forbidden);
        expect(journal.toLowerCase()).not.toContain(Buffer.from(forbidden).toString("hex"));
      }
    } finally {
      await admin`DELETE FROM deletable_payload.objects WHERE payload_ref=${completedRequest.actionPayload.payloadRef}`;
      await kill(worker);
    }
  }, 120_000);

});
