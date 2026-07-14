/**
 * Agent Continuity Spike v0 — aggregate example runner.
 *
 * Provider-free scripted adapter only. Synthetic data.
 * Does not claim abrupt crash recovery, real LLM use, or general exactly-once.
 */

import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";

import { submitCommand } from "../../src/alternative/restate/client.js";
import {
  createAdminSql,
  fixture,
  resetSyntheticFixture,
} from "../../tests/db-fixture.js";
import {
  FROZEN_COMMAND_ID,
  FROZEN_CONTENT_DIGEST,
  FROZEN_OBSERVATION_ID,
  FROZEN_REQUEST_HASH,
  IDLE_TARGET_MS,
  POLL_CADENCE_MS,
  REQUIRED_DEPLOYMENT_URI,
  SENTINEL_UTF8,
  SpikeRuntime,
  buildWorkerChildEnv,
  buildWorkingSet,
  bytesContainExactSentinel,
  capturedBuffersContainExactSentinel,
  clearStringBuffers,
  purgePriorTerminalSameKeyInvocations,
  runIdleWindow,
  serializeWorkingSet,
  validateDeploymentUri,
} from "./runtime.js";

interface CapturedLogs {
  restateWorkerStdout: string[];
  restateWorkerStderr: string[];
  runnerDiagnostics: string[];
}

interface Worker {
  child: ChildProcess;
}

const admin = createAdminSql("continuity-kernel-agent-spike-runner");
const logs: CapturedLogs = {
  restateWorkerStdout: [],
  restateWorkerStderr: [],
  runnerDiagnostics: [],
};

function diag(message: string): void {
  // Fixed labels only — never raw sentinel. Captures into runnerDiagnostics.
  logs.runnerDiagnostics.push(message);
  console.log(message);
}

/** Non-capturing console output. Safe after captured-log disposal. */
function report(message: string): void {
  console.log(message);
}

function requireDeploymentUri(): string {
  const uri = process.env.CK_RESTATE_DEPLOYMENT_URI;
  validateDeploymentUri(uri);
  return uri as string;
}

async function spawnWorker(): Promise<Worker> {
  const child = fork(new URL("../../tests/restate-worker.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    // Minimal Windows/Node allowlist only — never forward full parent env / credentials.
    env: buildWorkerChildEnv(process.env),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const messages: Array<{ type: string; error?: string }> = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    logs.restateWorkerStdout.push(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    logs.restateWorkerStderr.push(chunk.toString());
  });
  child.on("message", (value: unknown) => {
    messages.push(value as { type: string; error?: string });
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const error = messages.find((message) => message.type === "error");
    if (error !== undefined) throw new Error(error.error ?? "Worker failed");
    if (messages.some((message) => message.type === "ready")) return { child };
    if (child.exitCode !== null) {
      throw new Error(
        `Worker exited ${String(child.exitCode)}; stdout=${String(logs.restateWorkerStdout.length)} stderr=${String(logs.restateWorkerStderr.length)}`,
      );
    }
    await delay(10);
  }
  throw new Error("Worker ready timeout");
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
  throw new Error("Worker DB connection remained after kill");
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

async function countReceipts(commandId: string): Promise<number> {
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

function clearCapturedLogs(): number {
  // Final mutation of in-memory captured buffers — do not call diag() after this.
  return clearStringBuffers(
    logs.restateWorkerStdout,
    logs.restateWorkerStderr,
    logs.runnerDiagnostics,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialize selected canonical rows for this namespace/case/command for byte-scan.
 * Surfaces: command_receipts, accepted_history, cases.
 */
async function serializeSelectedCanonicalRows(commandId: string): Promise<string> {
  const receipts = await admin<Record<string, unknown>[]>`
    SELECT *
    FROM continuity.command_receipts
    WHERE namespace_id = ${fixture.namespaceId}
      AND command_id = ${commandId}
  `;
  const history = await admin<Record<string, unknown>[]>`
    SELECT *
    FROM continuity.accepted_history
    WHERE namespace_id = ${fixture.namespaceId}
      AND command_id = ${commandId}
  `;
  const cases = await admin<Record<string, unknown>[]>`
    SELECT *
    FROM continuity.cases
    WHERE namespace_id = ${fixture.namespaceId}
      AND case_id = ${fixture.caseId}
  `;
  return JSON.stringify({ receipts, history, cases });
}

async function main(): Promise<void> {
  const started = performance.now();
  diag("Agent Continuity Spike v0 — provider-free scripted adapter");
  diag(`idleTargetMs=${String(IDLE_TARGET_MS)} pollCadenceMs=${String(POLL_CADENCE_MS)}`);

  const uri = requireDeploymentUri();
  diag(`networkTopologyValid deploymentUri=${REQUIRED_DEPLOYMENT_URI}`);

  let worker: Worker | undefined;
  let tempDir: string | undefined;
  let watchedPath: string | undefined;
  let checkpointPath: string | undefined;
  let idleDurationMs = 0;
  let idleAgentAdapterCalls = 0;
  let totalAgentAdapterCalls = 0;
  let firstCommitStatus: "accepted" | "rejected" | "not_observed" = "not_observed";
  let firstDecisionCode: "ACCEPTED" | "REJECTED" | "NOT_OBSERVED" = "NOT_OBSERVED";
  let caseVersionAfter = "NOT_OBSERVED";
  let workingSetBytes = 0;
  let checkpointBytes = 0;
  let commandReceiptCount = 0;
  let acceptedHistoryCountForCommand = 0;
  let duplicateConsequenceCount = 0;
  let reconstructionConsequenceCount = 0;
  let rawFileContentPersisted = true;
  let rawFileContentInCapturedLogs = true;
  let capturedLogsDisposed = false;
  let capturedLogBufferBytesAfterDisposal = -1;
  let tempWatchedFileDeleted = false;
  let tempCheckpointDeleted = false;
  let tempDirDeleted = false;
  let postCleanupWorkerCount = -1;
  let checkpointTextForScan = "";
  let workingSetTextForScan = "";
  let canonicalRowsSerialized = "";

  try {
    tempDir = await mkdtemp(join(tmpdir(), "agent-continuity-spike-"));
    const watchedFilePath = join(tempDir, "watched.txt");
    const checkpointFilePath = join(tempDir, "checkpoint.json");
    watchedPath = watchedFilePath;
    checkpointPath = checkpointFilePath;
    await writeFile(watchedFilePath, SENTINEL_UTF8, "utf8");

    await resetSyntheticFixture(admin);
    // Restate workflow keys are operational only. After fixture reset, purge only
    // prior terminal ContinuityCommitT2bV1 invocations for the frozen command key
    // so the aggregate can commit a fresh receipt. Fail closed on non-terminal.
    await purgePriorTerminalSameKeyInvocations(FROZEN_COMMAND_ID);
    worker = await spawnWorker();
    await registerDeployment(uri);

    // Exact idle window: unchanged content, zero adapter calls.
    const idle = await runIdleWindow({
      readBytes: () => readFile(watchedFilePath),
    });
    idleDurationMs = idle.idleDurationMs;
    idleAgentAdapterCalls = idle.adapterCalls;
    if (idleDurationMs < 1000 || idleDurationMs > 1250) {
      throw new Error(`idleDurationMs out of range: ${String(idleDurationMs)}`);
    }
    if (idleAgentAdapterCalls !== 0) {
      throw new Error(`idle adapter calls must be 0; got ${String(idleAgentAdapterCalls)}`);
    }
    diag(`idleDurationMs=${String(idleDurationMs)} idleAgentAdapterCalls=0`);

    const bytes = await readFile(watchedFilePath);
    const runtime = new SpikeRuntime({
      checkpointPath: checkpointFilePath,
      deploymentUri: uri,
      submit: submitCommand,
    });
    const first = await runtime.processBytes(bytes);
    totalAgentAdapterCalls += first.adapterCalls;
    if (first.suppressed || first.adapterCalls !== 1 || first.commit === undefined) {
      throw new Error("First observation must invoke adapter once and commit");
    }
    if (
      first.commit.status !== "accepted"
      || first.commit.code !== "ACCEPTED"
      || String(first.commit.caseVersion) !== "4"
    ) {
      throw new Error(
        `First commit expected accepted/ACCEPTED/4; got ${first.commit.status}/${first.commit.code}/${String(first.commit.caseVersion)}`,
      );
    }
    if (first.observationId !== FROZEN_OBSERVATION_ID || first.commandId !== FROZEN_COMMAND_ID) {
      throw new Error("Frozen observation/command identity mismatch");
    }
    firstCommitStatus = "accepted";
    firstDecisionCode = "ACCEPTED";
    caseVersionAfter = "4";
    workingSetBytes = first.workingSetBytes ?? 0;
    checkpointBytes = first.checkpointBytes ?? 0;
    workingSetTextForScan = serializeWorkingSet(
      buildWorkingSet({
        contentDigest: FROZEN_CONTENT_DIGEST,
        observationId: FROZEN_OBSERVATION_ID,
      }),
    );
    diag(
      `firstCommit status=accepted code=ACCEPTED caseVersion=4 observationId=${FROZEN_OBSERVATION_ID} requestHash=${FROZEN_REQUEST_HASH}`,
    );

    // Same-runtime duplicate observation.
    const receiptsBeforeDup = await countReceipts(FROZEN_COMMAND_ID);
    const historyBeforeDup = await countAcceptedHistory(FROZEN_COMMAND_ID);
    const duplicate = await runtime.processBytes(bytes);
    if (!duplicate.suppressed || duplicate.adapterCalls !== 0) {
      throw new Error("Duplicate observation must suppress adapter");
    }
    const receiptsAfterDup = await countReceipts(FROZEN_COMMAND_ID);
    const historyAfterDup = await countAcceptedHistory(FROZEN_COMMAND_ID);
    duplicateConsequenceCount = Math.max(
      0,
      receiptsAfterDup - receiptsBeforeDup,
      historyAfterDup - historyBeforeDup,
    );
    if (duplicateConsequenceCount !== 0) {
      throw new Error("Duplicate observation produced extra consequence");
    }

    // Clean stop then orderly reconstruction.
    const reconstructed = new SpikeRuntime({
      checkpointPath: checkpointFilePath,
      deploymentUri: uri,
      submit: submitCommand,
    });
    const receiptsBeforeRecon = await countReceipts(FROZEN_COMMAND_ID);
    const historyBeforeRecon = await countAcceptedHistory(FROZEN_COMMAND_ID);
    const again = await reconstructed.processBytes(bytes);
    if (!again.suppressed || again.adapterCalls !== 0 || reconstructed.totalAdapterCalls !== 0) {
      throw new Error("Reconstructed observation must suppress adapter and consequence");
    }
    const receiptsAfterRecon = await countReceipts(FROZEN_COMMAND_ID);
    const historyAfterRecon = await countAcceptedHistory(FROZEN_COMMAND_ID);
    reconstructionConsequenceCount = Math.max(
      0,
      receiptsAfterRecon - receiptsBeforeRecon,
      historyAfterRecon - historyBeforeRecon,
    );
    if (reconstructionConsequenceCount !== 0) {
      throw new Error("Reconstruction produced extra consequence");
    }

    commandReceiptCount = await countReceipts(FROZEN_COMMAND_ID);
    acceptedHistoryCountForCommand = await countAcceptedHistory(FROZEN_COMMAND_ID);
    if (commandReceiptCount !== 1 || acceptedHistoryCountForCommand !== 1) {
      throw new Error(
        `Expected one receipt and one accepted history; got receipts=${String(commandReceiptCount)} history=${String(acceptedHistoryCountForCommand)}`,
      );
    }
    if (totalAgentAdapterCalls !== 1) {
      throw new Error(`totalAgentAdapterCalls must be 1; got ${String(totalAgentAdapterCalls)}`);
    }

    diag(
      `PASS_CORE receipts=${String(commandReceiptCount)} history=${String(acceptedHistoryCountForCommand)} adapterCalls=${String(totalAgentAdapterCalls)} workingSetBytes=${String(workingSetBytes)} checkpointBytes=${String(checkpointBytes)}`,
    );
  } finally {
    // Cleanup order (r4 captured-log disposal contract):
    // kill worker → exact sentinel scan/classify → clear+verify captured buffers →
    // delete watched/checkpoint/temp paths → post-cleanup DB query →
    // report via non-capturing output only (never diag after clear).
    try {
      if (worker !== undefined) {
        await killWorker(worker);
        worker = undefined;
      }

      // --- Byte-scan exact sentinel (including LF) before buffer clear or deletion ---
      if (checkpointPath !== undefined && (await pathExists(checkpointPath))) {
        checkpointTextForScan = await readFile(checkpointPath, "utf8");
      }
      if (workingSetTextForScan.length === 0 && firstCommitStatus === "accepted") {
        workingSetTextForScan = serializeWorkingSet(
          buildWorkingSet({
            contentDigest: FROZEN_CONTENT_DIGEST,
            observationId: FROZEN_OBSERVATION_ID,
          }),
        );
      }
      try {
        canonicalRowsSerialized = await serializeSelectedCanonicalRows(FROZEN_COMMAND_ID);
      } catch {
        canonicalRowsSerialized = "";
      }

      const rawInCheckpoint = bytesContainExactSentinel(checkpointTextForScan);
      const rawInWorkingSet = bytesContainExactSentinel(workingSetTextForScan);
      const rawInCanonicalRows = bytesContainExactSentinel(canonicalRowsSerialized);
      const rawInCapturedLogs = capturedBuffersContainExactSentinel(logs);

      // Preserve scan results in memory before cleanup mutates/deletes surfaces.
      rawFileContentPersisted = rawInCheckpoint || rawInWorkingSet || rawInCanonicalRows;
      rawFileContentInCapturedLogs = rawInCapturedLogs;
      if (rawFileContentPersisted || rawFileContentInCapturedLogs) {
        process.exitCode = 1;
      }

      // Final mutation of in-memory captured buffers — immediately after scan/classify,
      // before temp deletion and before post-cleanup DB querying. No diag() after this.
      capturedLogBufferBytesAfterDisposal = clearCapturedLogs();
      capturedLogsDisposed = capturedLogBufferBytesAfterDisposal === 0;
      if (!capturedLogsDisposed) {
        process.exitCode = 1;
      }

      // Delete temp watched/checkpoint state only after captured buffers are cleared/verified.
      if (watchedPath !== undefined) {
        await rm(watchedPath, { force: true });
      }
      if (checkpointPath !== undefined) {
        await rm(checkpointPath, { force: true });
      }
      if (tempDir !== undefined) {
        await rm(tempDir, { recursive: true, force: true });
      }

      tempWatchedFileDeleted = watchedPath === undefined || !(await pathExists(watchedPath));
      tempCheckpointDeleted = checkpointPath === undefined || !(await pathExists(checkpointPath));
      tempDirDeleted = tempDir === undefined || !(await pathExists(tempDir));
      if (!tempWatchedFileDeleted || !tempCheckpointDeleted || !tempDirDeleted) {
        process.exitCode = 1;
      }

      // Post-cleanup DB query after buffer disposal and temp path deletion.
      const workerRows = await admin<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM pg_catalog.pg_stat_activity
        WHERE application_name = 'continuity-kernel-restate'
      `;
      postCleanupWorkerCount = workerRows[0]?.count ?? 0;
      if (postCleanupWorkerCount !== 0) {
        process.exitCode = 1;
      }
    } finally {
      await admin.end({ timeout: 2 });
    }
  }

  const elapsedMs = Math.round(performance.now() - started);
  // Non-capturing report of required facts (must not repopulate captured buffers).
  report(
    `rawFileContentPersisted=${String(rawFileContentPersisted)} rawFileContentInCapturedLogs=${String(rawFileContentInCapturedLogs)}`,
  );
  report(
    `capturedLogsDisposed=${String(capturedLogsDisposed)} capturedLogBufferBytesAfterDisposal=${String(capturedLogBufferBytesAfterDisposal)}`,
  );
  report(
    `cleanup tempWatchedFileDeleted=${String(tempWatchedFileDeleted)} tempCheckpointDeleted=${String(tempCheckpointDeleted)} tempDirDeleted=${String(tempDirDeleted)}`,
  );
  report(`postCleanupWorkerCount=${String(postCleanupWorkerCount)}`);
  report(
    `summary firstCommitStatus=${firstCommitStatus} firstDecisionCode=${firstDecisionCode} caseVersionAfter=${caseVersionAfter} idleDurationMs=${String(idleDurationMs)} elapsedMs=${String(elapsedMs)} duplicateConsequenceCount=${String(duplicateConsequenceCount)} reconstructionConsequenceCount=${String(reconstructionConsequenceCount)}`,
  );
  report("providerIntegrationPresent=false totalProviderCalls=0");
  if (process.exitCode === 1) {
    report("AGENT_CONTINUITY_SPIKE_V0_FAIL");
    return;
  }
  report("AGENT_CONTINUITY_SPIKE_V0_PASS_SCRIPTED_ADAPTER");
}

await main();
