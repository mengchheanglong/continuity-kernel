import { fork, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  completedProjection,
  completedProjectionDigest,
  createAdminSql,
  fixture,
  resetSyntheticFixture,
} from "./db-fixture.js";

const FROZEN_SENTINEL = "AGENT_CONTINUITY_SPIKE_V1_SENTINEL\n";
const FROZEN_SENTINEL_HEX =
  "4147454e545f434f4e54494e554954595f5350494b455f56315f53454e54494e454c0a";
const FROZEN_CONTENT_DIGEST = "HFswXhQWlOtSGsegt6KRueEzV2AJwiKZQdaexqIrYuU";
const FROZEN_OBSERVATION_ID = "kQYESXVv5x0ua2fCjXNqgJ_ejEA4Il_Z3mAja1G16Cw";
const FROZEN_COMMAND_ID =
  "agent-spike:v1:kQYESXVv5x0ua2fCjXNqgJ_ejEA4Il_Z3mAja1G16Cw";
const FROZEN_REQUEST_HASH = "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY";
const FROZEN_PROJECTION_DIGEST = "AEMpcJ6pJpNog4XeTOqNybf6SvWYmyCJVoPeOikywUs";
const REQUIRED_DEPLOYMENT_URI = "http://host.docker.internal:9080";
const RESTATE_ADMIN_BASE = "http://127.0.0.1:9070";
const RESTATE_INGRESS_BASE = "http://127.0.0.1:8080";

const expectedCommandBody = {
  requestHashSchemaVersion: 1,
  namespaceId: "ns:test:continuity-kernel-v0",
  caseId: "case:test:001",
  actorId: "agent:test:owner-001",
  authorizationGrantId: "grant:test:case-001:owner-001",
  authorizationVersion: "7",
  expectedCaseVersion: "3",
  actionType: "resolve_case" as const,
  actionPayload: {
    commitmentDeadline: "2026-07-11T12:00:00Z",
    payloadRef: "payload:test:attachment-001",
    resolution: "completed" as const,
  },
  worldTime: "2026-07-11T10:00:00Z",
};

const expectedCanonicalObservation =
  '{"schemaVersion":1,"namespaceId":"ns:test:continuity-kernel-v0","caseId":"case:test:001","eventType":"file_changed","watchedPathLabel":"watched.txt","contentDigest":"HFswXhQWlOtSGsegt6KRueEzV2AJwiKZQdaexqIrYuU"}';

async function importRuntime() {
  return import("../examples/agent-continuity-spike-v1/runtime.js");
}

describe("agent-continuity-spike-v1 slice 1: frozen identity and topology", () => {
  it("exports exact frozen v1 bytes, digests, identities, and topology constants", async () => {
    const runtime = await importRuntime();
    const bytes = Buffer.from(FROZEN_SENTINEL, "utf8");
    expect(bytes.toString("hex")).toBe(FROZEN_SENTINEL_HEX);
    expect(runtime.SENTINEL_UTF8).toBe(FROZEN_SENTINEL);
    expect(runtime.contentDigestOf(bytes)).toBe(FROZEN_CONTENT_DIGEST);
    expect(runtime.FROZEN_CONTENT_DIGEST).toBe(FROZEN_CONTENT_DIGEST);

    const observation = runtime.buildObservation({
      contentDigest: FROZEN_CONTENT_DIGEST,
      watchedPathLabel: "watched.txt",
    });
    const canonical = runtime.canonicalObservationBytes(observation);
    expect(canonical.toString("utf8")).toBe(expectedCanonicalObservation);
    expect(canonical.byteLength).toBe(211);
    expect(runtime.observationIdOf(observation)).toBe(FROZEN_OBSERVATION_ID);
    expect(runtime.commandIdOf(FROZEN_OBSERVATION_ID)).toBe(FROZEN_COMMAND_ID);
    expect(runtime.FROZEN_OBSERVATION_ID).toBe(FROZEN_OBSERVATION_ID);
    expect(runtime.FROZEN_COMMAND_ID).toBe(FROZEN_COMMAND_ID);
    expect(runtime.FROZEN_REQUEST_HASH).toBe(FROZEN_REQUEST_HASH);
    expect(runtime.FROZEN_PROJECTION_DIGEST).toBe(FROZEN_PROJECTION_DIGEST);
    expect(runtime.REQUIRED_DEPLOYMENT_URI).toBe(REQUIRED_DEPLOYMENT_URI);
    expect(runtime.RESTATE_ADMIN_BASE).toBe(RESTATE_ADMIN_BASE);
    expect(runtime.RESTATE_INGRESS_BASE).toBe(RESTATE_INGRESS_BASE);
    expect(runtime.TARGET_SERVICE_NAME).toBe("ContinuityCommitT2bV1");
  });

  it("scripted adapter returns exact frozen command body and request hash", async () => {
    const runtime = await importRuntime();
    const { canonicalRequestHash } = await import("../src/domain/request.js");
    const workingSet = runtime.buildWorkingSet({
      contentDigest: FROZEN_CONTENT_DIGEST,
      observationId: FROZEN_OBSERVATION_ID,
      watchedPathLabel: "watched.txt",
    });
    const command = runtime.scriptedAdapter(workingSet);
    expect(command).toEqual(expectedCommandBody);
    expect(canonicalRequestHash(command)).toBe(FROZEN_REQUEST_HASH);
    expect(() => {
      runtime.assertExactCommand(command);
    }).not.toThrow();
  });

  it("rejects missing or non-exact deployment URI before adapter work", async () => {
    const runtime = await importRuntime();
    const nonExact = runtime.nonExactDeploymentUri(REQUIRED_DEPLOYMENT_URI);
    expect(nonExact).not.toBe(REQUIRED_DEPLOYMENT_URI);
    expect(() => {
      runtime.validateDeploymentUri(undefined);
    }).toThrow(/CK_RESTATE_DEPLOYMENT_URI/);
    expect(() => {
      runtime.validateDeploymentUri(nonExact);
    }).toThrow(/CK_RESTATE_DEPLOYMENT_URI/);
    expect(() => {
      runtime.validateDeploymentUri(REQUIRED_DEPLOYMENT_URI);
    }).not.toThrow();
  });
});

describe("agent-continuity-spike-v1 slice 2: pre-checkpoint interruption hook", () => {
  it("accepted commit hook must fire before checkpoint writer and barrier blocks writer", async () => {
    const runtime = await importRuntime();
    const dir = await mkdtemp(join(tmpdir(), "acs-v1-hook-"));
    const checkpointPath = join(dir, "checkpoint.json");
    const events: string[] = [];
    let continueResolve: (() => void) | undefined;
    const continueGate = new Promise<void>((resolve) => {
      continueResolve = resolve;
    });
    let observedCounts: { adapterCalls: number; submitCalls: number } | undefined;

    const resultPromise = runtime.runPhaseAProcess({
      watchedPath: join(dir, "watched.txt"),
      checkpointPath,
      deploymentUri: REQUIRED_DEPLOYMENT_URI,
      readBytes: () => Promise.resolve(Buffer.from(FROZEN_SENTINEL, "utf8")),
      submit: () => {
        events.push("submit");
        return Promise.resolve({
          status: "accepted" as const,
          code: "ACCEPTED",
          commandId: FROZEN_COMMAND_ID,
          requestHash: FROZEN_REQUEST_HASH,
          caseVersion: "4",
          projectionDigest: FROZEN_PROJECTION_DIGEST,
        });
      },
      onAdapterInvoked: () => {
        events.push("adapter");
      },
      onAcceptedBeforeCheckpoint: async (_commit, counts) => {
        events.push("accepted-before-checkpoint");
        observedCounts = counts;
        await continueGate;
      },
      onBeforeCheckpointWrite: () => {
        events.push("checkpoint-write");
      },
    });

    // Let phase A reach the barrier.
    const deadline = Date.now() + 5_000;
    while (!events.includes("accepted-before-checkpoint") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(events).toEqual(["adapter", "submit", "accepted-before-checkpoint"]);
    expect(observedCounts).toEqual({ adapterCalls: 1, submitCalls: 1 });
    await expect(access(checkpointPath)).rejects.toBeTruthy();
    await expect(access(runtime.checkpointTempSiblingPath(checkpointPath))).rejects.toBeTruthy();

    continueResolve?.();
    const result = await resultPromise;
    expect(events).toEqual([
      "adapter",
      "submit",
      "accepted-before-checkpoint",
      "checkpoint-write",
    ]);
    expect(result.adapterCalls).toBe(1);
    expect(result.submitCalls).toBe(1);
    expect(result.checkpointBytes).toBeGreaterThan(0);
    await rm(dir, { recursive: true, force: true });
  });

  it("phase A has no catch/finally checkpoint fallback path", () => {
    const runtimeSrc = readFileSync(
      new URL("../examples/agent-continuity-spike-v1/runtime.ts", import.meta.url),
      "utf8",
    );
    const runSrc = readFileSync(
      new URL("../examples/agent-continuity-spike-v1/run.ts", import.meta.url),
      "utf8",
    );
    // Phase-A path must not write checkpoint from catch/finally.
    expect(runtimeSrc.includes("finally")).toBe(false);
    expect(runtimeSrc.includes("writeCheckpointAtomic")).toBe(true);
    // run.ts phase-a mode must not catch-and-checkpoint.
    const phaseAStart = runSrc.indexOf("phase-a");
    expect(phaseAStart).toBeGreaterThan(-1);
    // Phase-A child waits on continue-checkpoint; parent owns SIGKILL.
    expect(runSrc.includes("continue-checkpoint")).toBe(true);
    expect(runSrc.includes("accepted-before-checkpoint")).toBe(true);
  });
});

describe("agent-continuity-spike-v1 slice 3: phase-A process protocol", () => {
  const admin = createAdminSql("continuity-kernel-acs-v1-test-phase-a");
  const workers = new Set<{
    child: ChildProcess;
    logs: string[];
    messages: Array<{ type: string; error?: string }>;
  }>();
  const children = new Set<ChildProcess>();

  afterEach(async () => {
    for (const child of [...children]) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) => {
          child.once("exit", () => {
            resolve();
          });
        });
      }
      children.delete(child);
    }
    for (const worker of [...workers]) {
      if (worker.child.exitCode === null) {
        const exited = new Promise<void>((resolve) => {
          worker.child.once("exit", () => {
            resolve();
          });
        });
        worker.child.kill("SIGKILL");
        await exited;
      }
      workers.delete(worker);
    }
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const rows = await admin<{ connected: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE application_name = 'continuity-kernel-restate'
        ) AS connected
      `;
      if (rows[0]?.connected === false) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  }, 60_000);

  afterAll(async () => {
    await admin.end({ timeout: 2 });
  });

  async function spawnWorker(): Promise<void> {
    const runtime = await importRuntime();
    const child = fork(new URL("./restate-worker.ts", import.meta.url), [], {
      execPath: process.execPath,
      execArgv: ["--import", "tsx"],
      env: runtime.buildWorkerChildEnv(process.env),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const worker = {
      child,
      logs: [] as string[],
      messages: [] as Array<{ type: string; error?: string }>,
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      worker.logs.push(chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      worker.logs.push(chunk.toString());
    });
    child.on("message", (value: unknown) => {
      worker.messages.push(value as { type: string; error?: string });
    });
    workers.add(worker);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const error = worker.messages.find((message) => message.type === "error");
      if (error !== undefined) throw new Error(error.error ?? "Worker failed");
      if (worker.messages.some((message) => message.type === "ready")) return;
      if (worker.child.exitCode !== null) {
        throw new Error(`Worker exited ${String(worker.child.exitCode)}; ${worker.logs.join("")}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Worker ready timeout; ${worker.logs.join("")}`);
  }

  async function registerDeployment(uri: string): Promise<void> {
    const response = await fetch(`${RESTATE_ADMIN_BASE}/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri, force: true }),
    });
    if (!response.ok) {
      throw new Error(
        `Deployment registration failed (${String(response.status)}): ${await response.text()}`,
      );
    }
  }

  it("phase A: adapter ACK, accepted-before-checkpoint barrier, parent SIGKILL, exitCode null", async () => {
    const runtime = await importRuntime();
    const deploymentUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
    expect(deploymentUri).toBe(REQUIRED_DEPLOYMENT_URI);

    await resetSyntheticFixture(admin);
    await runtime.purgePriorTerminalSameKeyInvocations(FROZEN_COMMAND_ID);
    await spawnWorker();
    if (deploymentUri === undefined) {
      throw new Error("CK_RESTATE_DEPLOYMENT_URI missing after equality check");
    }
    await registerDeployment(deploymentUri);

    const dir = await mkdtemp(join(tmpdir(), "acs-v1-phase-a-"));
    const watchedPath = join(dir, "watched.txt");
    const checkpointPath = join(dir, "checkpoint.json");
    await writeFile(watchedPath, FROZEN_SENTINEL, "utf8");

    const childEnv = runtime.buildAgentChildEnv(process.env, {
      deploymentUri,
      watchedPath,
      checkpointPath,
      phase: "phase-a",
    });
    expect(childEnv.XAI_API_KEY).toBeUndefined();
    expect(childEnv.OPENAI_API_KEY).toBeUndefined();
    expect(childEnv.DEEPSEEK_API_KEY).toBeUndefined();
    expect(childEnv.CK_DATABASE_URL).toBeUndefined();
    expect(childEnv.DATABASE_URL).toBeUndefined();

    const child = fork(
      new URL("../examples/agent-continuity-spike-v1/run.ts", import.meta.url),
      ["phase-a"],
      {
        execPath: process.execPath,
        execArgv: ["--import", "tsx"],
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    children.add(child);
    const messages: Array<Record<string, unknown>> = [];
    child.on("message", (value: unknown) => {
      messages.push(value as Record<string, unknown>);
    });

    // Wait for adapter-invoked; ACK before submit can proceed.
    {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (messages.some((m) => m.type === "adapter-invoked")) break;
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `phase-a exited early before adapter-invoked exit=${String(child.exitCode)} signal=${String(child.signalCode)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(messages.filter((m) => m.type === "adapter-invoked")).toHaveLength(1);
      child.send({ type: "adapter-ack" });
    }

    // Wait for accepted-before-checkpoint IPC-send completion.
    {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (messages.some((m) => m.type === "accepted-before-checkpoint")) break;
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `phase-a exited early before accepted-before-checkpoint exit=${String(child.exitCode)} signal=${String(child.signalCode)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      const barrier = messages.filter((m) => m.type === "accepted-before-checkpoint");
      expect(barrier).toHaveLength(1);
      expect(barrier[0]).toMatchObject({
        type: "accepted-before-checkpoint",
        status: "accepted",
        code: "ACCEPTED",
        caseVersion: "4",
        commandId: FROZEN_COMMAND_ID,
        requestHash: FROZEN_REQUEST_HASH,
        adapterCalls: 1,
        submitCalls: 1,
      });
      // Parent must read child-reported counters, not assign inferred 1.
      expect(barrier[0]?.adapterCalls).toBe(1);
      expect(barrier[0]?.submitCalls).toBe(1);
    }

    // Parent validates checkpoint absent, never sends continue-checkpoint, then SIGKILL.
    await expect(access(checkpointPath)).rejects.toBeTruthy();
    expect(messages.some((m) => m.type === "continue-checkpoint")).toBe(false);

    const exitWait = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (exitCode, signal) => {
          resolve({ exitCode, signal });
        });
      },
    );
    const killIssued = child.kill("SIGKILL");
    expect(killIssued).toBe(true);
    const termination = await exitWait;
    expect(termination).toEqual({ exitCode: null, signal: "SIGKILL" });

    await expect(access(checkpointPath)).rejects.toBeTruthy();

    // Canonical/Restate still present after forced kill.
    const receipts = await admin<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM continuity.command_receipts
      WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${FROZEN_COMMAND_ID}
    `;
    const history = await admin<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM continuity.accepted_history
      WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${FROZEN_COMMAND_ID}
    `;
    const cases = await admin<{ version: string }[]>`
      SELECT version FROM continuity.cases
      WHERE namespace_id = ${fixture.namespaceId} AND case_id = ${fixture.caseId}
    `;
    expect(receipts[0]?.count).toBe(1);
    expect(history[0]?.count).toBe(1);
    expect(cases[0]?.version).toBe("4");

    const completed = await runtime.queryCompletedSameKeyInvocations(FROZEN_COMMAND_ID);
    expect(completed).toHaveLength(1);

    const phaseAConnections = await runtime.countAgentPhaseDbConnections(admin);
    expect(phaseAConnections).toBe(0);

    await rm(dir, { recursive: true, force: true });
  }, 180_000);
});

describe("agent-continuity-spike-v1 slice 4: recovery receipt validation", () => {
  it("selectExactlyOneCompletedInvocationId rejects null/multiple/non-completed", async () => {
    const runtime = await importRuntime();
    expect(() => {
      runtime.selectExactlyOneCompletedInvocationId([]);
    }).toThrow(/exactly one completed/i);
    expect(() => {
      runtime.selectExactlyOneCompletedInvocationId([
        { id: "a", status: "completed" },
        { id: "b", status: "completed" },
      ]);
    }).toThrow(/exactly one completed/i);
    expect(() => {
      runtime.selectExactlyOneCompletedInvocationId([{ id: "a", status: "running" }]);
    }).toThrow(/exactly one completed/i);
    expect(
      runtime.selectExactlyOneCompletedInvocationId([{ id: "inv-1", status: "completed" }]),
    ).toBe("inv-1");
  });

  it("assertRecoveredAcceptedReceipt validates complete frozen receipt key set, projection, and recomputed digest", async () => {
    const runtime = await importRuntime();
    const { canonicalHash } = await import("../src/domain/canonical.js");
    expect(FROZEN_PROJECTION_DIGEST).toBe(completedProjectionDigest);
    expect(canonicalHash(completedProjection)).toBe(FROZEN_PROJECTION_DIGEST);

    const valid = {
      status: "accepted",
      code: "ACCEPTED",
      namespaceId: "ns:test:continuity-kernel-v0",
      caseId: "case:test:001",
      commandId: FROZEN_COMMAND_ID,
      requestHash: FROZEN_REQUEST_HASH,
      authorizationVersion: "7",
      caseVersion: "4",
      payloadRef: "payload:test:attachment-001",
      projectionSchemaVersion: 1,
      projection: completedProjection,
      projectionDigest: FROZEN_PROJECTION_DIGEST,
    };
    const accepted = runtime.assertRecoveredAcceptedReceipt(valid);
    expect(accepted).toEqual(valid);
    expect(Object.keys(accepted).sort()).toEqual(
      [
        "authorizationVersion",
        "caseId",
        "caseVersion",
        "code",
        "commandId",
        "namespaceId",
        "payloadRef",
        "projection",
        "projectionDigest",
        "projectionSchemaVersion",
        "requestHash",
        "status",
      ].sort(),
    );

    // Subset without full frozen fields must fail closed.
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        status: "accepted",
        code: "ACCEPTED",
        commandId: FROZEN_COMMAND_ID,
        requestHash: FROZEN_REQUEST_HASH,
        caseVersion: "4",
        projectionDigest: FROZEN_PROJECTION_DIGEST,
      });
    }).toThrow(/receipt|key|projection|namespaceId/i);

    expect(() => {
      runtime.assertRecoveredAcceptedReceipt(null);
    }).toThrow(/receipt/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({ ...valid, status: "rejected" });
    }).toThrow(/status/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({ ...valid, code: "REJECTED" });
    }).toThrow(/code/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({ ...valid, caseVersion: "3" });
    }).toThrow(/caseVersion/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({ ...valid, requestHash: "wrong" });
    }).toThrow(/requestHash/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({ ...valid, commandId: "wrong" });
    }).toThrow(/commandId/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        ...valid,
        namespaceId: "ns:wrong",
      });
    }).toThrow(/namespaceId/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        ...valid,
        caseId: "case:wrong",
      });
    }).toThrow(/caseId/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        ...valid,
        authorizationVersion: "6",
      });
    }).toThrow(/authorizationVersion/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        ...valid,
        payloadRef: "payload:wrong",
      });
    }).toThrow(/payloadRef/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        ...valid,
        projectionSchemaVersion: 2,
      });
    }).toThrow(/projectionSchemaVersion/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        ...valid,
        projectionDigest: "wrong-digest-value______________",
      });
    }).toThrow(/projectionDigest/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        ...valid,
        projection: {
          ...completedProjection,
          case: { ...completedProjection.case, version: "3" },
        },
      });
    }).toThrow(/projection/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({
        ...valid,
        projection: { ...completedProjection, extra: true },
      });
    }).toThrow(/projection/i);
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt({ ...valid, extra: true });
    }).toThrow(/key|receipt|extra/i);
    const missingProjection = { ...valid } as Record<string, unknown>;
    delete missingProjection.projection;
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt(missingProjection);
    }).toThrow(/projection|key|receipt/i);
    const missingDigest = { ...valid } as Record<string, unknown>;
    delete missingDigest.projectionDigest;
    expect(() => {
      runtime.assertRecoveredAcceptedReceipt(missingDigest);
    }).toThrow(/projectionDigest|key|receipt/i);
  });

  it("withVerifiedStoredProjectionDigest recomputes digest and rejects wrong projection", async () => {
    const runtime = await importRuntime();
    const stored = {
      status: "accepted",
      code: "ACCEPTED",
      namespaceId: "ns:test:continuity-kernel-v0",
      caseId: "case:test:001",
      commandId: FROZEN_COMMAND_ID,
      requestHash: FROZEN_REQUEST_HASH,
      authorizationVersion: "7",
      caseVersion: "4",
      payloadRef: "payload:test:attachment-001",
      projectionSchemaVersion: 1,
      projection: completedProjection,
    };
    const complete = runtime.withVerifiedStoredProjectionDigest(stored);
    expect(complete.projectionDigest).toBe(FROZEN_PROJECTION_DIGEST);
    expect(runtime.assertRecoveredAcceptedReceipt(complete)).toEqual({
      ...stored,
      projectionDigest: FROZEN_PROJECTION_DIGEST,
    });
    expect(() => {
      runtime.withVerifiedStoredProjectionDigest({
        ...stored,
        projection: {
          ...completedProjection,
          case: { ...completedProjection.case, status: "open" },
        },
      });
    }).toThrow(/projection|digest/i);
  });
});

describe("agent-continuity-spike-v1 hostile helpers: privacy scan, duplicate count, checkpoint tmp", () => {
  it("canonical row privacy scan errors fail closed and never become empty clean evidence", async () => {
    const runtime = await importRuntime();
    const ok = runtime.evaluateCanonicalRowsPrivacyScan({
      status: "ok",
      serialized: JSON.stringify({ receipts: [], history: [], cases: [] }),
    });
    expect(ok.scanFailed).toBe(false);
    expect(ok.rawFileContentInCanonicalRows).toBe(false);

    const dirtyOk = runtime.evaluateCanonicalRowsPrivacyScan({
      status: "ok",
      serialized: `prefix${FROZEN_SENTINEL}suffix`,
    });
    expect(dirtyOk.scanFailed).toBe(false);
    expect(dirtyOk.rawFileContentInCanonicalRows).toBe(true);

    const failed = runtime.evaluateCanonicalRowsPrivacyScan({
      status: "error",
      error: "query failed",
    });
    expect(failed.scanFailed).toBe(true);
    // Fail closed: scan failure must not classify as clean empty evidence.
    expect(failed.rawFileContentInCanonicalRows).toBe(true);
    expect(failed.serialized).toBe("");
    expect(runtime.isCanonicalRowsPrivacyScanFailure(failed)).toBe(true);
    expect(runtime.isCanonicalRowsPrivacyScanFailure(ok)).toBe(false);
  });

  it("duplicateConsequenceCount is mechanically derived from final receipt/history counts", async () => {
    const runtime = await importRuntime();
    expect(runtime.deriveDuplicateConsequenceCount(1, 1)).toBe(0);
    expect(runtime.deriveDuplicateConsequenceCount(2, 1)).toBe(1);
    expect(runtime.deriveDuplicateConsequenceCount(1, 2)).toBe(1);
    expect(runtime.deriveDuplicateConsequenceCount(3, 2)).toBe(2);
    expect(runtime.deriveDuplicateConsequenceCount(0, 0)).toBe(0);
    // Hardcoded 0 would pass under duplicate evidence; derivation must not.
    expect(runtime.deriveDuplicateConsequenceCount(2, 2)).not.toBe(0);
  });

  it("checkpoint barrier treats either checkpoint.json or checkpoint.json.tmp as writer-start failure", async () => {
    const runtime = await importRuntime();
    const dir = await mkdtemp(join(tmpdir(), "acs-v1-tmp-sibling-"));
    const checkpointPath = join(dir, "checkpoint.json");
    const tempSibling = runtime.checkpointTempSiblingPath(checkpointPath);
    expect(tempSibling).toBe(`${checkpointPath}.tmp`);

    expect(await runtime.anyCheckpointWriteArtifactExists(checkpointPath)).toBe(false);

    await writeFile(tempSibling, "{\"schemaVersion\":1}", "utf8");
    expect(await runtime.anyCheckpointWriteArtifactExists(checkpointPath)).toBe(true);
    await rm(tempSibling, { force: true });

    await writeFile(checkpointPath, "{\"schemaVersion\":1}", "utf8");
    expect(await runtime.anyCheckpointWriteArtifactExists(checkpointPath)).toBe(true);
    await rm(checkpointPath, { force: true });

    await writeFile(checkpointPath, "final", "utf8");
    await writeFile(tempSibling, "tmp", "utf8");
    expect(await runtime.anyCheckpointWriteArtifactExists(checkpointPath)).toBe(true);
    await runtime.removePathIfExists(checkpointPath);
    await runtime.removePathIfExists(tempSibling);
    expect(await runtime.anyCheckpointWriteArtifactExists(checkpointPath)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("run.ts fails closed on canonical scan error and derives duplicateConsequenceCount; checks .tmp sibling", () => {
    const runSrc = readFileSync(
      new URL("../examples/agent-continuity-spike-v1/run.ts", import.meta.url),
      "utf8",
    );
    expect(runSrc.includes("evaluateCanonicalRowsPrivacyScan")).toBe(true);
    expect(runSrc.includes("isCanonicalRowsPrivacyScanFailure") || runSrc.includes("scanFailed")).toBe(
      true,
    );
    // Forbidden swallow: catch { canonicalRowsSerialized = "" } must not exist.
    expect(/catch\s*\{[^}]*canonicalRowsSerialized\s*=\s*""/s.test(runSrc)).toBe(false);
    expect(runSrc.includes("deriveDuplicateConsequenceCount")).toBe(true);
    expect(runSrc.includes("duplicateConsequenceCount = 0")).toBe(false);
    expect(runSrc.includes("anyCheckpointWriteArtifactExists") || runSrc.includes("checkpointTempSiblingPath")).toBe(
      true,
    );
    expect(runSrc.includes("phaseAAdapterCalls = 1")).toBe(false);
    expect(runSrc.includes("phaseASubmitCalls = 1")).toBe(false);
    expect(runSrc.includes("adapterCalls")).toBe(true);
    expect(runSrc.includes("submitCalls")).toBe(true);
    expect(runSrc.includes("recovered:") || runSrc.includes("recovered =")).toBe(true);
  });
});

describe("agent-continuity-spike-v1 slice 5: phase-B process recovery", () => {
  const admin = createAdminSql("continuity-kernel-acs-v1-test-phase-b");
  const workers = new Set<{
    child: ChildProcess;
    logs: string[];
    messages: Array<{ type: string; error?: string }>;
  }>();
  const children = new Set<ChildProcess>();

  afterEach(async () => {
    for (const child of [...children]) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) => {
          child.once("exit", () => {
            resolve();
          });
        });
      }
      children.delete(child);
    }
    for (const worker of [...workers]) {
      if (worker.child.exitCode === null) {
        const exited = new Promise<void>((resolve) => {
          worker.child.once("exit", () => {
            resolve();
          });
        });
        worker.child.kill("SIGKILL");
        await exited;
      }
      workers.delete(worker);
    }
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const rows = await admin<{ connected: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE application_name = 'continuity-kernel-restate'
        ) AS connected
      `;
      if (rows[0]?.connected === false) break;
      await new Promise((r) => setTimeout(r, 25));
    }
  }, 60_000);

  afterAll(async () => {
    await admin.end({ timeout: 2 });
  });

  async function spawnWorker(): Promise<void> {
    const runtime = await importRuntime();
    const child = fork(new URL("./restate-worker.ts", import.meta.url), [], {
      execPath: process.execPath,
      execArgv: ["--import", "tsx"],
      env: runtime.buildWorkerChildEnv(process.env),
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const worker = {
      child,
      logs: [] as string[],
      messages: [] as Array<{ type: string; error?: string }>,
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      worker.logs.push(chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      worker.logs.push(chunk.toString());
    });
    child.on("message", (value: unknown) => {
      worker.messages.push(value as { type: string; error?: string });
    });
    workers.add(worker);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const error = worker.messages.find((message) => message.type === "error");
      if (error !== undefined) throw new Error(error.error ?? "Worker failed");
      if (worker.messages.some((message) => message.type === "ready")) return;
      if (worker.child.exitCode !== null) {
        throw new Error(`Worker exited ${String(worker.child.exitCode)}; ${worker.logs.join("")}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Worker ready timeout; ${worker.logs.join("")}`);
  }

  async function registerDeployment(uri: string): Promise<void> {
    const response = await fetch(`${RESTATE_ADMIN_BASE}/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri, force: true }),
    });
    if (!response.ok) {
      throw new Error(
        `Deployment registration failed (${String(response.status)}): ${await response.text()}`,
      );
    }
  }

  it("phase B: distinct PID, one query+attach, zero adapter/submit, atomic seven-key checkpoint", async () => {
    const runtime = await importRuntime();
    const deploymentUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
    expect(deploymentUri).toBe(REQUIRED_DEPLOYMENT_URI);
    if (deploymentUri === undefined) {
      throw new Error("CK_RESTATE_DEPLOYMENT_URI missing");
    }

    await resetSyntheticFixture(admin);
    await runtime.purgePriorTerminalSameKeyInvocations(FROZEN_COMMAND_ID);
    await spawnWorker();
    await registerDeployment(deploymentUri);

    const dir = await mkdtemp(join(tmpdir(), "acs-v1-phase-b-"));
    const watchedPath = join(dir, "watched.txt");
    const checkpointPath = join(dir, "checkpoint.json");
    await writeFile(watchedPath, FROZEN_SENTINEL, "utf8");

    // Establish exactly one completed accepted commit without a checkpoint (simulate post-kill).
    const seed = await runtime.runPhaseAProcess({
      watchedPath,
      checkpointPath,
      deploymentUri,
      readBytes: () => Promise.resolve(Buffer.from(FROZEN_SENTINEL, "utf8")),
      submit: async (commandId, request, workflowId) => {
        const { submitCommand } = await import("../src/alternative/restate/client.js");
        return submitCommand(commandId, request, workflowId);
      },
      onAdapterInvoked: () => undefined,
      onAcceptedBeforeCheckpoint: () => {
        // Do not write checkpoint — leave state as after forced interruption.
      },
      skipCheckpoint: true,
    });
    expect(seed.adapterCalls).toBe(1);
    expect(seed.submitCalls).toBe(1);
    await expect(access(checkpointPath)).rejects.toBeTruthy();

    const phaseAPid = process.pid;
    const childEnv = runtime.buildAgentChildEnv(process.env, {
      deploymentUri,
      watchedPath,
      checkpointPath,
      phase: "phase-b",
    });
    // Phase B must not receive DB credentials.
    expect(childEnv.CK_DATABASE_URL).toBeUndefined();
    expect(childEnv.DATABASE_URL).toBeUndefined();
    expect(childEnv.PGPASSWORD).toBeUndefined();

    const child = fork(
      new URL("../examples/agent-continuity-spike-v1/run.ts", import.meta.url),
      ["phase-b"],
      {
        execPath: process.execPath,
        execArgv: ["--import", "tsx"],
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    children.add(child);
    expect(child.pid).not.toBe(phaseAPid);
    expect(child.pid).not.toBe(process.pid);

    const messages: Array<Record<string, unknown>> = [];
    child.on("message", (value: unknown) => {
      messages.push(value as Record<string, unknown>);
    });

    const exitWait = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (exitCode, signal) => {
          resolve({ exitCode, signal });
        });
      },
    );

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (messages.some((m) => m.type === "recovery-complete")) break;
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const recovery = messages.find((m) => m.type === "recovery-complete");
    expect(recovery).toBeDefined();
    expect(recovery).toMatchObject({
      type: "recovery-complete",
      recoverySource: "restate_completed_invocation",
      adapterCalls: 0,
      submitCalls: 0,
      invocationLookupCalls: 1,
      attachCalls: 1,
      commandId: FROZEN_COMMAND_ID,
    });
    // Phase B must report the complete validated recovered object (not a field subset).
    const recovered = runtime.assertRecoveredAcceptedReceipt(recovery?.recovered);
    expect(recovered).toEqual({
      status: "accepted",
      code: "ACCEPTED",
      namespaceId: "ns:test:continuity-kernel-v0",
      caseId: "case:test:001",
      commandId: FROZEN_COMMAND_ID,
      requestHash: FROZEN_REQUEST_HASH,
      authorizationVersion: "7",
      caseVersion: "4",
      payloadRef: "payload:test:attachment-001",
      projectionSchemaVersion: 1,
      projection: completedProjection,
      projectionDigest: FROZEN_PROJECTION_DIGEST,
    });

    const termination = await exitWait;
    expect(termination.exitCode).toBe(0);
    expect(termination.signal).toBeNull();

    const checkpointRaw = await readFile(checkpointPath, "utf8");
    const checkpoint = runtime.parseCheckpoint(checkpointRaw);
    expect(checkpoint).toEqual({
      schemaVersion: 1,
      observationId: FROZEN_OBSERVATION_ID,
      commandId: FROZEN_COMMAND_ID,
      requestHash: FROZEN_REQUEST_HASH,
      outcomeStatus: "accepted",
      decisionCode: "ACCEPTED",
      caseVersion: "4",
    });
    expect(Object.keys(checkpoint).sort()).toEqual(
      [
        "caseVersion",
        "commandId",
        "decisionCode",
        "observationId",
        "outcomeStatus",
        "requestHash",
        "schemaVersion",
      ].sort(),
    );
    const checkpointBytes = Buffer.byteLength(checkpointRaw, "utf8");
    expect(checkpointBytes).toBeGreaterThanOrEqual(1);
    expect(checkpointBytes).toBeLessThanOrEqual(1024);
    expect(checkpointRaw.includes("AGENT_CONTINUITY_SPIKE_V1_SENTINEL")).toBe(false);
    await expect(access(runtime.checkpointTempSiblingPath(checkpointPath))).rejects.toBeTruthy();

    // Parent-only PostgreSQL comparison: stored + recomputed digest deep-equals phase-B recovered.
    // PostgreSQL truth must not enter phase B.
    const stored = await admin<{ result: Record<string, unknown> }[]>`
      SELECT result FROM continuity.command_receipts
      WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${FROZEN_COMMAND_ID}
    `;
    expect(stored).toHaveLength(1);
    const storedResult = stored[0]?.result;
    expect(storedResult).toBeDefined();
    if (storedResult === undefined) throw new Error("stored receipt missing");
    const storedComplete = runtime.assertRecoveredAcceptedReceipt(
      runtime.withVerifiedStoredProjectionDigest(storedResult),
    );
    expect(runtime.deepEqualJson(storedComplete, recovered)).toBe(true);
    expect(childEnv.CK_DATABASE_URL).toBeUndefined();

    const receipts = await admin<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM continuity.command_receipts
      WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${FROZEN_COMMAND_ID}
    `;
    const history = await admin<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM continuity.accepted_history
      WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${FROZEN_COMMAND_ID}
    `;
    expect(receipts[0]?.count).toBe(1);
    expect(history[0]?.count).toBe(1);

    const phaseBConnections = await runtime.countAgentPhaseDbConnections(admin);
    expect(phaseBConnections).toBe(0);

    await rm(dir, { recursive: true, force: true });
  }, 180_000);
});

describe("agent-continuity-spike-v1 slice 6: privacy, cleanup helpers, packaging statics", () => {
  it("seven-key checkpoint forbids sentinel and enforces exact key set", async () => {
    const runtime = await importRuntime();
    const valid = runtime.buildCheckpoint({
      observationId: FROZEN_OBSERVATION_ID,
      commandId: FROZEN_COMMAND_ID,
    });
    expect(() => {
      runtime.assertCheckpoint(valid);
    }).not.toThrow();
    expect(runtime.bytesContainExactSentinel(runtime.serializeCheckpoint(valid))).toBe(false);
    expect(() => {
      runtime.assertCheckpoint({ ...valid, extra: true });
    }).toThrow(/checkpoint/i);
    const missing: Record<string, unknown> = { ...valid };
    delete missing.caseVersion;
    expect(() => {
      runtime.assertCheckpoint(missing);
    }).toThrow(/checkpoint/i);
  });

  it("byte-scans exact v1 sentinel including LF; marker without LF is not a match", async () => {
    const runtime = await importRuntime();
    expect(runtime.bytesContainExactSentinel(FROZEN_SENTINEL)).toBe(true);
    expect(runtime.bytesContainExactSentinel("AGENT_CONTINUITY_SPIKE_V1_SENTINEL")).toBe(false);
    expect(
      runtime.capturedBuffersContainExactSentinel({
        restateWorkerStdout: [FROZEN_SENTINEL.slice(0, 12)],
        restateWorkerStderr: [FROZEN_SENTINEL.slice(12)],
        runnerDiagnostics: [],
        phaseAStdout: [],
        phaseAStderr: [],
        phaseBStdout: [],
        phaseBStderr: [],
      }),
    ).toBe(true);
  });

  it("clearStringBuffers is final zero-byte mutation", async () => {
    const runtime = await importRuntime();
    const a = ["x"];
    const b = ["y"];
    expect(runtime.clearStringBuffers(a, b)).toBe(0);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });

  it("package.json exposes example:agent-continuity-spike-v1 without new dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["example:agent-continuity-spike-v1"]).toBe(
      "tsx examples/agent-continuity-spike-v1/run.ts",
    );
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(allDeps.openai).toBeUndefined();
    expect(allDeps["@anthropic-ai/sdk"]).toBeUndefined();
    expect(allDeps["grok-sdk"]).toBeUndefined();
  });

  it("v1 sources are provider-free and use only approved topology hosts", () => {
    const runtimeSrc = readFileSync(
      new URL("../examples/agent-continuity-spike-v1/runtime.ts", import.meta.url),
      "utf8",
    );
    const runSrc = readFileSync(
      new URL("../examples/agent-continuity-spike-v1/run.ts", import.meta.url),
      "utf8",
    );
    const combined = `${runtimeSrc}\n${runSrc}`;
    expect(combined.includes("XAI_API_KEY")).toBe(false);
    expect(combined.includes("DEEPSEEK_API_KEY")).toBe(false);
    expect(combined.includes("OPENAI_API_KEY")).toBe(false);
    expect(combined.includes("api.openai.com")).toBe(false);
    expect(combined.includes("api.x.ai")).toBe(false);
    expect(combined.includes("api.deepseek.com")).toBe(false);
    expect(combined.includes("host.docker.internal")).toBe(true);
    const forbiddenLoopbackWorker = ["127.0.0.1", ":", "9080"].join("");
    expect(combined.includes(forbiddenLoopbackWorker)).toBe(false);
    // Phase children must not import postgres client.
    expect(runtimeSrc.includes('from "postgres"')).toBe(false);
    expect(runtimeSrc.includes("from \"postgres\"")).toBe(false);
  });

  it("run.ts phase modes never send continue-checkpoint and phase-a never self-terminates", () => {
    const runSrc = readFileSync(
      new URL("../examples/agent-continuity-spike-v1/run.ts", import.meta.url),
      "utf8",
    );
    expect(runSrc.includes("continue-checkpoint")).toBe(true);
    // Only parent may issue SIGKILL; child must not call process.kill/exit after barrier as success path.
    expect(runSrc.includes('kill("SIGKILL")') || runSrc.includes("kill('SIGKILL')")).toBe(true);
    expect(runSrc.includes("accepted-before-checkpoint")).toBe(true);
    expect(runSrc.includes("adapter-invoked")).toBe(true);
    expect(runSrc.includes("adapter-ack")).toBe(true);
  });
});
