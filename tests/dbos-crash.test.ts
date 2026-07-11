import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { DBOSClient } from "@dbos-inc/dbos-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SYSTEM_DATABASE_URL } from "../src/incumbent/dbos.js";
import {
  completedProjectionDigest,
  createAdminSql,
  fixture,
  readDomainCounts,
  readDomainState,
  resetSyntheticFixture,
} from "./db-fixture.js";

interface WorkerMessage { type: string; phase?: string; count?: number; result?: Record<string, unknown>; error?: string }
interface Worker { child: ChildProcess; logs: string[] }
const admin = createAdminSql("continuity-kernel-crash-parent");
let client: DBOSClient;
const id = (label: string) => `t2:crash:${label}:${randomUUID()}`;

beforeAll(async () => { client = await DBOSClient.create({ systemDatabaseUrl: SYSTEM_DATABASE_URL }); });
beforeEach(() => resetSyntheticFixture(admin), 30_000);
afterAll(async () => { await client.destroy(); await admin.end(); });

function spawnWorker(workflowId: string, commandId: string, mode = "submit", failpoint?: string): Worker {
  const child = fork(new URL("./dbos-worker.ts", import.meta.url), [], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, CK_WORKFLOW_ID: workflowId, CK_COMMAND_ID: commandId, CK_WORKER_MODE: mode, CK_FAILPOINT: failpoint },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const logs: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    logs.push(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    logs.push(chunk.toString());
  });
  return { child, logs };
}

function waitMessage(worker: Worker, match: (message: WorkerMessage) => boolean, timeoutMs = 30_000): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error(`Worker message timeout; logs: ${worker.logs.join("")}`));
    }, timeoutMs);
    const onMessage = (value: unknown) => {
      const message = value as WorkerMessage;
      if (message.type === "error") {
        const error = new Error(message.error ?? "Worker failed");
        worker.child.off("exit", onExit);
        worker.child.once("exit", () => {
          finish(error);
        });
        worker.child.kill("SIGKILL");
      }
      else if (match(message)) finish(undefined, message);
    };
    const onExit = (code: number | null) => {
      finish(new Error(`Worker exited ${String(code)}; logs: ${worker.logs.join("")}`));
    };
    const finish = (error?: Error, message?: WorkerMessage) => {
      clearTimeout(timer); worker.child.off("message", onMessage); worker.child.off("exit", onExit);
      if (error !== undefined) reject(error); else resolve(message as WorkerMessage);
    };
    worker.child.on("message", onMessage); worker.child.on("exit", onExit);
  });
}

async function kill(worker: Worker): Promise<void> {
  if (worker.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => worker.child.once("exit", () => {
    resolve();
  }));
  worker.child.kill("SIGKILL");
  await exited;
  await waitForDatasourceExit();
}

async function recover(workflowId: string, commandId: string): Promise<Record<string, unknown>> {
  const worker = spawnWorker(workflowId, commandId, "recover");
  try {
    const message = await waitMessage(worker, (x) => x.type === "result");
    if (worker.child.exitCode === null) {
      await new Promise<void>((resolve) => worker.child.once("exit", () => {
        resolve();
      }));
    }
    await waitForDatasourceExit();
    return message.result ?? {};
  } catch (error) {
    await waitForDatasourceExit();
    throw error;
  }
}

async function waitForDatasourceExit(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const rows = await admin<{ connected: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE application_name='continuity-kernel-datasource') AS connected
    `;
    if (rows[0]?.connected === false) return;
    await delay(25);
  }
  throw new Error("Datasource backend remained after worker exit");
}

async function waitForPgSleep(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await admin<{ sleeping: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE application_name='continuity-kernel-datasource' AND wait_event='PgSleep') AS sleeping
    `;
    if (rows[0]?.sleeping === true) return;
    await delay(25);
  }
  throw new Error("Datasource never reached after-write PgSleep failpoint");
}

async function expectOneCommit(result: Record<string, unknown>): Promise<void> {
  expect(result).toMatchObject({ status: "accepted", code: "ACCEPTED", projectionDigest: completedProjectionDigest });
  expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
  expect((await readDomainState(admin)).version).toBe("4");
}

describe.sequential("DBOS external crash and watchdog vectors", () => {
  it("recovers exactly once after SIGKILL before the datasource transaction", async () => {
    const workflowId = id("before-tx"); const commandId = id("before-tx-command");
    const worker = spawnWorker(workflowId, commandId, "submit", "before_transaction");
    await waitMessage(worker, (x) => x.type === "phase" && x.phase === "before_transaction");
    await kill(worker);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
    await expectOneCommit(await recover(workflowId, commandId));
  }, 45_000);

  it("rolls back an intermediate update killed before commit, then recovers once", async () => {
    const workflowId = id("after-write"); const commandId = id("after-write-command");
    const worker = spawnWorker(workflowId, commandId, "submit", "after_write");
    await waitMessage(worker, (x) => x.type === "ready");
    await waitForPgSleep();
    await kill(worker);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
    expect((await readDomainState(admin)).version).toBe("3");
    await expectOneCommit(await recover(workflowId, commandId));
  }, 45_000);

  it("does not duplicate a committed datasource step killed before workflow return", async () => {
    const workflowId = id("after-commit"); const commandId = id("after-commit-command");
    const worker = spawnWorker(workflowId, commandId, "submit", "after_commit");
    await waitMessage(worker, (x) => x.type === "phase" && x.phase === "after_commit");
    await kill(worker);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    await expectOneCommit(await recover(workflowId, commandId));
  }, 45_000);

  it("kills unbounded serialization retries, durably cancels, and observes no late commit", async () => {
    const workflowId = id("watchdog"); const commandId = id("watchdog-command");
    const started = Date.now();
    const worker = spawnWorker(workflowId, commandId, "submit", "retry_forever");
    const attempt = await waitMessage(worker, (x) => x.type === "attempt" && (x.count ?? 0) > 1);
    expect(attempt.count).toBeGreaterThan(1);
    await delay(Math.max(0, 5_000 - (Date.now() - started)));
    await kill(worker);
    await client.cancelWorkflow(workflowId);
    const cancelDeadline = Date.now() + 10_000;
    while ((await client.getWorkflow(workflowId))?.status !== "CANCELLED") {
      if (Date.now() >= cancelDeadline) throw new Error("Durable cancellation was not confirmed within 10 seconds");
      await delay(50);
    }
    const observer = spawnWorker(workflowId, commandId, "idle");
    await waitMessage(observer, (x) => x.type === "ready");
    await delay(5_000);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 0, acceptedHistory: 0 });
    expect((await readDomainState(admin)).version).toBe("3");
    await kill(observer);
  }, 45_000);

  it("never emits optional payload bytes to captured worker logs", async () => {
    const sentinel = `SENTINEL-LOG-${randomUUID()}`;
    await admin.unsafe("CREATE SCHEMA IF NOT EXISTS deletable_payload");
    await admin.unsafe("CREATE TABLE IF NOT EXISTS deletable_payload.objects (payload_ref text PRIMARY KEY, body text NOT NULL)");
    await admin`INSERT INTO deletable_payload.objects VALUES (${fixture.payloadRef},${sentinel}) ON CONFLICT (payload_ref) DO UPDATE SET body=EXCLUDED.body`;
    const worker = spawnWorker(id("log-scan"), id("log-scan-command"));
    await waitMessage(worker, (x) => x.type === "result");
    await admin`DELETE FROM deletable_payload.objects WHERE payload_ref=${fixture.payloadRef}`;
    expect(worker.logs.join(""), "worker stdout/stderr").not.toContain(sentinel);
  }, 45_000);
});
