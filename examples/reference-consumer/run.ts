/**
 * Thin reference consumer of the public Continuity Kernel commit path.
 *
 * This is not a product, memory system, or T5 feature. It proves a second
 * in-repo caller depends on frozen authorization, idempotency, and version
 * conflict outcomes. Synthetic data only.
 */

import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { submitCommand } from "../../src/alternative/restate/client.js";
import {
  canonicalRequestHash,
  type ResolveCaseRequest as DomainResolveCaseRequest,
} from "../../src/domain/request.js";
import {
  completedRequest as fixtureCompletedRequest,
  createAdminSql,
  fixture,
  resetSyntheticFixture,
} from "../../tests/db-fixture.js";

const completedRequest: DomainResolveCaseRequest = {
  requestHashSchemaVersion: 1,
  namespaceId: fixtureCompletedRequest.namespaceId,
  caseId: fixtureCompletedRequest.caseId,
  actorId: fixtureCompletedRequest.actorId,
  authorizationGrantId: fixtureCompletedRequest.authorizationGrantId,
  authorizationVersion: fixtureCompletedRequest.authorizationVersion,
  expectedCaseVersion: fixtureCompletedRequest.expectedCaseVersion,
  actionType: "resolve_case",
  actionPayload: {
    commitmentDeadline: fixtureCompletedRequest.actionPayload.commitmentDeadline,
    payloadRef: fixtureCompletedRequest.actionPayload.payloadRef,
    resolution: "completed",
  },
  worldTime: fixtureCompletedRequest.worldTime,
};

interface Worker {
  child: ChildProcess;
  logs: string[];
  messages: Array<{ type: string; error?: string }>;
}

interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

const deploymentUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
const admin = createAdminSql("continuity-kernel-reference-consumer");
const steps: StepResult[] = [];

function requireDeploymentUri(): string {
  if (deploymentUri === undefined || deploymentUri.length === 0) {
    throw new Error("CK_RESTATE_DEPLOYMENT_URI is required (see pnpm run doctor)");
  }
  return deploymentUri;
}

function record(name: string, ok: boolean, detail: string): void {
  steps.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}: ${detail}`);
}

function id(label: string): string {
  return `consumer:${label}:${randomUUID()}`;
}

async function spawnWorker(): Promise<Worker> {
  const child = fork(new URL("../../tests/restate-worker.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const worker: Worker = { child, logs: [], messages: [] };
  child.stdout?.on("data", (chunk: Buffer) => {
    worker.logs.push(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    worker.logs.push(chunk.toString());
  });
  child.on("message", (value: unknown) => {
    worker.messages.push(value as { type: string; error?: string });
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const error = worker.messages.find((message) => message.type === "error");
    if (error !== undefined) throw new Error(error.error ?? "Worker failed");
    if (worker.messages.some((message) => message.type === "ready")) return worker;
    if (worker.child.exitCode !== null) {
      throw new Error(`Worker exited ${String(worker.child.exitCode)}; ${worker.logs.join("")}`);
    }
    await delay(10);
  }
  throw new Error(`Worker ready timeout; ${worker.logs.join("")}`);
}

async function killWorker(worker: Worker): Promise<void> {
  if (worker.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    worker.child.once("exit", () => {
      resolve();
    });
  });
  worker.child.kill("SIGKILL");
  await exited;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const rows = await admin<{ connected: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE application_name = 'continuity-kernel-restate'
      ) AS connected
    `;
    if (rows[0]?.connected === false) return;
    await delay(25);
  }
}

async function registerDeployment(uri: string): Promise<void> {
  const response = await fetch("http://127.0.0.1:9070/deployments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri, force: true }),
  });
  if (!response.ok) {
    throw new Error(`Deployment registration failed (${String(response.status)}): ${await response.text()}`);
  }
}

async function readReceipt(commandId: string): Promise<{
  outcomeStatus: string;
  decisionCode: string;
  caseVersion: string;
  requestHash: string;
} | null> {
  const rows = await admin<{
    outcomeStatus: string;
    decisionCode: string;
    caseVersion: string;
    requestHash: string;
  }[]>`
    SELECT
      outcome_status AS "outcomeStatus",
      decision_code AS "decisionCode",
      case_version::text AS "caseVersion",
      request_hash AS "requestHash"
    FROM continuity.command_receipts
    WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${commandId}
  `;
  return rows[0] ?? null;
}

async function readCaseVersion(): Promise<string> {
  const rows = await admin<{ version: string }[]>`
    SELECT version::text AS version
    FROM continuity.cases
    WHERE namespace_id = ${fixture.namespaceId} AND case_id = ${fixture.caseId}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("Synthetic case missing");
  return row.version;
}

async function countReceipts(): Promise<number> {
  const rows = await admin<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM continuity.command_receipts
    WHERE namespace_id = ${fixture.namespaceId}
  `;
  return rows[0]?.count ?? 0;
}

async function main(): Promise<void> {
  console.log("Reference consumer — public commit path only (synthetic)\n");
  const uri = requireDeploymentUri();
  let worker: Worker | undefined;

  try {
    await resetSyntheticFixture(admin);
    worker = await spawnWorker();
    await registerDeployment(uri);

    // V1-style: out-of-scope actor must not change canonical state.
    const deniedCommandId = id("denied");
    const deniedRequest: DomainResolveCaseRequest = {
      ...structuredClone(completedRequest),
      actorId: fixture.otherAgentId,
    };
    const denied = await submitCommand(deniedCommandId, deniedRequest, id("denied-workflow"));
    const deniedReceipt = await readReceipt(deniedCommandId);
    const deniedVersion = await readCaseVersion();
    record(
      "unauthorized-reject",
      denied.status === "rejected"
        && denied.code === "AUTHORIZATION_DENIED"
        && deniedReceipt?.decisionCode === "AUTHORIZATION_DENIED"
        && deniedVersion === "3",
      `${denied.code}; case remains v${deniedVersion}`,
    );

    // Happy path accept through the public client.
    const acceptCommandId = id("accept");
    const acceptWorkflowA = id("accept-workflow-a");
    const acceptWorkflowB = id("accept-workflow-b");
    const accepted = await submitCommand(acceptCommandId, completedRequest, acceptWorkflowA);
    const acceptReceipt = await readReceipt(acceptCommandId);
    const requestHash = canonicalRequestHash(completedRequest);
    record(
      "accepted-resolve",
      accepted.status === "accepted"
        && accepted.code === "ACCEPTED"
        && accepted.caseVersion === "4"
        && acceptReceipt?.requestHash === requestHash
        && (await readCaseVersion()) === "4",
      `${accepted.code}; case v${String(accepted.caseVersion)}; hash matches receipt`,
    );

    // V2-style: duplicate command id / same request, distinct workflow key → one accept receipt.
    const duplicate = await submitCommand(acceptCommandId, completedRequest, acceptWorkflowB);
    const receiptCountAfterDuplicate = await countReceipts();
    const versionAfterDuplicate = await readCaseVersion();
    record(
      "duplicate-idempotent",
      duplicate.status === "accepted"
        && duplicate.code === "ACCEPTED"
        && duplicate.commandId === acceptCommandId
        && receiptCountAfterDuplicate === 2
        && versionAfterDuplicate === "4",
      `second submit status=${duplicate.status}; receipts=${String(receiptCountAfterDuplicate)}; case v${versionAfterDuplicate}`,
    );

    // V3-style: stale expected version must conflict without rewriting state.
    const staleCommandId = id("stale");
    const staleRequest: DomainResolveCaseRequest = {
      ...structuredClone(completedRequest),
      expectedCaseVersion: "3",
      worldTime: "2026-07-11T10:00:05Z",
    };
    const stale = await submitCommand(staleCommandId, staleRequest, id("stale-workflow"));
    record(
      "stale-version-conflict",
      stale.status === "rejected"
        && stale.code === "EXPECTED_VERSION_CONFLICT"
        && (await readCaseVersion()) === "4",
      `${stale.code}; case remains v${await readCaseVersion()}`,
    );

    // Second synthetic action: cancelled resolution on a fresh open case proves the
    // consumer is not hard-wired to a single happy-path fixture shape only.
    await resetSyntheticFixture(admin);
    const cancelCommandId = id("cancel");
    const cancelRequest: DomainResolveCaseRequest = {
      ...structuredClone(completedRequest),
      actionPayload: {
        ...completedRequest.actionPayload,
        resolution: "cancelled",
      },
    };
    const cancelled = await submitCommand(cancelCommandId, cancelRequest, id("cancel-workflow"));
    record(
      "cancelled-resolution",
      cancelled.status === "accepted"
        && cancelled.code === "ACCEPTED"
        && cancelled.caseVersion === "4"
        && (await readCaseVersion()) === "4",
      `${cancelled.code}; resolution path cancelled; case v${String(cancelled.caseVersion)}`,
    );
  } finally {
    if (worker !== undefined) await killWorker(worker);
    await admin.end({ timeout: 2 });
  }

  const failed = steps.filter((step) => !step.ok);
  console.log(`\nConsumer gate: ${String(steps.length - failed.length)}/${String(steps.length)} steps passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
    console.log("Reference consumer failed — foundation public path may be broken or topology misconfigured.");
    return;
  }
  console.log("PASS — a second in-repo consumer depends on authz, idempotency, and version conflict outcomes.");
  console.log("This does not authorize T5, claim external demand, or weaken non-claims.");
}

await main();
