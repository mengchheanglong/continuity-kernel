import { fork, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  completedRequest,
  createAdminSql,
  createAppSql,
  requestHashes,
  resetSyntheticFixture,
  serializableCommit,
} from "../tests/db-fixture.js";

interface Summary { rawMs: number[]; minMs: number; medianMs: number; maxMs: number }

const root = fileURLToPath(new URL("../", import.meta.url));
const deploymentUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
if (deploymentUri === undefined) throw new Error("CK_RESTATE_DEPLOYMENT_URI is required");

const round = (value: number) => Math.round(value * 100) / 100;
function summarize(samples: number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
  return {
    rawMs: samples.map(round),
    minMs: round(sorted[0] ?? 0),
    medianMs: round(median),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

async function endpointReadySample(): Promise<number> {
  const started = performance.now();
  const child = fork(new URL("../tests/restate-worker.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: { ...process.env, CK_FAILPOINT: undefined },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Endpoint readiness timeout")), 15_000);
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Endpoint exited ${String(code)}`)); });
      child.on("message", (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const value = message as { type?: string; error?: string };
        if (value.type === "ready") { clearTimeout(timer); resolve(); }
        if (value.type === "error") { clearTimeout(timer); reject(new Error(value.error ?? "Endpoint failed")); }
      });
    });
    return performance.now() - started;
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
    }
  }
}

interface TimedVector { durationMs: number; output: string }

async function timedVector(name: string, emitMetrics = false): Promise<TimedVector> {
  const started = performance.now();
  const output = await new Promise<string>((resolve, reject) => {
    const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
    const child = spawn(process.execPath, [
      vitest, "run", "tests/restate-crash.test.ts", "tests/restate-foundation.test.ts",
      "--no-file-parallelism", "--bail=1", "-t", name,
    ], {
      cwd: root,
      env: {
        ...process.env,
        CK_RESTATE_DEPLOYMENT_URI: deploymentUri,
        CK_GATE_D_EMIT_METRICS: emitMetrics ? "1" : undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let captured = "";
    let timedOut = false;
    const capture = (chunk: Buffer) => { captured = (captured + chunk.toString()).slice(-1_000_000); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 130_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`Measurement vector timed out: ${name}`));
      else if (code === 0) resolve(captured);
      else reject(new Error(`Measurement vector failed: ${name}`));
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  return { durationMs: performance.now() - started, output };
}

const admin = createAdminSql("continuity-gate-d-metrics-parent");
const app = createAppSql("continuity-gate-d-metrics-app");
try {
  const endpointSamples: number[] = [];
  for (let index = 0; index < 5; index += 1) endpointSamples.push(await endpointReadySample());

  const commitSamples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    await resetSyntheticFixture(admin);
    const started = performance.now();
    await serializableCommit(
      app,
      `cmd:gate-d:metrics:${randomUUID()}`,
      requestHashes.completed,
      completedRequest,
    );
    commitSamples.push(performance.now() - started);
  }

  const v4a = await timedVector("T2b-V4A");
  const v4b = await timedVector("T2b-V4B");
  const v4c = await timedVector("T2b-V4C");
  const cancellationVector = await timedVector("GateD-V3 durably cancels", true);
  const cancellationMatch = /GATE_D_CANCELLATION_CONFIRMATION_MS=(\d+)/u.exec(cancellationVector.output);
  if (cancellationMatch?.[1] === undefined) throw new Error("Cancellation confirmation metric is missing");
  const cancellationConfirmationMs = Number(cancellationMatch[1]);
  const output = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    scope: "LOCAL_SYNTHETIC_MEASUREMENT_NOT_PRODUCTION_SLO",
    endpointSpawnToReady: summarize(endpointSamples),
    canonicalCommitLatency: summarize(commitSamples),
    recoveryCompletion: {
      v4a: summarize([v4a.durationMs]),
      v4b: summarize([v4b.durationMs]),
      v4c: summarize([v4c.durationMs]),
    },
    cancellationConfirmation: summarize([cancellationConfirmationMs]),
    postCancellationObservation: summarize([5_000]),
    replayThroughput: "NOT_APPLICABLE_NO_EVENT_REPLAY",
    limitations: [
      "Local single-host synthetic measurements only",
      "Recovery and cancellation samples include focused test harness overhead",
      "Post-cancellation observation is the asserted five-second evidence window",
    ],
  };
  const outputPath = new URL("../artifacts/2026-07-11-gate-d-metrics.json", import.meta.url);
  await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
} finally {
  await Promise.all([admin.end({ timeout: 5 }), app.end({ timeout: 5 })]);
}
