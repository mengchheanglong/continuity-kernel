import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { selectProposal } from "../src/actor/deterministic.js";
import { actorChildObservationFixture } from "../tests/actor-child-fixture.js";
import { createActorIntegrationHarness } from "../tests/actor-observation-fixture.js";

interface Measurement {
  harnessInclusive: boolean;
  rawMs: number[];
  minMs: number;
  medianMs: number;
  maxMs: number;
}

interface Cleanup {
  actorChildren: number;
  workers: number;
  datasourceBackends: number;
  advisoryLocks: number;
}

type BoundedResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected" }
  | { status: "timeout" };

type ProcessResult =
  | { kind: "close"; code: number | null }
  | { kind: "error" };

const sourceCommit = "32b9fe7fe0151e6bf9090a0c30a55b65f0afc292";
const root = fileURLToPath(new URL("../", import.meta.url));
const artifact = fileURLToPath(new URL("../artifacts/2026-07-12-t4r-metrics.json", import.meta.url));
const temporary = `${artifact}.tmp`;
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const outputLimit = 262_144;
const timeoutMs = 180_000;
const markerPattern = /(?:^|\r?\n)T4R_METRIC_MS=(\d+(?:\.\d+)?)(?=\r?\n|$)/gu;
const forbidden = [
  "payloadRef", "authorizationGrant", "namespaceId", "caseId", "actorId", "commandId",
  "requestHash", "proposalDigest", "postgres://", "http://", "https://",
  "CK_RESTATE_DEPLOYMENT_URI", "rawOutput", "password", "token",
];

function assert(condition: boolean): asserts condition {
  if (!condition) throw new Error("T4R_METRICS_FAILED");
}

function round(value: number): number {
  assert(Number.isFinite(value) && value >= 0);
  return Math.round(value * 100) / 100;
}

function summarize(harnessInclusive: boolean, samples: number[]): Measurement {
  assert(samples.length > 0);
  const rawMs = samples.map(round);
  const sorted = [...rawMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
  return {
    harnessInclusive,
    rawMs,
    minMs: sorted[0] ?? 0,
    medianMs: round(median),
    maxMs: sorted.at(-1) ?? 0,
  };
}

function pureProposalEvaluation(): Measurement {
  const samples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const preparedInput = structuredClone(actorChildObservationFixture);
    const started = performance.now();
    selectProposal(preparedInput);
    samples.push(performance.now() - started);
  }
  return summarize(false, samples);
}

function deterministicRepeatEquality(): Measurement & { equal: true } {
  const first = selectProposal(structuredClone(actorChildObservationFixture));
  const samples: number[] = [];
  let equal = true;
  for (let index = 0; index < 5; index += 1) {
    const preparedInput = structuredClone(actorChildObservationFixture);
    const started = performance.now();
    const next = selectProposal(preparedInput);
    samples.push(performance.now() - started);
    equal &&= JSON.stringify(next) === JSON.stringify(first);
  }
  assert(equal);
  return { equal: true, ...summarize(false, samples) };
}

async function waitBounded<T>(promise: Promise<T>, durationMs = 5_000): Promise<BoundedResult<T>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then<BoundedResult<T>, BoundedResult<T>>(
        (value) => ({ status: "fulfilled", value }),
        () => ({ status: "rejected" }),
      ),
      new Promise<BoundedResult<T>>((resolve) => {
        timer = setTimeout(() => { resolve({ status: "timeout" }); }, durationMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function terminateTree(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  let treeSucceeded = process.platform !== "win32";
  let helperCleanupSucceeded = true;
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      const killerClosed = new Promise<ProcessResult>((resolve) => {
        killer.once("close", (code) => { resolve({ kind: "close", code }); });
        killer.once("error", () => { resolve({ kind: "error" }); });
      });
      const result = await waitBounded(killerClosed);
      if (result.status === "timeout") {
        let helperKillAccepted = false;
        try {
          helperKillAccepted = killer.kill("SIGKILL");
        } catch {
          helperKillAccepted = false;
        }
        const helperClose = await waitBounded(killerClosed, 1_000);
        helperCleanupSucceeded = helperKillAccepted && helperClose.status === "fulfilled" &&
          helperClose.value.kind === "close";
        treeSucceeded = false;
      } else {
        treeSucceeded = result.status === "fulfilled" && result.value.kind === "close" &&
          result.value.code === 0;
      }
    } catch {
      treeSucceeded = false;
      helperCleanupSucceeded = false;
    }
  }
  let directSucceeded: boolean;
  try {
    directSucceeded = child.kill("SIGKILL");
  } catch {
    directSucceeded = false;
  }
  const terminationSucceeded = process.platform === "win32" ? treeSucceeded : directSucceeded;
  return terminationSucceeded && helperCleanupSucceeded;
}

async function focusedMetric(title: string, metric: string): Promise<number> {
  assert(process.env.CK_RESTATE_DEPLOYMENT_URI !== undefined);
  const child = spawn(process.execPath, [
    vitest, "run", "tests/restate-actor.test.ts", "--no-file-parallelism", "--bail=1", "-t", title,
  ], {
    cwd: root,
    env: { ...process.env, T4R_METRIC: metric },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let captured = Buffer.alloc(0);
  const capture = (chunk: Buffer): void => {
    captured = Buffer.concat([captured, chunk]).subarray(-outputLimit);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  let timer: NodeJS.Timeout | undefined;
  const closed = new Promise<number | null>((resolve) => {
    child.once("close", (code) => { resolve(code); });
  });
  const spawnFailed = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
  });
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error("T4R_METRICS_FAILED")); }, timeoutMs);
    });
    const code = await Promise.race([closed, spawnFailed, timeout]);
    assert(code === 0);
  } catch {
    const termination = await waitBounded(terminateTree(child), 8_000);
    const childClose = await waitBounded(closed);
    const cleanup = await waitBounded(cleanupEvidence(), 12_000);
    assert(termination.status === "fulfilled" && termination.value &&
      childClose.status === "fulfilled" && cleanup.status === "fulfilled");
    throw new Error("T4R_METRICS_FAILED");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const matches = [...captured.toString("utf8").matchAll(markerPattern)];
  assert(matches.length === 1);
  const value = Number(matches[0]?.[1]);
  assert(Number.isFinite(value) && value >= 0);
  return value;
}

async function cleanupEvidence(): Promise<Cleanup> {
  const harness = createActorIntegrationHarness();
  const evidence = await waitBounded(harness.readCleanupEvidence());
  const closed = await waitBounded(harness.close());
  assert(evidence.status === "fulfilled" && closed.status === "fulfilled");
  const cleanup = evidence.value;
  assert(cleanup.actorChildren === 0 && cleanup.workers === 0);
  assert(cleanup.datasourceBackends === 0 && cleanup.advisoryLocks === 0);
  return cleanup;
}

function validate(output: unknown): string {
  assert(typeof output === "object" && output !== null);
  const value = output as Record<string, unknown>;
  assert(Object.keys(value).sort().join() === [
    "cleanup", "environment", "experiment", "limitations", "measurements", "privacyScan",
    "recordedAt", "schemaVersion", "sourceCommit",
  ].sort().join());
  const raw = `${JSON.stringify(output, null, 2)}\n`;
  assert(!forbidden.some((token) => raw.includes(token)));
  return raw;
}

async function main(): Promise<void> {
  await rm(artifact, { force: true });
  await rm(temporary, { force: true });
  const pure = pureProposalEvaluation();
  const repeat = deterministicRepeatEquality();
  const accepted = await focusedMetric("T4R-V3 records one accepted causal trace consistently across every available surface", "accepted");
  const duplicate = await focusedMetric("T4R-V4 returns the same stored acceptance for duplicate proposals on distinct workflows", "duplicate");
  const stale = await focusedMetric("T4R-V5 rejects a stale proposal after one exact competing transition", "stale");
  const spawned = await focusedMetric("T4R-V6 proves zero-inbound process-independent deterministic reproduction only, not restart or reacquisition", "spawn");
  const cleanup = await cleanupEvidence();
  const output = {
    schemaVersion: 1,
    experiment: "T4R",
    recordedAt: new Date().toISOString(),
    sourceCommit,
    environment: { node: process.versions.node, pnpm: "10.32.1", restateServer: "1.7.2", postgres: "18.4" },
    measurements: {
      pureProposalEvaluation: pure,
      deterministicRepeatEquality: repeat,
      acceptedConsequenceCompletion: summarize(true, [accepted]),
      duplicateConsequenceCompletion: { distinctWorkflowIds: true, ...summarize(true, [duplicate]) },
      staleRejectionCompletion: summarize(true, [stale]),
      processSpawnToReproducedProposal: summarize(true, [spawned]),
    },
    privacyScan: { artifactForbiddenMatches: 0, stdoutCapturedBytesPersisted: 0, stderrCapturedBytesPersisted: 0 },
    cleanup,
    limitations: ["local synthetic measurements only", "not a production SLO"],
  };
  const raw = validate(output);
  await mkdir(fileURLToPath(new URL("../artifacts/", import.meta.url)), { recursive: true });
  await writeFile(temporary, raw, { encoding: "utf8", flag: "wx" });
  assert((await readFile(temporary, "utf8")) === raw);
  await rename(temporary, artifact);
}

main().catch(async () => {
  await rm(temporary, { force: true }).catch(() => undefined);
  await rm(artifact, { force: true }).catch(() => undefined);
  process.stderr.write("T4R_METRICS_FAILED\n");
  process.exitCode = 1;
});
