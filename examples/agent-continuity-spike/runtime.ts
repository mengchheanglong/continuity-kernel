/**
 * Agent Continuity Spike v0 — provider-free scripted runtime.
 * Synthetic only. Not a full Agent OS, not crash recovery, not a real LLM.
 */

import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  submitCommand,
  type CommitResult,
} from "../../src/alternative/restate/client.js";
import {
  canonicalRequestHash,
  type ResolveCaseRequest,
} from "../../src/domain/request.js";

export const IDLE_TARGET_MS = 1000 as const;
export const POLL_CADENCE_MS = 50 as const;
export const REQUIRED_DEPLOYMENT_URI = "http://host.docker.internal:9080" as const;
export const FROZEN_REQUEST_HASH =
  "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY" as const;
export const FROZEN_CONTENT_DIGEST =
  "uPfY8YNCovUemUJNFq4xrofJ_KcHWSJr2R_zvRV47Kc" as const;
export const FROZEN_OBSERVATION_ID =
  "uDiNWJ0Qs3r77_6lttDBvLBY8h8DunOP7GVm9yz86-0" as const;
export const FROZEN_COMMAND_ID =
  "agent-spike:v0:uDiNWJ0Qs3r77_6lttDBvLBY8h8DunOP7GVm9yz86-0" as const;
export const SENTINEL_UTF8 = "AGENT_CONTINUITY_SPIKE_V0_SENTINEL\n" as const;
export const MAX_STATE_BYTES = 1024 as const;

const NAMESPACE_ID = "ns:test:continuity-kernel-v0" as const;
const CASE_ID = "case:test:001" as const;
const WATCHED_PATH_LABEL = "watched.txt" as const;

const WORKING_SET_KEYS = [
  "schemaVersion",
  "namespaceId",
  "caseId",
  "eventType",
  "watchedPathLabel",
  "contentDigest",
  "observationId",
  "expectedCaseVersion",
] as const;

const CHECKPOINT_KEYS = [
  "schemaVersion",
  "observationId",
  "commandId",
  "requestHash",
  "outcomeStatus",
  "decisionCode",
  "caseVersion",
] as const;

export interface Observation {
  schemaVersion: 1;
  namespaceId: typeof NAMESPACE_ID;
  caseId: typeof CASE_ID;
  eventType: "file_changed";
  watchedPathLabel: string;
  contentDigest: string;
}

export interface WorkingSet {
  schemaVersion: 1;
  namespaceId: typeof NAMESPACE_ID;
  caseId: typeof CASE_ID;
  eventType: "file_changed";
  watchedPathLabel: string;
  contentDigest: string;
  observationId: string;
  expectedCaseVersion: "3";
}

export interface Checkpoint {
  schemaVersion: 1;
  observationId: string;
  commandId: string;
  requestHash: typeof FROZEN_REQUEST_HASH;
  outcomeStatus: "accepted";
  decisionCode: "ACCEPTED";
  caseVersion: "4";
}

export interface IdleWindowResult {
  idleDurationMs: number;
  adapterCalls: number;
}

export interface ProcessResult {
  suppressed: boolean;
  adapterCalls: number;
  observationId: string;
  commandId: string;
  commit?: CommitResult;
  checkpoint?: Checkpoint;
  workingSetBytes?: number;
  checkpointBytes?: number;
}

function sha256Base64Url(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("base64url");
}

export function contentDigestOf(bytes: Buffer): string {
  return sha256Base64Url(bytes);
}

export function buildObservation(input: {
  contentDigest: string;
  watchedPathLabel?: string;
}): Observation {
  return {
    schemaVersion: 1,
    namespaceId: NAMESPACE_ID,
    caseId: CASE_ID,
    eventType: "file_changed",
    watchedPathLabel: input.watchedPathLabel ?? WATCHED_PATH_LABEL,
    contentDigest: input.contentDigest,
  };
}

export function canonicalObservationBytes(observation: Observation): Buffer {
  // Insertion-ordered exact key order; no whitespace; no trailing newline.
  const text = JSON.stringify({
    schemaVersion: observation.schemaVersion,
    namespaceId: observation.namespaceId,
    caseId: observation.caseId,
    eventType: observation.eventType,
    watchedPathLabel: observation.watchedPathLabel,
    contentDigest: observation.contentDigest,
  });
  return Buffer.from(text, "utf8");
}

export function observationIdOf(observation: Observation): string {
  return sha256Base64Url(canonicalObservationBytes(observation));
}

export function commandIdOf(observationId: string): string {
  return `agent-spike:v0:${observationId}`;
}

export function buildWorkingSet(input: {
  contentDigest: string;
  observationId: string;
  watchedPathLabel?: string;
}): WorkingSet {
  return {
    schemaVersion: 1,
    namespaceId: NAMESPACE_ID,
    caseId: CASE_ID,
    eventType: "file_changed",
    watchedPathLabel: input.watchedPathLabel ?? WATCHED_PATH_LABEL,
    contentDigest: input.contentDigest,
    observationId: input.observationId,
    expectedCaseVersion: "3",
  };
}

export function serializeWorkingSet(workingSet: WorkingSet): string {
  return JSON.stringify({
    schemaVersion: workingSet.schemaVersion,
    namespaceId: workingSet.namespaceId,
    caseId: workingSet.caseId,
    eventType: workingSet.eventType,
    watchedPathLabel: workingSet.watchedPathLabel,
    contentDigest: workingSet.contentDigest,
    observationId: workingSet.observationId,
    expectedCaseVersion: workingSet.expectedCaseVersion,
  });
}

export function workingSetByteLength(workingSet: WorkingSet): number {
  return Buffer.byteLength(serializeWorkingSet(workingSet), "utf8");
}

export function assertWorkingSet(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid working set");
  }
  const workingSet = value as Record<string, unknown>;
  const keys = Object.keys(workingSet).sort();
  const expected = [...WORKING_SET_KEYS].sort();
  if (keys.join("\0") !== expected.join("\0")) {
    throw new Error("Invalid working set: key set mismatch");
  }
  if (workingSet.schemaVersion !== 1) throw new Error("Invalid working set: schemaVersion");
  if (workingSet.namespaceId !== NAMESPACE_ID) throw new Error("Invalid working set: namespaceId");
  if (workingSet.caseId !== CASE_ID) throw new Error("Invalid working set: caseId");
  if (workingSet.eventType !== "file_changed") throw new Error("Invalid working set: eventType");
  if (typeof workingSet.watchedPathLabel !== "string" || workingSet.watchedPathLabel.length === 0) {
    throw new Error("Invalid working set: watchedPathLabel");
  }
  if (typeof workingSet.contentDigest !== "string" || workingSet.contentDigest.length === 0) {
    throw new Error("Invalid working set: contentDigest");
  }
  if (typeof workingSet.observationId !== "string" || workingSet.observationId.length === 0) {
    throw new Error("Invalid working set: observationId");
  }
  if (workingSet.expectedCaseVersion !== "3") {
    throw new Error("Invalid working set: expectedCaseVersion");
  }
  const bytes = workingSetByteLength(value as WorkingSet);
  if (bytes > MAX_STATE_BYTES) {
    throw new Error(`Invalid working set: size ${String(bytes)} exceeds ${String(MAX_STATE_BYTES)}`);
  }
}

export function scriptedAdapter(workingSet: WorkingSet): ResolveCaseRequest {
  // Provider-free scripted adapter: exact frozen command body only.
  // Working set is accepted for call-site shape; body is frozen and independent of content.
  void workingSet;
  return {
    requestHashSchemaVersion: 1,
    namespaceId: NAMESPACE_ID,
    caseId: CASE_ID,
    actorId: "agent:test:owner-001",
    authorizationGrantId: "grant:test:case-001:owner-001",
    authorizationVersion: "7",
    expectedCaseVersion: "3",
    actionType: "resolve_case",
    actionPayload: {
      commitmentDeadline: "2026-07-11T12:00:00Z",
      payloadRef: "payload:test:attachment-001",
      resolution: "completed",
    },
    worldTime: "2026-07-11T10:00:00Z",
  };
}

export function assertExactCommand(command: ResolveCaseRequest): void {
  const hash = canonicalRequestHash(command);
  if (hash !== FROZEN_REQUEST_HASH) {
    throw new Error(`Command request hash mismatch: ${hash}`);
  }
  const expected = scriptedAdapter(
    buildWorkingSet({
      contentDigest: FROZEN_CONTENT_DIGEST,
      observationId: FROZEN_OBSERVATION_ID,
    }),
  );
  if (JSON.stringify(command) !== JSON.stringify(expected)) {
    throw new Error("Command body differs from frozen scripted body");
  }
}

export async function runIdleWindow(options: {
  readBytes: () => Promise<Buffer>;
  onAdapterWouldInvoke?: () => void;
}): Promise<IdleWindowResult> {
  const start = performance.now();
  let adapterCalls = 0;
  const initial = await options.readBytes();

  for (;;) {
    const elapsed = performance.now() - start;
    if (elapsed >= IDLE_TARGET_MS) {
      return {
        idleDurationMs: Math.round(elapsed),
        adapterCalls,
      };
    }
    const current = await options.readBytes();
    if (!current.equals(initial)) {
      // Content change during idle window would invoke adapter; tests keep content fixed.
      adapterCalls += 1;
      options.onAdapterWouldInvoke?.();
    }
    const remaining = IDLE_TARGET_MS - (performance.now() - start);
    if (remaining <= 0) {
      return {
        idleDurationMs: Math.round(performance.now() - start),
        adapterCalls,
      };
    }
    await delay(Math.min(POLL_CADENCE_MS, remaining));
  }
}

export function validateDeploymentUri(uri: string | undefined): void {
  if (uri !== REQUIRED_DEPLOYMENT_URI) {
    throw new Error(
      `CK_RESTATE_DEPLOYMENT_URI must equal ${REQUIRED_DEPLOYMENT_URI}; got ${uri ?? "(unset)"}`,
    );
  }
}

export function buildCheckpoint(input: {
  observationId: string;
  commandId: string;
}): Checkpoint {
  return {
    schemaVersion: 1,
    observationId: input.observationId,
    commandId: input.commandId,
    requestHash: FROZEN_REQUEST_HASH,
    outcomeStatus: "accepted",
    decisionCode: "ACCEPTED",
    caseVersion: "4",
  };
}

export function serializeCheckpoint(checkpoint: Checkpoint): string {
  return JSON.stringify({
    schemaVersion: checkpoint.schemaVersion,
    observationId: checkpoint.observationId,
    commandId: checkpoint.commandId,
    requestHash: checkpoint.requestHash,
    outcomeStatus: checkpoint.outcomeStatus,
    decisionCode: checkpoint.decisionCode,
    caseVersion: checkpoint.caseVersion,
  });
}

export function assertCheckpoint(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid checkpoint");
  }
  const checkpoint = value as Record<string, unknown>;
  const keys = Object.keys(checkpoint).sort();
  const expected = [...CHECKPOINT_KEYS].sort();
  if (keys.join("\0") !== expected.join("\0")) {
    throw new Error("Invalid checkpoint: key set mismatch");
  }
  if (checkpoint.schemaVersion !== 1) throw new Error("Invalid checkpoint: schemaVersion");
  if (typeof checkpoint.observationId !== "string" || checkpoint.observationId.length === 0) {
    throw new Error("Invalid checkpoint: observationId");
  }
  if (typeof checkpoint.commandId !== "string" || checkpoint.commandId.length === 0) {
    throw new Error("Invalid checkpoint: commandId");
  }
  if (checkpoint.requestHash !== FROZEN_REQUEST_HASH) {
    throw new Error("Invalid checkpoint: requestHash");
  }
  if (checkpoint.outcomeStatus !== "accepted") {
    throw new Error("Invalid checkpoint: outcomeStatus");
  }
  if (checkpoint.decisionCode !== "ACCEPTED") {
    throw new Error("Invalid checkpoint: decisionCode");
  }
  if (checkpoint.caseVersion !== "4") {
    throw new Error("Invalid checkpoint: caseVersion");
  }
  const typed = value as Checkpoint;
  const bytes = Buffer.byteLength(serializeCheckpoint(typed), "utf8");
  if (bytes > MAX_STATE_BYTES || bytes < 1) {
    throw new Error(`Invalid checkpoint: size ${String(bytes)}`);
  }
  const text = serializeCheckpoint(typed);
  if (text.includes(SENTINEL_UTF8.trim()) || text.includes("AGENT_CONTINUITY_SPIKE_V0_SENTINEL")) {
    throw new Error("Invalid checkpoint: raw sentinel content forbidden");
  }
}

export function parseCheckpoint(raw: string): Checkpoint {
  const value: unknown = JSON.parse(raw);
  assertCheckpoint(value);
  return value as Checkpoint;
}

export async function writeCheckpointAtomic(
  checkpointPath: string,
  checkpoint: Checkpoint,
): Promise<number> {
  assertCheckpoint(checkpoint);
  const text = serializeCheckpoint(checkpoint);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_STATE_BYTES) {
    throw new Error(`Checkpoint exceeds ${String(MAX_STATE_BYTES)} bytes`);
  }
  const tempPath = `${checkpointPath}.tmp`;
  await writeFile(tempPath, text, "utf8");
  await rename(tempPath, checkpointPath);
  return bytes;
}

export async function readCompletedCheckpoint(
  checkpointPath: string,
): Promise<Checkpoint | null> {
  try {
    const raw = await readFile(checkpointPath, "utf8");
    return parseCheckpoint(raw);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export interface SpikeRuntimeOptions {
  checkpointPath: string;
  deploymentUri?: string | undefined;
  submit?: (
    commandId: string,
    request: ResolveCaseRequest,
    workflowId?: string,
  ) => Promise<CommitResult>;
}

export class SpikeRuntime {
  private adapterCalls = 0;
  private readonly checkpointPath: string;
  private readonly deploymentUri: string | undefined;
  private readonly submitFn: (
    commandId: string,
    request: ResolveCaseRequest,
    workflowId?: string,
  ) => Promise<CommitResult>;

  constructor(options: SpikeRuntimeOptions) {
    this.checkpointPath = options.checkpointPath;
    this.deploymentUri = options.deploymentUri;
    this.submitFn = options.submit ?? submitCommand;
  }

  get totalAdapterCalls(): number {
    return this.adapterCalls;
  }

  async processBytes(bytes: Buffer): Promise<ProcessResult> {
    validateDeploymentUri(this.deploymentUri);

    const contentDigest = contentDigestOf(bytes);
    const observation = buildObservation({ contentDigest });
    const observationId = observationIdOf(observation);
    const commandId = commandIdOf(observationId);

    const existing = await readCompletedCheckpoint(this.checkpointPath);
    if (existing !== null && existing.observationId === observationId) {
      // Checkpoint parse already enforces accepted/ACCEPTED; re-check via string views.
      const outcomeStatus: string = existing.outcomeStatus;
      const decisionCode: string = existing.decisionCode;
      if (outcomeStatus === "accepted" && decisionCode === "ACCEPTED") {
        return {
          suppressed: true,
          adapterCalls: 0,
          observationId,
          commandId,
          checkpoint: existing,
        };
      }
    }

    const workingSet = buildWorkingSet({
      contentDigest,
      observationId,
      watchedPathLabel: observation.watchedPathLabel,
    });
    assertWorkingSet(workingSet);
    const workingSetBytes = workingSetByteLength(workingSet);

    this.adapterCalls += 1;
    const command = scriptedAdapter(workingSet);
    assertExactCommand(command);

    const commit = await this.submitFn(commandId, command, commandId);
    if (
      commit.status !== "accepted"
      || commit.code !== "ACCEPTED"
      || String(commit.caseVersion) !== "4"
    ) {
      throw new Error(
        `Expected accepted/ACCEPTED/version 4; got ${commit.status}/${commit.code}/${String(commit.caseVersion)}`,
      );
    }

    const checkpoint = buildCheckpoint({ observationId, commandId });
    const checkpointBytes = await writeCheckpointAtomic(this.checkpointPath, checkpoint);

    return {
      suppressed: false,
      adapterCalls: 1,
      observationId,
      commandId,
      commit,
      checkpoint,
      workingSetBytes,
      checkpointBytes,
    };
  }
}

export async function removePathIfExists(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

export function checkpointDirJoin(baseDir: string): string {
  return join(baseDir, "checkpoint.json");
}

export function watchedPathJoin(baseDir: string): string {
  return join(baseDir, "watched.txt");
}

/** Exact sentinel bytes including the trailing LF. */
export function exactSentinelBytes(): Buffer {
  return Buffer.from(SENTINEL_UTF8, "utf8");
}

/**
 * Byte-exact presence of the frozen sentinel sequence (including LF).
 * Marker text without the trailing LF is not a match.
 */
export function bytesContainExactSentinel(data: string | Buffer): boolean {
  const needle = exactSentinelBytes();
  const haystack = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return haystack.includes(needle);
}

/**
 * Join named captured buffer parts then byte-scan for the exact sentinel.
 * Joining is required so a sentinel split across chunk boundaries is still found.
 */
export function capturedBuffersContainExactSentinel(buffers: {
  restateWorkerStdout: readonly string[];
  restateWorkerStderr: readonly string[];
  runnerDiagnostics: readonly string[];
}): boolean {
  const combined =
    buffers.restateWorkerStdout.join("")
    + buffers.restateWorkerStderr.join("")
    + buffers.runnerDiagnostics.join("");
  return bytesContainExactSentinel(combined);
}

/**
 * Clear in-memory captured string buffers and return remaining UTF-8 byte length.
 * Callers must treat this as the final mutation of those buffers (no further capture).
 */
export function clearStringBuffers(...buffers: string[][]): number {
  for (const buffer of buffers) {
    buffer.length = 0;
  }
  let remaining = 0;
  for (const buffer of buffers) {
    remaining += Buffer.byteLength(buffer.join(""), "utf8");
  }
  return remaining;
}

/**
 * Derive a non-exact deployment URI from the approved constant without introducing
 * a new hostname/IP/URL literal outside the r4 topology set.
 */
export function nonExactDeploymentUri(base: string = REQUIRED_DEPLOYMENT_URI): string {
  return `${base}/not-exact`;
}

/** Approved Restate admin base for local topology only. */
export const RESTATE_ADMIN_BASE = "http://127.0.0.1:9070" as const;

/** Operational Restate service name for the surviving T2b commit path. */
export const TARGET_SERVICE_NAME = "ContinuityCommitT2bV1" as const;

/**
 * Smallest Windows/Node-compatible env allowlist for the local Restate worker child.
 * Provider credential variables are excluded by omission (never forwarded).
 */
const WORKER_ENV_ALLOWLIST = new Set([
  "path",
  "pathext",
  "systemroot",
  "windir",
  "comspec",
  "temp",
  "tmp",
  "tmpdir",
  "userprofile",
  "home",
  "homedrive",
  "homepath",
  "appdata",
  "localappdata",
  "number_of_processors",
  "processor_architecture",
  "os",
  "node_path",
  "tz",
  "lang",
]);

/**
 * Build a minimal child-process env from the parent. Never copies the full parent env
 * and never forwards non-allowlisted keys (including provider credentials).
 */
export function buildWorkerChildEnv(
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    if (WORKER_ENV_ALLOWLIST.has(key.toLowerCase())) {
      env[key] = value;
    }
  }
  return env;
}

export function isTerminalInvocationStatus(status: unknown): boolean {
  // Restate purge applies to completed (terminal) invocations only.
  return status === "completed";
}

/**
 * Narrow Restate admin query: only ContinuityCommitT2bV1 for the given service key.
 * Does not select unrelated services or keys.
 */
export function buildSameKeyInvocationQuery(serviceKey: string): string {
  const escaped = serviceKey.replaceAll("'", "''");
  return (
    "select id, status from sys_invocation"
    + ` where target_service_name = '${TARGET_SERVICE_NAME}'`
    + ` and target_service_key = '${escaped}'`
  );
}

export interface SameKeyInvocationRow {
  id?: unknown;
  status?: unknown;
}

export function classifySameKeyInvocations(rows: readonly SameKeyInvocationRow[]): {
  terminalIds: string[];
  nonTerminal: Array<{ id: string; status: string }>;
} {
  const terminalIds: string[] = [];
  const nonTerminal: Array<{ id: string; status: string }> = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id.length === 0) continue;
    if (isTerminalInvocationStatus(row.status)) {
      terminalIds.push(row.id);
    } else {
      nonTerminal.push({
        id: row.id,
        status: typeof row.status === "string" ? row.status : "unknown",
      });
    }
  }
  return { terminalIds, nonTerminal };
}

export type FetchLike = (
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

/**
 * Before aggregate submit: query Restate admin only for ContinuityCommitT2bV1 + key,
 * purge prior terminal/completed invocations for that key, and fail closed on any
 * non-terminal same-key invocation. Does not touch canonical rows or unrelated keys.
 */
export async function purgePriorTerminalSameKeyInvocations(
  serviceKey: string = FROZEN_COMMAND_ID,
  fetchImpl: FetchLike = fetch,
): Promise<{ purged: number }> {
  const query = buildSameKeyInvocationQuery(serviceKey);
  const queryResponse = await fetchImpl(`${RESTATE_ADMIN_BASE}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!queryResponse.ok) {
    throw new Error(
      `Restate query failed (${String(queryResponse.status)}): ${await queryResponse.text()}`,
    );
  }
  const payload = (await queryResponse.json()) as {
    rows?: SameKeyInvocationRow[];
  };
  const { terminalIds, nonTerminal } = classifySameKeyInvocations(payload.rows ?? []);
  if (nonTerminal.length > 0) {
    const detail = nonTerminal
      .map((row) => `${row.id}:${row.status}`)
      .join(",");
    throw new Error(
      `Non-terminal Restate invocation(s) for ContinuityCommitT2bV1 key=${serviceKey}: ${detail}`,
    );
  }
  let purged = 0;
  for (const invocationId of terminalIds) {
    const purgeResponse = await fetchImpl(
      `${RESTATE_ADMIN_BASE}/invocations/${encodeURIComponent(invocationId)}/purge`,
      { method: "PATCH" },
    );
    if (!purgeResponse.ok && purgeResponse.status !== 404) {
      throw new Error(
        `Invocation purge failed (${String(purgeResponse.status)}): ${await purgeResponse.text()}`,
      );
    }
    if (purgeResponse.ok || purgeResponse.status === 404) {
      purged += 1;
    }
  }
  return { purged };
}
