import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { submitCommand as submitRestateCommand } from "../src/alternative/restate/client.js";
import { buildCommitInput } from "../src/domain/request.js";
import {
  completedRequest,
  createAdminSql,
  fixture,
  readDomainCounts,
  readDomainState,
  readGrant,
  resetSyntheticFixture,
  revokeGrant,
} from "./db-fixture.js";

interface WorkerMessage { type: string; error?: string }
interface Worker { child: ChildProcess; logs: string[]; messages: WorkerMessage[] }
interface DecisionAudit {
  commandId: string; requestHash: string; actorId: string; authorizationGrantId: string;
  authorizationVersion: string; validatorVersion: number; decisionCode: string; payloadRef: string | null;
}

const admin = createAdminSql("continuity-kernel-gate-d-parent");
const workers = new Set<Worker>();
const id = (label: string) => `gate-d:foundation:${label}:${randomUUID()}`;

beforeEach(() => resetSyntheticFixture(admin), 30_000);
afterEach(async () => { for (const worker of [...workers]) await kill(worker); }, 60_000);
afterAll(() => admin.end());

function spawnWorker(): Worker {
  const child = fork(new URL("./restate-worker.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const worker: Worker = { child, logs: [], messages: [] };
  child.stdout?.on("data", (chunk: Buffer) => worker.logs.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => worker.logs.push(chunk.toString()));
  child.on("message", (value: unknown) => worker.messages.push(value as WorkerMessage));
  workers.add(worker);
  return worker;
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
});
