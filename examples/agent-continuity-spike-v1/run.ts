/**
 * Agent Continuity Spike v1 — phase children and aggregate parent runner.
 *
 * Provider-free scripted adapter only. Synthetic data.
 * Phase A blocks after accepted-before-checkpoint; parent issues SIGKILL.
 * Phase B recovers via one completed-invocation query + one attach.
 */

import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { submitCommand } from "../../src/alternative/restate/client.js";
import {
  FROZEN_COMMAND_ID,
  FROZEN_CONTENT_DIGEST,
  FROZEN_OBSERVATION_ID,
  FROZEN_REQUEST_HASH,
  REQUIRED_DEPLOYMENT_URI,
  SENTINEL_UTF8,
  anyCheckpointWriteArtifactExists,
  assertRecoveredAcceptedReceipt,
  buildAgentChildEnv,
  buildWorkerChildEnv,
  buildWorkingSet,
  bytesContainExactSentinel,
  capturedBuffersContainExactSentinel,
  checkpointTempSiblingPath,
  clearStringBuffers,
  countAgentPhaseDbConnections,
  deepEqualJson,
  deriveDuplicateConsequenceCount,
  evaluateCanonicalRowsPrivacyScan,
  isCanonicalRowsPrivacyScanFailure,
  parseCheckpoint,
  pathExists,
  purgePriorTerminalSameKeyInvocations,
  queryCompletedSameKeyInvocations,
  runPhaseAProcess,
  runPhaseBProcess,
  serializeWorkingSet,
  validateDeploymentUri,
  withVerifiedStoredProjectionDigest,
} from "./runtime.js";

type IpcMessage = Record<string, unknown>;

interface CapturedLogs {
  restateWorkerStdout: string[];
  restateWorkerStderr: string[];
  runnerDiagnostics: string[];
  phaseAStdout: string[];
  phaseAStderr: string[];
  phaseBStdout: string[];
  phaseBStderr: string[];
}

interface Worker {
  child: ChildProcess;
}

function ipcSend(message: IpcMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== "function") {
      reject(new Error("IPC channel unavailable"));
      return;
    }
    process.send(message, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function waitForIpcType(type: string): Promise<IpcMessage> {
  return new Promise((resolve) => {
    const onMessage = (value: unknown) => {
      if (typeof value === "object" && value !== null && (value as IpcMessage).type === type) {
        process.off("message", onMessage);
        resolve(value as IpcMessage);
      }
    };
    process.on("message", onMessage);
  });
}

async function runPhaseAChild(): Promise<void> {
  const watchedPath = process.env.CK_SPIKE_WATCHED_PATH;
  const checkpointPath = process.env.CK_SPIKE_CHECKPOINT_PATH;
  const deploymentUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
  if (watchedPath === undefined || checkpointPath === undefined) {
    throw new Error("Phase A requires CK_SPIKE_WATCHED_PATH and CK_SPIKE_CHECKPOINT_PATH");
  }
  validateDeploymentUri(deploymentUri);

  await runPhaseAProcess({
    watchedPath,
    checkpointPath,
    deploymentUri,
    readBytes: () => readFile(watchedPath),
    submit: submitCommand,
    onAdapterInvoked: async () => {
      await ipcSend({ type: "adapter-invoked" });
      await waitForIpcType("adapter-ack");
    },
    onAcceptedBeforeCheckpoint: async (commit, counts) => {
      await ipcSend({
        type: "accepted-before-checkpoint",
        status: commit.status,
        code: commit.code,
        caseVersion: String(commit.caseVersion),
        commandId: commit.commandId,
        requestHash: commit.requestHash,
        adapterCalls: counts.adapterCalls,
        submitCalls: counts.submitCalls,
      });
      // Unbounded pre-checkpoint barrier. Parent must never send continue-checkpoint
      // on the PASS path; parent issues SIGKILL instead.
      await waitForIpcType("continue-checkpoint");
    },
  });
}

async function runPhaseBChild(): Promise<void> {
  const watchedPath = process.env.CK_SPIKE_WATCHED_PATH;
  const checkpointPath = process.env.CK_SPIKE_CHECKPOINT_PATH;
  const deploymentUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
  if (watchedPath === undefined || checkpointPath === undefined) {
    throw new Error("Phase B requires CK_SPIKE_WATCHED_PATH and CK_SPIKE_CHECKPOINT_PATH");
  }
  validateDeploymentUri(deploymentUri);

  const result = await runPhaseBProcess({
    watchedPath,
    checkpointPath,
    deploymentUri,
    readBytes: () => readFile(watchedPath),
  });

  // Report the complete validated recovered object; parent deep-compares against PostgreSQL.
  await ipcSend({
    type: "recovery-complete",
    recoverySource: result.recoverySource,
    adapterCalls: result.adapterCalls,
    submitCalls: result.submitCalls,
    invocationLookupCalls: result.invocationLookupCalls,
    attachCalls: result.attachCalls,
    commandId: result.commandId,
    observationId: result.observationId,
    checkpointBytes: result.checkpointBytes,
    recovered: result.recovered,
  });
}

async function runAggregate(): Promise<void> {
  const {
    createAdminSql,
    fixture,
    resetSyntheticFixture,
  } = await import("../../tests/db-fixture.js");

  const admin = createAdminSql("continuity-kernel-agent-spike-v1-runner");
  const logs: CapturedLogs = {
    restateWorkerStdout: [],
    restateWorkerStderr: [],
    runnerDiagnostics: [],
    phaseAStdout: [],
    phaseAStderr: [],
    phaseBStdout: [],
    phaseBStderr: [],
  };

  function diag(message: string): void {
    logs.runnerDiagnostics.push(message);
    console.log(message);
  }

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

  async function readCaseVersion(): Promise<string> {
    const rows = await admin<{ version: string }[]>`
      SELECT version FROM continuity.cases
      WHERE namespace_id = ${fixture.namespaceId} AND case_id = ${fixture.caseId}
    `;
    return rows[0]?.version ?? "missing";
  }

  async function readStoredReceipt(commandId: string): Promise<Record<string, unknown>> {
    const rows = await admin<{ result: Record<string, unknown> }[]>`
      SELECT result FROM continuity.command_receipts
      WHERE namespace_id = ${fixture.namespaceId} AND command_id = ${commandId}
    `;
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new Error("Expected exactly one stored receipt");
    }
    return rows[0].result;
  }

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

  function clearCapturedLogs(): number {
    return clearStringBuffers(
      logs.restateWorkerStdout,
      logs.restateWorkerStderr,
      logs.runnerDiagnostics,
      logs.phaseAStdout,
      logs.phaseAStderr,
      logs.phaseBStdout,
      logs.phaseBStderr,
    );
  }

  const started = performance.now();
  diag("Agent Continuity Spike v1 — commit-before-checkpoint interruption");
  diag(`networkTopologyValid deploymentUri=${REQUIRED_DEPLOYMENT_URI}`);

  const uri = requireDeploymentUri();

  let worker: Worker | undefined;
  let phaseA: ChildProcess | undefined;
  let phaseB: ChildProcess | undefined;
  let tempDir: string | undefined;
  let watchedPath: string | undefined;
  let checkpointPath: string | undefined;

  let acceptedCommitObservedBeforeInterruption = false;
  let checkpointWriteStartedBeforeInterruption = false;
  let phaseATerminatedBySignal = false;
  let phaseATerminationSignal = "NONE";
  let phaseAExitCodeWasNull = false;
  let phaseAKillIssuedByParent = false;
  let checkpointExistsAfterInterruption = true;
  let phaseAAdapterCalls = 0;
  let phaseASubmitCalls = 0;
  let phaseAConnectionCountAfterKill = -1;
  let completedInvocationCountAfterInterruption = -1;
  let canonicalReceiptCountAfterInterruption = -1;
  let acceptedHistoryCountAfterInterruption = -1;
  let caseVersionAfterInterruption = "NOT_OBSERVED";
  let recoveryProcessWasDistinct = false;
  let recoveryInvocationLookupCalls = -1;
  let recoveryAttachCalls = -1;
  let recoveryAdapterCalls = -1;
  let recoverySubmitCalls = -1;
  let recoveredReceiptMatchesCanonical = false;
  let recoveredCheckpointWritten = false;
  let recoveredCheckpointSchemaValid = false;
  let recoveredCheckpointBytes = -1;
  let finalCommandReceiptCount = -1;
  let finalAcceptedHistoryCount = -1;
  let duplicateConsequenceCount = -1;
  let recoveryConsequenceCount = -1;
  let rawFileContentPersisted = true;
  let rawFileContentInCapturedLogs = true;
  let capturedLogsDisposed = false;
  let capturedLogBufferBytesAfterDisposal = -1;
  let tempWatchedFileDeleted = false;
  let tempCheckpointDeleted = false;
  let tempDirDeleted = false;
  let phaseBConnectionCountAfterExit = -1;
  let postCleanupWorkerCount = -1;
  let checkpointTextForScan = "";
  let workingSetTextForScan = "";
  let canonicalRowsPrivacyScanFailed = false;

  try {
    tempDir = await mkdtemp(join(tmpdir(), "agent-continuity-spike-v1-"));
    const watchedFilePath = join(tempDir, "watched.txt");
    const checkpointFilePath = join(tempDir, "checkpoint.json");
    watchedPath = watchedFilePath;
    checkpointPath = checkpointFilePath;
    await writeFile(watchedFilePath, SENTINEL_UTF8, "utf8");

    await resetSyntheticFixture(admin);
    await purgePriorTerminalSameKeyInvocations(FROZEN_COMMAND_ID);
    worker = await spawnWorker();
    await registerDeployment(uri);

    // --- Phase A ---
    const phaseAEnv = buildAgentChildEnv(process.env, {
      deploymentUri: uri,
      watchedPath: watchedFilePath,
      checkpointPath: checkpointFilePath,
      phase: "phase-a",
    });
    phaseA = fork(new URL("./run.ts", import.meta.url), ["phase-a"], {
      execPath: process.execPath,
      execArgv: ["--import", "tsx"],
      env: phaseAEnv,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const phaseAMessages: IpcMessage[] = [];
    phaseA.stdout?.on("data", (chunk: Buffer) => {
      logs.phaseAStdout.push(chunk.toString());
    });
    phaseA.stderr?.on("data", (chunk: Buffer) => {
      logs.phaseAStderr.push(chunk.toString());
    });
    phaseA.on("message", (value: unknown) => {
      phaseAMessages.push(value as IpcMessage);
    });

    {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (phaseAMessages.some((m) => m.type === "adapter-invoked")) break;
        if (phaseA.exitCode !== null || phaseA.signalCode !== null) {
          throw new Error("Phase A exited before adapter-invoked");
        }
        await delay(10);
      }
      if (!phaseAMessages.some((m) => m.type === "adapter-invoked")) {
        throw new Error("Phase A adapter-invoked timeout");
      }
      phaseA.send({ type: "adapter-ack" });
    }

    {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (phaseAMessages.some((m) => m.type === "accepted-before-checkpoint")) break;
        if (phaseA.exitCode !== null || phaseA.signalCode !== null) {
          throw new Error("Phase A exited before accepted-before-checkpoint");
        }
        await delay(10);
      }
      const barrier = phaseAMessages.find((m) => m.type === "accepted-before-checkpoint");
      if (barrier === undefined) {
        throw new Error("Phase A accepted-before-checkpoint timeout");
      }
      if (
        barrier.status !== "accepted"
        || barrier.code !== "ACCEPTED"
        || String(barrier.caseVersion) !== "4"
        || barrier.commandId !== FROZEN_COMMAND_ID
        || barrier.requestHash !== FROZEN_REQUEST_HASH
      ) {
        throw new Error("Phase A accepted barrier fields mismatch");
      }
      // Parent reads exact child-reported counters; never assign inferred 1.
      phaseAAdapterCalls = Number(barrier.adapterCalls);
      phaseASubmitCalls = Number(barrier.submitCalls);
      if (phaseAAdapterCalls !== 1 || phaseASubmitCalls !== 1) {
        throw new Error(
          `Phase A call counts mismatch adapter=${String(phaseAAdapterCalls)} submit=${String(phaseASubmitCalls)}`,
        );
      }
      acceptedCommitObservedBeforeInterruption = true;
    }

    // Parent validates checkpoint and temp sibling absent; never sends continue-checkpoint; parent-kills SIGKILL.
    if (await anyCheckpointWriteArtifactExists(checkpointFilePath)) {
      checkpointWriteStartedBeforeInterruption = true;
      throw new Error(
        "Checkpoint or checkpoint temp sibling must be absent at accepted-before-checkpoint barrier",
      );
    }
    checkpointExistsAfterInterruption = false;

    const phaseAExit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        phaseA?.once("exit", (exitCode, signal) => {
          resolve({ exitCode, signal });
        });
      },
    );
    const killAccepted = phaseA.kill("SIGKILL");
    phaseAKillIssuedByParent = killAccepted;
    const termination = await phaseAExit;
    phaseATerminatedBySignal = termination.signal === "SIGKILL";
    phaseATerminationSignal = termination.signal ?? "NONE";
    phaseAExitCodeWasNull = termination.exitCode === null;
    if (termination.exitCode !== null || termination.signal !== "SIGKILL") {
      throw new Error(
        `Phase A termination shape mismatch: exitCode=${String(termination.exitCode)} signal=${String(termination.signal)}`,
      );
    }
    if (await anyCheckpointWriteArtifactExists(checkpointFilePath)) {
      checkpointExistsAfterInterruption = true;
      checkpointWriteStartedBeforeInterruption = true;
      throw new Error("Checkpoint or temp sibling must remain absent after phase A SIGKILL");
    }

    phaseAConnectionCountAfterKill = await countAgentPhaseDbConnections(admin);
    const completedIds = await queryCompletedSameKeyInvocations(FROZEN_COMMAND_ID);
    completedInvocationCountAfterInterruption = completedIds.length;
    canonicalReceiptCountAfterInterruption = await countReceipts(FROZEN_COMMAND_ID);
    acceptedHistoryCountAfterInterruption = await countAcceptedHistory(FROZEN_COMMAND_ID);
    caseVersionAfterInterruption = await readCaseVersion();
    if (
      phaseAConnectionCountAfterKill !== 0
      || completedInvocationCountAfterInterruption !== 1
      || canonicalReceiptCountAfterInterruption !== 1
      || acceptedHistoryCountAfterInterruption !== 1
      || caseVersionAfterInterruption !== "4"
    ) {
      throw new Error("Post-interruption canonical/Restate predicates failed");
    }

    const phaseAPid = phaseA.pid;
    phaseA = undefined;

    // --- Phase B ---
    const phaseBEnv = buildAgentChildEnv(process.env, {
      deploymentUri: uri,
      watchedPath: watchedFilePath,
      checkpointPath: checkpointFilePath,
      phase: "phase-b",
    });
    phaseB = fork(new URL("./run.ts", import.meta.url), ["phase-b"], {
      execPath: process.execPath,
      execArgv: ["--import", "tsx"],
      env: phaseBEnv,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    recoveryProcessWasDistinct =
      phaseB.pid !== undefined && phaseAPid !== undefined && phaseB.pid !== phaseAPid;

    const phaseBMessages: IpcMessage[] = [];
    phaseB.stdout?.on("data", (chunk: Buffer) => {
      logs.phaseBStdout.push(chunk.toString());
    });
    phaseB.stderr?.on("data", (chunk: Buffer) => {
      logs.phaseBStderr.push(chunk.toString());
    });
    phaseB.on("message", (value: unknown) => {
      phaseBMessages.push(value as IpcMessage);
    });

    const phaseBExit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        phaseB?.once("exit", (exitCode, signal) => {
          resolve({ exitCode, signal });
        });
      },
    );

    {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (phaseBMessages.some((m) => m.type === "recovery-complete")) break;
        if (phaseB.exitCode !== null || phaseB.signalCode !== null) break;
        await delay(10);
      }
    }

    const recovery = phaseBMessages.find((m) => m.type === "recovery-complete");
    if (recovery === undefined) {
      throw new Error("Phase B recovery-complete timeout");
    }
    recoveryInvocationLookupCalls = Number(recovery.invocationLookupCalls);
    recoveryAttachCalls = Number(recovery.attachCalls);
    recoveryAdapterCalls = Number(recovery.adapterCalls);
    recoverySubmitCalls = Number(recovery.submitCalls);
    if (
      recovery.recoverySource !== "restate_completed_invocation"
      || recoveryAdapterCalls !== 0
      || recoverySubmitCalls !== 0
      || recoveryInvocationLookupCalls !== 1
      || recoveryAttachCalls !== 1
    ) {
      throw new Error("Phase B recovery call-count predicates failed");
    }

    const phaseBTermination = await phaseBExit;
    if (phaseBTermination.exitCode !== 0) {
      throw new Error(`Phase B exit ${String(phaseBTermination.exitCode)}`);
    }
    phaseBConnectionCountAfterExit = await countAgentPhaseDbConnections(admin);

    // Parent-only PostgreSQL comparison of complete objects.
    // Phase B never receives DB credentials or stored rows.
    const recoveredComplete = assertRecoveredAcceptedReceipt(recovery.recovered);
    const stored = await readStoredReceipt(FROZEN_COMMAND_ID);
    const storedComplete = assertRecoveredAcceptedReceipt(
      withVerifiedStoredProjectionDigest(stored),
    );
    recoveredReceiptMatchesCanonical = deepEqualJson(storedComplete, recoveredComplete);

    if (!recoveredReceiptMatchesCanonical) {
      throw new Error("Recovered receipt does not match PostgreSQL canonical receipt");
    }

    if (!(await pathExists(checkpointFilePath))) {
      throw new Error("Recovered checkpoint missing");
    }
    if (await pathExists(checkpointTempSiblingPath(checkpointFilePath))) {
      throw new Error("Recovered checkpoint temp sibling must not remain");
    }
    const checkpointRaw = await readFile(checkpointFilePath, "utf8");
    checkpointTextForScan = checkpointRaw;
    // parseCheckpoint enforces the exact seven-key privacy-safe schema and frozen fields.
    parseCheckpoint(checkpointRaw);
    recoveredCheckpointWritten = true;
    recoveredCheckpointSchemaValid = true;
    recoveredCheckpointBytes = Buffer.byteLength(checkpointRaw, "utf8");
    if (recoveredCheckpointBytes < 1 || recoveredCheckpointBytes > 1024) {
      throw new Error("Recovered checkpoint schema/size invalid");
    }

    finalCommandReceiptCount = await countReceipts(FROZEN_COMMAND_ID);
    finalAcceptedHistoryCount = await countAcceptedHistory(FROZEN_COMMAND_ID);
    duplicateConsequenceCount = deriveDuplicateConsequenceCount(
      finalCommandReceiptCount,
      finalAcceptedHistoryCount,
    );
    recoveryConsequenceCount = Math.max(
      0,
      finalCommandReceiptCount - canonicalReceiptCountAfterInterruption,
      finalAcceptedHistoryCount - acceptedHistoryCountAfterInterruption,
    );
    if (
      finalCommandReceiptCount !== 1
      || finalAcceptedHistoryCount !== 1
      || recoveryConsequenceCount !== 0
      || duplicateConsequenceCount !== 0
    ) {
      throw new Error("Recovery introduced additional canonical consequence");
    }

    workingSetTextForScan = serializeWorkingSet(
      buildWorkingSet({
        contentDigest: FROZEN_CONTENT_DIGEST,
        observationId: FROZEN_OBSERVATION_ID,
      }),
    );

    diag(
      `PASS_CORE phaseASignal=SIGKILL receipts=${String(finalCommandReceiptCount)} history=${String(finalAcceptedHistoryCount)} recoveryAttachCalls=1`,
    );
  } finally {
    try {
      if (phaseA !== undefined && phaseA.exitCode === null && phaseA.signalCode === null) {
        phaseA.kill("SIGKILL");
        await new Promise<void>((resolve) => {
          phaseA?.once("exit", () => {
            resolve();
          });
        });
      }
      if (phaseB !== undefined && phaseB.exitCode === null && phaseB.signalCode === null) {
        phaseB.kill("SIGKILL");
        await new Promise<void>((resolve) => {
          phaseB?.once("exit", () => {
            resolve();
          });
        });
      }
      if (worker !== undefined) {
        await killWorker(worker);
        worker = undefined;
      }

      if (checkpointPath !== undefined && (await pathExists(checkpointPath))) {
        checkpointTextForScan = await readFile(checkpointPath, "utf8");
      }
      if (workingSetTextForScan.length === 0) {
        workingSetTextForScan = serializeWorkingSet(
          buildWorkingSet({
            contentDigest: FROZEN_CONTENT_DIGEST,
            observationId: FROZEN_OBSERVATION_ID,
          }),
        );
      }
      let rawInCanonicalRows = false;
      try {
        const serialized = await serializeSelectedCanonicalRows(FROZEN_COMMAND_ID);
        const evaluated = evaluateCanonicalRowsPrivacyScan({
          status: "ok",
          serialized,
        });
        rawInCanonicalRows = evaluated.rawFileContentInCanonicalRows;
        canonicalRowsPrivacyScanFailed = isCanonicalRowsPrivacyScanFailure(evaluated);
      } catch (error) {
        const evaluated = evaluateCanonicalRowsPrivacyScan({
          status: "error",
          error: error instanceof Error ? error.message : "canonical-rows-scan-failed",
        });
        rawInCanonicalRows = evaluated.rawFileContentInCanonicalRows;
        canonicalRowsPrivacyScanFailed = isCanonicalRowsPrivacyScanFailure(evaluated);
      }

      const rawInCheckpoint = bytesContainExactSentinel(checkpointTextForScan);
      const rawInWorkingSet = bytesContainExactSentinel(workingSetTextForScan);
      const rawInCapturedLogs = capturedBuffersContainExactSentinel(logs);
      rawFileContentPersisted =
        rawInCheckpoint || rawInWorkingSet || rawInCanonicalRows || canonicalRowsPrivacyScanFailed;
      rawFileContentInCapturedLogs = rawInCapturedLogs;
      if (rawFileContentPersisted || rawFileContentInCapturedLogs || canonicalRowsPrivacyScanFailed) {
        process.exitCode = 1;
      }

      capturedLogBufferBytesAfterDisposal = clearCapturedLogs();
      capturedLogsDisposed = capturedLogBufferBytesAfterDisposal === 0;
      if (!capturedLogsDisposed) {
        process.exitCode = 1;
      }

      if (watchedPath !== undefined) {
        await rm(watchedPath, { force: true });
      }
      if (checkpointPath !== undefined) {
        await rm(checkpointPath, { force: true });
        await rm(checkpointTempSiblingPath(checkpointPath), { force: true });
      }
      if (tempDir !== undefined) {
        await rm(tempDir, { recursive: true, force: true });
      }

      tempWatchedFileDeleted = watchedPath === undefined || !(await pathExists(watchedPath));
      tempCheckpointDeleted =
        checkpointPath === undefined
        || (
          !(await pathExists(checkpointPath))
          && !(await pathExists(checkpointTempSiblingPath(checkpointPath)))
        );
      tempDirDeleted = tempDir === undefined || !(await pathExists(tempDir));
      if (!tempWatchedFileDeleted || !tempCheckpointDeleted || !tempDirDeleted) {
        process.exitCode = 1;
      }

      const workerRows = await admin<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM pg_catalog.pg_stat_activity
        WHERE application_name = 'continuity-kernel-restate'
      `;
      postCleanupWorkerCount = workerRows[0]?.count ?? 0;
      if (postCleanupWorkerCount !== 0) {
        process.exitCode = 1;
      }
      if (phaseBConnectionCountAfterExit < 0) {
        phaseBConnectionCountAfterExit = await countAgentPhaseDbConnections(admin);
      }
    } finally {
      await admin.end({ timeout: 2 });
    }
  }

  const elapsedMs = Math.round(performance.now() - started);
  const totalAdapterCallsAcrossProcesses = phaseAAdapterCalls + Math.max(0, recoveryAdapterCalls);

  report(
    `rawFileContentPersisted=${String(rawFileContentPersisted)} rawFileContentInCapturedLogs=${String(rawFileContentInCapturedLogs)}`,
  );
  report(
    `capturedLogsDisposed=${String(capturedLogsDisposed)} capturedLogBufferBytesAfterDisposal=${String(capturedLogBufferBytesAfterDisposal)}`,
  );
  report(
    `cleanup tempWatchedFileDeleted=${String(tempWatchedFileDeleted)} tempCheckpointDeleted=${String(tempCheckpointDeleted)} tempDirDeleted=${String(tempDirDeleted)}`,
  );
  report(
    `phaseA exitCodeNull=${String(phaseAExitCodeWasNull)} signal=${phaseATerminationSignal} terminatedBySignal=${String(phaseATerminatedBySignal)} killIssuedByParent=${String(phaseAKillIssuedByParent)} adapterCalls=${String(phaseAAdapterCalls)} submitCalls=${String(phaseASubmitCalls)}`,
  );
  report(
    `recovery distinct=${String(recoveryProcessWasDistinct)} lookup=${String(recoveryInvocationLookupCalls)} attach=${String(recoveryAttachCalls)} adapter=${String(recoveryAdapterCalls)} submit=${String(recoverySubmitCalls)}`,
  );
  report(
    `counts receipts=${String(finalCommandReceiptCount)} history=${String(finalAcceptedHistoryCount)} recoveryConsequence=${String(recoveryConsequenceCount)} duplicateConsequence=${String(duplicateConsequenceCount)} totalAdapter=${String(totalAdapterCallsAcrossProcesses)}`,
  );
  report(
    `checkpoint bytes=${String(recoveredCheckpointBytes)} schemaValid=${String(recoveredCheckpointSchemaValid)} matchesCanonical=${String(recoveredReceiptMatchesCanonical)}`,
  );
  report(
    `connections phaseAAfterKill=${String(phaseAConnectionCountAfterKill)} phaseBAfterExit=${String(phaseBConnectionCountAfterExit)} postCleanupWorker=${String(postCleanupWorkerCount)}`,
  );
  report(`elapsedMs=${String(elapsedMs)} acceptedBeforeInterrupt=${String(acceptedCommitObservedBeforeInterruption)} checkpointBeforeInterrupt=${String(checkpointWriteStartedBeforeInterruption)} checkpointAfterInterrupt=${String(checkpointExistsAfterInterruption)} recoveredCheckpointWritten=${String(recoveredCheckpointWritten)}`);
  report("providerIntegrationPresent=false totalProviderCalls=0");

  // Failures above throw; cleanup privacy failures set process.exitCode = 1.
  // Re-check only non-narrowed residual gates here.
  const residualFailed =
    process.exitCode === 1
    || !capturedLogsDisposed
    || rawFileContentPersisted
    || rawFileContentInCapturedLogs
    || canonicalRowsPrivacyScanFailed
    || phaseBConnectionCountAfterExit !== 0
    || postCleanupWorkerCount !== 0
    || recoveredCheckpointBytes < 1
    || recoveredCheckpointBytes > 1024
    || totalAdapterCallsAcrossProcesses !== 1;

  if (residualFailed) {
    report("AGENT_CONTINUITY_SPIKE_V1_FAIL");
    process.exitCode = 1;
    return;
  }
  report("AGENT_CONTINUITY_SPIKE_V1_PASS_COMMIT_CHECKPOINT_INTERRUPTION");
}

const mode = process.argv[2];
if (mode === "phase-a") {
  await runPhaseAChild();
} else if (mode === "phase-b") {
  await runPhaseBChild();
} else {
  await runAggregate();
}
