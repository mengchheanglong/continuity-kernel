import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  cancelledRequest,
  completedRequest,
  createAdminSql,
  fixture,
  requestHashes,
  resetSyntheticFixture,
} from "./db-fixture.js";

const FROZEN_SENTINEL = "AGENT_CONTINUITY_SPIKE_V0_SENTINEL\n";
const FROZEN_CONTENT_DIGEST = "uPfY8YNCovUemUJNFq4xrofJ_KcHWSJr2R_zvRV47Kc";
const FROZEN_OBSERVATION_ID = "uDiNWJ0Qs3r77_6lttDBvLBY8h8DunOP7GVm9yz86-0";
const FROZEN_COMMAND_ID = "agent-spike:v0:uDiNWJ0Qs3r77_6lttDBvLBY8h8DunOP7GVm9yz86-0";
const FROZEN_REQUEST_HASH = "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY";
const REQUIRED_DEPLOYMENT_URI = "http://host.docker.internal:9080";

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

describe("agent-continuity-spike slice 1: idle, identity, command", () => {
  it("exports exact idle constants", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    expect(runtime.IDLE_TARGET_MS).toBe(1000);
    expect(runtime.POLL_CADENCE_MS).toBe(50);
  });

  it("measures idle duration in [1000,1250] with zero adapter calls on unchanged content", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const bytes = Buffer.from(FROZEN_SENTINEL, "utf8");
    let adapterCalls = 0;
    const result = await runtime.runIdleWindow({
      readBytes: () => Promise.resolve(bytes),
      onAdapterWouldInvoke: () => {
        adapterCalls += 1;
      },
    });
    expect(result.idleDurationMs).toBeGreaterThanOrEqual(1000);
    expect(result.idleDurationMs).toBeLessThanOrEqual(1250);
    expect(result.adapterCalls).toBe(0);
    expect(adapterCalls).toBe(0);
  });

  it("derives exact observation identity and command id from sentinel bytes", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const bytes = Buffer.from(FROZEN_SENTINEL, "utf8");
    expect(bytes.toString("hex")).toBe(
      "4147454e545f434f4e54494e554954595f5350494b455f56305f53454e54494e454c0a",
    );
    const digest = runtime.contentDigestOf(bytes);
    expect(digest).toBe(FROZEN_CONTENT_DIGEST);
    const observation = runtime.buildObservation({
      contentDigest: digest,
      watchedPathLabel: "watched.txt",
    });
    const canonical = runtime.canonicalObservationBytes(observation);
    expect(canonical.byteLength).toBe(211);
    expect(runtime.observationIdOf(observation)).toBe(FROZEN_OBSERVATION_ID);
    expect(runtime.commandIdOf(FROZEN_OBSERVATION_ID)).toBe(FROZEN_COMMAND_ID);
  });

  it("scripted adapter returns exact frozen command body and request hash", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const { canonicalRequestHash } = await import("../src/domain/request.js");
    const workingSet = runtime.buildWorkingSet({
      contentDigest: FROZEN_CONTENT_DIGEST,
      observationId: FROZEN_OBSERVATION_ID,
      watchedPathLabel: "watched.txt",
    });
    const command = runtime.scriptedAdapter(workingSet);
    expect(command).toEqual(expectedCommandBody);
    expect(canonicalRequestHash(command)).toBe(FROZEN_REQUEST_HASH);
    expect(runtime.FROZEN_REQUEST_HASH).toBe(FROZEN_REQUEST_HASH);
  });

  it("rejects working set with extra/missing keys or size >1024", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const valid = runtime.buildWorkingSet({
      contentDigest: FROZEN_CONTENT_DIGEST,
      observationId: FROZEN_OBSERVATION_ID,
      watchedPathLabel: "watched.txt",
    });
    expect(runtime.workingSetByteLength(valid)).toBeLessThanOrEqual(1024);
    expect(() => {
      runtime.assertWorkingSet(valid);
    }).not.toThrow();
    expect(() => {
      runtime.assertWorkingSet({ ...valid, extra: "nope" });
    }).toThrow(/working set/i);
    const missing: Record<string, unknown> = { ...valid };
    delete missing.observationId;
    expect(() => {
      runtime.assertWorkingSet(missing);
    }).toThrow(/working set/i);
  });
});

describe("agent-continuity-spike slice 2: exact local topology", () => {
  it("fails before adapter call when CK_RESTATE_DEPLOYMENT_URI is missing or non-exact", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    // Non-exact value derived from the approved constant — no new host/IP/URL literal.
    const nonExactUri = runtime.nonExactDeploymentUri(REQUIRED_DEPLOYMENT_URI);
    expect(nonExactUri).not.toBe(REQUIRED_DEPLOYMENT_URI);
    expect(nonExactUri.startsWith(REQUIRED_DEPLOYMENT_URI)).toBe(true);

    expect(() => {
      runtime.validateDeploymentUri(undefined);
    }).toThrow(/CK_RESTATE_DEPLOYMENT_URI/);
    expect(() => {
      runtime.validateDeploymentUri("");
    }).toThrow(/CK_RESTATE_DEPLOYMENT_URI/);
    expect(() => {
      runtime.validateDeploymentUri(nonExactUri);
    }).toThrow(/CK_RESTATE_DEPLOYMENT_URI/);
    expect(() => {
      runtime.validateDeploymentUri(REQUIRED_DEPLOYMENT_URI);
    }).not.toThrow();
  });

  it("processBytes rejects non-exact deployment URI before any adapter call", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const dir = await mkdtemp(join(tmpdir(), "acs-topo-"));
    const checkpointPath = join(dir, "checkpoint.json");
    let adapterSubmitCalls = 0;
    const nonExactUri = runtime.nonExactDeploymentUri(REQUIRED_DEPLOYMENT_URI);
    const spike = new runtime.SpikeRuntime({
      checkpointPath,
      deploymentUri: nonExactUri,
      submit: () => {
        adapterSubmitCalls += 1;
        return Promise.reject(new Error("submit must not be reached"));
      },
    });
    await expect(spike.processBytes(Buffer.from(FROZEN_SENTINEL, "utf8"))).rejects.toThrow(
      /CK_RESTATE_DEPLOYMENT_URI/,
    );
    expect(adapterSubmitCalls).toBe(0);
    expect(spike.totalAdapterCalls).toBe(0);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("agent-continuity-spike slice 3: checkpoint and orderly reconstruction", () => {
  it("rejects checkpoint missing/extra/wrong-typed keys and wrong frozen fields", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const valid = runtime.buildCheckpoint({
      observationId: FROZEN_OBSERVATION_ID,
      commandId: FROZEN_COMMAND_ID,
    });
    expect(() => {
      runtime.assertCheckpoint(valid);
    }).not.toThrow();
    expect(Buffer.byteLength(runtime.serializeCheckpoint(valid), "utf8")).toBeLessThanOrEqual(1024);

    expect(() => {
      runtime.assertCheckpoint({ ...valid, extra: true });
    }).toThrow(/checkpoint/i);

    const missing: Record<string, unknown> = { ...valid };
    delete missing.caseVersion;
    expect(() => {
      runtime.assertCheckpoint(missing);
    }).toThrow(/checkpoint/i);

    expect(() => {
      runtime.assertCheckpoint({ ...valid, requestHash: "wrong" });
    }).toThrow(/requestHash/i);
    expect(() => {
      runtime.assertCheckpoint({ ...valid, outcomeStatus: "rejected" });
    }).toThrow(/outcomeStatus/i);
    expect(() => {
      runtime.assertCheckpoint({ ...valid, decisionCode: "REJECTED" });
    }).toThrow(/decisionCode/i);
    expect(() => {
      runtime.assertCheckpoint({ ...valid, caseVersion: "3" });
    }).toThrow(/caseVersion/i);
  });

  it("forbids raw sentinel in checkpoint bytes", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const valid = runtime.buildCheckpoint({
      observationId: FROZEN_OBSERVATION_ID,
      commandId: FROZEN_COMMAND_ID,
    });
    const text = runtime.serializeCheckpoint(valid);
    expect(text.includes("AGENT_CONTINUITY_SPIKE_V0_SENTINEL")).toBe(false);
    expect(text.includes(FROZEN_SENTINEL)).toBe(false);
  });

  it("after accepted commit + atomic checkpoint, reconstructed identical observation suppresses adapter", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const dir = await mkdtemp(join(tmpdir(), "acs-recon-"));
    const checkpointPath = join(dir, "checkpoint.json");
    let submitCalls = 0;
    const submit = () => {
      submitCalls += 1;
      return Promise.resolve({
        status: "accepted" as const,
        code: "ACCEPTED",
        commandId: FROZEN_COMMAND_ID,
        requestHash: FROZEN_REQUEST_HASH,
        caseVersion: "4",
      });
    };

    const first = new runtime.SpikeRuntime({
      checkpointPath,
      deploymentUri: REQUIRED_DEPLOYMENT_URI,
      submit,
    });
    const firstResult = await first.processBytes(Buffer.from(FROZEN_SENTINEL, "utf8"));
    expect(firstResult.suppressed).toBe(false);
    expect(firstResult.adapterCalls).toBe(1);
    expect(submitCalls).toBe(1);
    expect(firstResult.checkpoint?.caseVersion).toBe("4");

    const raw = await readFile(checkpointPath, "utf8");
    expect(raw.includes("AGENT_CONTINUITY_SPIKE_V0_SENTINEL")).toBe(false);

    // Orderly reconstruction: new runtime object, same checkpoint path, identical bytes.
    const reconstructed = new runtime.SpikeRuntime({
      checkpointPath,
      deploymentUri: REQUIRED_DEPLOYMENT_URI,
      submit,
    });
    const second = await reconstructed.processBytes(Buffer.from(FROZEN_SENTINEL, "utf8"));
    expect(second.suppressed).toBe(true);
    expect(second.adapterCalls).toBe(0);
    expect(submitCalls).toBe(1);
    expect(reconstructed.totalAdapterCalls).toBe(0);

    await rm(dir, { recursive: true, force: true });
  });
});

describe("agent-continuity-spike slice 4: one canonical consequence", () => {
  const admin = createAdminSql("continuity-kernel-agent-spike-test");
  const workers = new Set<{
    child: import("node:child_process").ChildProcess;
    logs: string[];
    messages: Array<{ type: string; error?: string }>;
  }>();

  afterEach(async () => {
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

  async function spawnWorker(): Promise<{
    child: import("node:child_process").ChildProcess;
    logs: string[];
    messages: Array<{ type: string; error?: string }>;
  }> {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const { fork } = await import("node:child_process");
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
      if (worker.messages.some((message) => message.type === "ready")) return worker;
      if (worker.child.exitCode !== null) {
        throw new Error(`Worker exited ${String(worker.child.exitCode)}; ${worker.logs.join("")}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Worker ready timeout; ${worker.logs.join("")}`);
  }

  async function registerDeployment(uri: string): Promise<void> {
    const response = await fetch("http://127.0.0.1:9070/deployments", {
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

  async function countCommandReceipts(commandId: string): Promise<number> {
    const rows = await admin<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM continuity.command_receipts
      WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${commandId}
    `;
    return rows[0]?.count ?? 0;
  }

  async function countAcceptedHistory(commandId: string): Promise<number> {
    const rows = await admin<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM continuity.accepted_history
      WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${commandId}
    `;
    return rows[0]?.count ?? 0;
  }

  it("first event accepts with ACCEPTED/version 4; duplicate and reconstruction add no consequence", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const { submitCommand } = await import("../src/alternative/restate/client.js");

    const deploymentUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
    expect(deploymentUri).toBe(REQUIRED_DEPLOYMENT_URI);

    await resetSyntheticFixture(admin);
    await runtime.purgePriorTerminalSameKeyInvocations(FROZEN_COMMAND_ID);
    await spawnWorker();
    if (deploymentUri === undefined) {
      throw new Error("CK_RESTATE_DEPLOYMENT_URI missing after equality check");
    }
    await registerDeployment(deploymentUri);

    const dir = await mkdtemp(join(tmpdir(), "acs-canon-"));
    const checkpointPath = join(dir, "checkpoint.json");
    const bytes = Buffer.from(FROZEN_SENTINEL, "utf8");

    const firstRuntime = new runtime.SpikeRuntime({
      checkpointPath,
      deploymentUri,
      submit: submitCommand,
    });
    const first = await firstRuntime.processBytes(bytes);
    expect(first.suppressed).toBe(false);
    expect(first.adapterCalls).toBe(1);
    expect(first.commit?.status).toBe("accepted");
    expect(first.commit?.code).toBe("ACCEPTED");
    expect(String(first.commit?.caseVersion)).toBe("4");
    expect(first.observationId).toBe(FROZEN_OBSERVATION_ID);
    expect(first.commandId).toBe(FROZEN_COMMAND_ID);

    expect(await countCommandReceipts(FROZEN_COMMAND_ID)).toBe(1);
    expect(await countAcceptedHistory(FROZEN_COMMAND_ID)).toBe(1);

    const duplicate = await firstRuntime.processBytes(bytes);
    expect(duplicate.suppressed).toBe(true);
    expect(duplicate.adapterCalls).toBe(0);
    expect(await countCommandReceipts(FROZEN_COMMAND_ID)).toBe(1);
    expect(await countAcceptedHistory(FROZEN_COMMAND_ID)).toBe(1);

    const reconstructed = new runtime.SpikeRuntime({
      checkpointPath,
      deploymentUri,
      submit: submitCommand,
    });
    const again = await reconstructed.processBytes(bytes);
    expect(again.suppressed).toBe(true);
    expect(again.adapterCalls).toBe(0);
    expect(reconstructed.totalAdapterCalls).toBe(0);
    expect(await countCommandReceipts(FROZEN_COMMAND_ID)).toBe(1);
    expect(await countAcceptedHistory(FROZEN_COMMAND_ID)).toBe(1);

    expect(requestHashes.completed).toBe(FROZEN_REQUEST_HASH);
    expect(completedRequest.actionType).toBe("resolve_case");
    expect(cancelledRequest.actionPayload.resolution).toBe("cancelled");

    await rm(dir, { recursive: true, force: true });
  }, 120_000);
});

describe("agent-continuity-spike slice 5: cleanup and packaging", () => {
  it("atomic checkpoint write leaves no temp sibling and removePathIfExists clears state", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const dir = await mkdtemp(join(tmpdir(), "acs-clean-"));
    const checkpointPath = join(dir, "checkpoint.json");
    const watchedPath = join(dir, "watched.txt");
    await writeFile(watchedPath, FROZEN_SENTINEL, "utf8");

    const checkpoint = runtime.buildCheckpoint({
      observationId: FROZEN_OBSERVATION_ID,
      commandId: FROZEN_COMMAND_ID,
    });
    const bytes = await runtime.writeCheckpointAtomic(checkpointPath, checkpoint);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(1024);

    // No leftover temp file after rename.
    await expect(access(`${checkpointPath}.tmp`)).rejects.toBeTruthy();
    const raw = await readFile(checkpointPath, "utf8");
    expect(raw.includes("AGENT_CONTINUITY_SPIKE_V0_SENTINEL")).toBe(false);

    await runtime.removePathIfExists(watchedPath);
    await runtime.removePathIfExists(checkpointPath);
    await runtime.removePathIfExists(dir);

    await expect(access(watchedPath)).rejects.toBeTruthy();
    await expect(access(checkpointPath)).rejects.toBeTruthy();
    await expect(access(dir)).rejects.toBeTruthy();
  });

  it("package.json exposes example:agent-continuity-spike script without new dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["example:agent-continuity-spike"]).toBe(
      "tsx examples/agent-continuity-spike/run.ts",
    );
    // No provider SDK dependency names introduced by this spike.
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(allDeps["openai"]).toBeUndefined();
    expect(allDeps["@anthropic-ai/sdk"]).toBeUndefined();
    expect(allDeps["grok-sdk"]).toBeUndefined();
  });

  it("runtime and run sources are provider-free (static string scan)", () => {
    const runtimeSrc = readFileSync(
      new URL("../examples/agent-continuity-spike/runtime.ts", import.meta.url),
      "utf8",
    );
    const runSrc = readFileSync(
      new URL("../examples/agent-continuity-spike/run.ts", import.meta.url),
      "utf8",
    );
    const combined = `${runtimeSrc}\n${runSrc}`;
    expect(combined.includes("XAI_API_KEY")).toBe(false);
    expect(combined.includes("DEEPSEEK_API_KEY")).toBe(false);
    expect(combined.includes("OPENAI_API_KEY")).toBe(false);
    expect(combined.includes("api.openai.com")).toBe(false);
    expect(combined.includes("api.x.ai")).toBe(false);
    expect(combined.includes("api.deepseek.com")).toBe(false);
    // Only approved deployment URI host appears; no alternate hostnames for new clients.
    expect(combined.includes("host.docker.internal")).toBe(true);
    expect(combined.includes("openai.com")).toBe(false);
    // Worker callback port 9080 must not pair with loopback host in worker sources.
    // Needle built dynamically so the test source itself stays free of that contiguous literal.
    const forbiddenLoopbackWorker = ["127.0.0.1", ":", "9080"].join("");
    expect(combined.includes(forbiddenLoopbackWorker)).toBe(false);
  });

  it("byte-scans exact sentinel including LF; marker without LF is not a match", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    expect(runtime.bytesContainExactSentinel(FROZEN_SENTINEL)).toBe(true);
    expect(runtime.bytesContainExactSentinel(Buffer.from(FROZEN_SENTINEL, "utf8"))).toBe(true);
    // Marker without trailing LF is not the frozen sequence.
    expect(runtime.bytesContainExactSentinel("AGENT_CONTINUITY_SPIKE_V0_SENTINEL")).toBe(false);
    expect(runtime.bytesContainExactSentinel("")).toBe(false);

    const checkpoint = runtime.buildCheckpoint({
      observationId: FROZEN_OBSERVATION_ID,
      commandId: FROZEN_COMMAND_ID,
    });
    expect(runtime.bytesContainExactSentinel(runtime.serializeCheckpoint(checkpoint))).toBe(false);

    const workingSet = runtime.buildWorkingSet({
      contentDigest: FROZEN_CONTENT_DIGEST,
      observationId: FROZEN_OBSERVATION_ID,
      watchedPathLabel: "watched.txt",
    });
    expect(runtime.bytesContainExactSentinel(runtime.serializeWorkingSet(workingSet))).toBe(false);

    // Split across buffer chunks must still be detected after join.
    const prefix = FROZEN_SENTINEL.slice(0, 10);
    const suffix = FROZEN_SENTINEL.slice(10);
    expect(
      runtime.capturedBuffersContainExactSentinel({
        restateWorkerStdout: [prefix],
        restateWorkerStderr: [suffix],
        runnerDiagnostics: [],
      }),
    ).toBe(true);
    expect(
      runtime.capturedBuffersContainExactSentinel({
        restateWorkerStdout: ["ok"],
        restateWorkerStderr: [],
        runnerDiagnostics: ["status=accepted"],
      }),
    ).toBe(false);
  });

  it("clearStringBuffers is a final zero-byte mutation of captured buffers", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const stdout = ["chunk-a"];
    const stderr = ["chunk-b"];
    const diagnostics = ["status=ok"];
    const remaining = runtime.clearStringBuffers(stdout, stderr, diagnostics);
    expect(remaining).toBe(0);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
    expect(diagnostics).toEqual([]);
    // A second clear remains zero and does not repopulate.
    expect(runtime.clearStringBuffers(stdout, stderr, diagnostics)).toBe(0);
  });

  it("run.ts cleanup order is scan → clear+verify → temp deletion → post-cleanup DB query; no diag after clear", () => {
    const runSrc = readFileSync(
      new URL("../examples/agent-continuity-spike/run.ts", import.meta.url),
      "utf8",
    );
    // Locate the disposal call site (not the function definition).
    const clearAt = runSrc.indexOf("capturedLogBufferBytesAfterDisposal = clearCapturedLogs()");
    expect(clearAt).toBeGreaterThan(-1);
    const afterClear = runSrc.slice(clearAt);
    // After buffer disposal: non-capturing report only — never diag().
    expect(afterClear.includes("diag(")).toBe(false);
    expect(afterClear.includes("report(")).toBe(true);

    // Pre-deletion byte-scan surfaces required by r4.
    expect(runSrc.includes("bytesContainExactSentinel")).toBe(true);
    expect(runSrc.includes("capturedBuffersContainExactSentinel")).toBe(true);
    expect(runSrc.includes("serializeSelectedCanonicalRows")).toBe(true);
    expect(runSrc.includes("serializeWorkingSet")).toBe(true);

    // r4 order contract: scan/classify → clear+verify zero → temp path deletion → post-cleanup DB query.
    const scanClassifyAt = runSrc.indexOf("rawFileContentInCapturedLogs = rawInCapturedLogs");
    const verifyZeroAt = runSrc.indexOf("capturedLogsDisposed = capturedLogBufferBytesAfterDisposal === 0");
    // First temp-path deletion after classification (watched/checkpoint/temp).
    const tempDeleteAt = runSrc.indexOf("await rm(watchedPath, { force: true })");
    const postCleanupDbAt = runSrc.indexOf("postCleanupWorkerCount = workerRows[0]?.count ?? 0");

    expect(scanClassifyAt).toBeGreaterThan(-1);
    expect(verifyZeroAt).toBeGreaterThan(-1);
    expect(tempDeleteAt).toBeGreaterThan(-1);
    expect(postCleanupDbAt).toBeGreaterThan(-1);

    expect(clearAt).toBeGreaterThan(scanClassifyAt);
    expect(verifyZeroAt).toBeGreaterThan(clearAt);
    expect(tempDeleteAt).toBeGreaterThan(verifyZeroAt);
    expect(postCleanupDbAt).toBeGreaterThan(tempDeleteAt);

    // Verify-zero failure gate must also sit before temp deletion (not after DB query).
    const disposedGateAt = runSrc.indexOf("if (!capturedLogsDisposed)");
    expect(disposedGateAt).toBeGreaterThan(verifyZeroAt);
    expect(disposedGateAt).toBeLessThan(tempDeleteAt);
  });

  it("nonExactDeploymentUri derives from approved constant without new host literals", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const derived = runtime.nonExactDeploymentUri();
    expect(derived).not.toBe(runtime.REQUIRED_DEPLOYMENT_URI);
    expect(derived.startsWith(runtime.REQUIRED_DEPLOYMENT_URI)).toBe(true);
    expect(derived).toBe(`${runtime.REQUIRED_DEPLOYMENT_URI}/not-exact`);
    // Worker implementation sources must not contain loopback+9080 as a contiguous literal.
    const runtimeSrc = readFileSync(
      new URL("../examples/agent-continuity-spike/runtime.ts", import.meta.url),
      "utf8",
    );
    const runSrc = readFileSync(
      new URL("../examples/agent-continuity-spike/run.ts", import.meta.url),
      "utf8",
    );
    const forbiddenLoopbackWorker = ["127.0.0.1", ":", "9080"].join("");
    expect(`${runtimeSrc}\n${runSrc}`.includes(forbiddenLoopbackWorker)).toBe(false);
  });
});

describe("agent-continuity-spike slice 6: prior-invocation purge filter and worker env", () => {
  it("buildSameKeyInvocationQuery is narrowly scoped to ContinuityCommitT2bV1 + key", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const query = runtime.buildSameKeyInvocationQuery(FROZEN_COMMAND_ID);
    expect(query).toContain("from sys_invocation");
    expect(query).toContain("target_service_name = 'ContinuityCommitT2bV1'");
    expect(query).toContain(`target_service_key = '${FROZEN_COMMAND_ID}'`);
    expect(query).toBe(
      "select id, status from sys_invocation"
        + " where target_service_name = 'ContinuityCommitT2bV1'"
        + ` and target_service_key = '${FROZEN_COMMAND_ID}'`,
    );
    // Escapes single quotes in the key so the filter stays literal-bound.
    const quoted = runtime.buildSameKeyInvocationQuery("key'other");
    expect(quoted).toContain("target_service_key = 'key''other'");
    // Unrelated service names must not appear as additional filters or alternatives.
    expect(query.includes("OR ")).toBe(false);
    expect(query.includes("target_service_name = '")).toBe(true);
    expect((query.match(/target_service_name/g) ?? []).length).toBe(1);
    expect((query.match(/target_service_key/g) ?? []).length).toBe(1);
  });

  it("classifySameKeyInvocations separates terminal completed from non-terminal", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    expect(runtime.isTerminalInvocationStatus("completed")).toBe(true);
    expect(runtime.isTerminalInvocationStatus("running")).toBe(false);
    expect(runtime.isTerminalInvocationStatus("pending")).toBe(false);
    expect(runtime.isTerminalInvocationStatus("scheduled")).toBe(false);

    const classified = runtime.classifySameKeyInvocations([
      { id: "inv-done", status: "completed" },
      { id: "inv-run", status: "running" },
      { id: "inv-pending", status: "pending" },
      { id: 12, status: "completed" },
      { id: "", status: "completed" },
    ]);
    expect(classified.terminalIds).toEqual(["inv-done"]);
    expect(classified.nonTerminal).toEqual([
      { id: "inv-run", status: "running" },
      { id: "inv-pending", status: "pending" },
    ]);
  });

  it("purgePriorTerminalSameKeyInvocations purges only completed and fails closed on non-terminal", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    type FetchLike = (
      input: string,
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      },
    ) => Promise<{
      ok: boolean;
      status: number;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    }>;
    const calls: Array<{ url: string; method?: string; body?: string }> = [];

    const completedOnly: FetchLike = (input, init) => {
      const url = input;
      const recorded: { url: string; method?: string; body?: string } = { url };
      if (init?.method !== undefined) recorded.method = init.method;
      if (init?.body !== undefined) recorded.body = init.body;
      calls.push(recorded);
      if (url.endsWith("/query")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(""),
          json: () =>
            Promise.resolve({
              rows: [{ id: "inv-terminal", status: "completed" }],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
      });
    };

    await expect(
      runtime.purgePriorTerminalSameKeyInvocations(FROZEN_COMMAND_ID, completedOnly),
    ).resolves.toEqual({ purged: 1 });
    expect(calls[0]?.url).toBe(`${runtime.RESTATE_ADMIN_BASE}/query`);
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      query: runtime.buildSameKeyInvocationQuery(FROZEN_COMMAND_ID),
    });
    expect(calls.some((call) => call.url.includes("/invocations/inv-terminal/purge"))).toBe(true);
    expect(calls.some((call) => call.method === "PATCH")).toBe(true);

    const nonTerminalCalls: Array<{ url: string; method?: string }> = [];
    const withRunning: FetchLike = (input, init) => {
      const url = input;
      const recorded: { url: string; method?: string } = { url };
      if (init?.method !== undefined) recorded.method = init.method;
      nonTerminalCalls.push(recorded);
      if (url.endsWith("/query")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(""),
          json: () =>
            Promise.resolve({
              rows: [
                { id: "inv-done", status: "completed" },
                { id: "inv-live", status: "running" },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
      });
    };

    await expect(
      runtime.purgePriorTerminalSameKeyInvocations(FROZEN_COMMAND_ID, withRunning),
    ).rejects.toThrow(/non-terminal/i);
    // Fail closed: no purge PATCH when any same-key invocation is non-terminal.
    expect(nonTerminalCalls.some((call) => call.method === "PATCH")).toBe(false);
    expect(nonTerminalCalls.some((call) => call.url.includes("/purge"))).toBe(false);
  });

  it("buildWorkerChildEnv forwards only the Windows/Node allowlist and omits credentials", async () => {
    const runtime = await import("../examples/agent-continuity-spike/runtime.js");
    const parent = {
      PATH: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      TMP: "C:\\Temp",
      USERPROFILE: "C:\\Users\\User",
      HOME: "/home/user",
      PATHEXT: ".COM;.EXE",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      // Credential / provider variables must never be forwarded.
      XAI_API_KEY: "secret-xai",
      DEEPSEEK_API_KEY: "secret-deepseek",
      OPENAI_API_KEY: "secret-openai",
      ANTHROPIC_API_KEY: "secret-anthropic",
      CK_RESTATE_DEPLOYMENT_URI: REQUIRED_DEPLOYMENT_URI,
      RANDOM_UNRELATED: "nope",
    } as NodeJS.ProcessEnv;

    const childEnv = runtime.buildWorkerChildEnv(parent);
    expect(childEnv.PATH).toBe(parent.PATH);
    expect(childEnv.SystemRoot).toBe(parent.SystemRoot);
    expect(childEnv.TEMP).toBe(parent.TEMP);
    expect(childEnv.TMP).toBe(parent.TMP);
    expect(childEnv.USERPROFILE).toBe(parent.USERPROFILE);
    expect(childEnv.HOME).toBe(parent.HOME);
    expect(childEnv.PATHEXT).toBe(parent.PATHEXT);
    expect(childEnv.ComSpec).toBe(parent.ComSpec);

    expect(childEnv.XAI_API_KEY).toBeUndefined();
    expect(childEnv.DEEPSEEK_API_KEY).toBeUndefined();
    expect(childEnv.OPENAI_API_KEY).toBeUndefined();
    expect(childEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(childEnv.CK_RESTATE_DEPLOYMENT_URI).toBeUndefined();
    expect(childEnv.RANDOM_UNRELATED).toBeUndefined();
    expect(Object.keys(childEnv).sort()).toEqual(
      ["ComSpec", "HOME", "PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP", "USERPROFILE"].sort(),
    );
  });

  it("run.ts uses buildWorkerChildEnv and purges prior terminal same-key invocations before submit", () => {
    const runSrc = readFileSync(
      new URL("../examples/agent-continuity-spike/run.ts", import.meta.url),
      "utf8",
    );
    expect(runSrc.includes("buildWorkerChildEnv")).toBe(true);
    expect(runSrc.includes("env: { ...process.env }")).toBe(false);
    expect(runSrc.includes("purgePriorTerminalSameKeyInvocations")).toBe(true);
    // Ordering: fixture reset, then purge, then first submit path.
    const resetAt = runSrc.indexOf("await resetSyntheticFixture(admin)");
    const purgeAt = runSrc.indexOf("await purgePriorTerminalSameKeyInvocations(FROZEN_COMMAND_ID)");
    const processAt = runSrc.indexOf("await runtime.processBytes(bytes)");
    expect(resetAt).toBeGreaterThan(-1);
    expect(purgeAt).toBeGreaterThan(resetAt);
    expect(processAt).toBeGreaterThan(purgeAt);
  });
});
