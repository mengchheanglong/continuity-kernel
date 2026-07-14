/**
 * Agent Continuity Spike v1 — provider-free scripted runtime.
 * Commit-before-checkpoint interruption window only. Not a full Agent OS.
 */

import { createHash } from "node:crypto";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  submitCommand,
  type CommitResult,
} from "../../src/alternative/restate/client.js";
import { canonicalHash } from "../../src/domain/canonical.js";
import {
  canonicalRequestHash,
  type ResolveCaseRequest,
} from "../../src/domain/request.js";

export const REQUIRED_DEPLOYMENT_URI = "http://host.docker.internal:9080" as const;
export const RESTATE_ADMIN_BASE = "http://127.0.0.1:9070" as const;
export const RESTATE_INGRESS_BASE = "http://127.0.0.1:8080" as const;
export const TARGET_SERVICE_NAME = "ContinuityCommitT2bV1" as const;

export const FROZEN_REQUEST_HASH =
  "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY" as const;
export const FROZEN_PROJECTION_DIGEST =
  "AEMpcJ6pJpNog4XeTOqNybf6SvWYmyCJVoPeOikywUs" as const;
export const FROZEN_CONTENT_DIGEST =
  "HFswXhQWlOtSGsegt6KRueEzV2AJwiKZQdaexqIrYuU" as const;
export const FROZEN_OBSERVATION_ID =
  "kQYESXVv5x0ua2fCjXNqgJ_ejEA4Il_Z3mAja1G16Cw" as const;
export const FROZEN_COMMAND_ID =
  "agent-spike:v1:kQYESXVv5x0ua2fCjXNqgJ_ejEA4Il_Z3mAja1G16Cw" as const;
export const SENTINEL_UTF8 = "AGENT_CONTINUITY_SPIKE_V1_SENTINEL\n" as const;
export const MAX_STATE_BYTES = 1024 as const;
export const PHASE_DB_APP_NAME_PREFIX = "continuity-kernel-acs-v1-child" as const;

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

const ACCEPTED_RECEIPT_KEYS = [
  "status",
  "code",
  "namespaceId",
  "caseId",
  "commandId",
  "requestHash",
  "authorizationVersion",
  "caseVersion",
  "payloadRef",
  "projectionSchemaVersion",
  "projection",
  "projectionDigest",
] as const;

/** Exact foundation completed projection shape (frozen; does not import fixtures). */
export const FROZEN_COMPLETED_PROJECTION = {
  projectionSchemaVersion: 1,
  namespaceId: NAMESPACE_ID,
  case: {
    caseId: CASE_ID,
    ownerAgentId: "agent:test:owner-001",
    version: "4",
    status: "resolved",
    commitment: {
      deadline: "2026-07-11T12:00:00Z",
      status: "completed",
    },
  },
} as const;

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

export interface PhaseAResult {
  adapterCalls: number;
  submitCalls: number;
  observationId: string;
  commandId: string;
  commit: CommitResult;
  checkpoint?: Checkpoint;
  checkpointBytes?: number;
}

export interface PhaseBResult {
  adapterCalls: number;
  submitCalls: number;
  invocationLookupCalls: number;
  attachCalls: number;
  observationId: string;
  commandId: string;
  recovered: Record<string, unknown>;
  checkpoint: Checkpoint;
  checkpointBytes: number;
  recoverySource: "restate_completed_invocation";
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
  return `agent-spike:v1:${observationId}`;
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

export function validateDeploymentUri(uri: string | undefined): void {
  if (uri !== REQUIRED_DEPLOYMENT_URI) {
    throw new Error(
      `CK_RESTATE_DEPLOYMENT_URI must equal ${REQUIRED_DEPLOYMENT_URI}; got ${uri ?? "(unset)"}`,
    );
  }
}

export function nonExactDeploymentUri(base: string = REQUIRED_DEPLOYMENT_URI): string {
  return `${base}/not-exact`;
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
  const text = serializeCheckpoint(typed);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_STATE_BYTES || bytes < 1) {
    throw new Error(`Invalid checkpoint: size ${String(bytes)}`);
  }
  if (text.includes("AGENT_CONTINUITY_SPIKE_V1_SENTINEL") || bytesContainExactSentinel(text)) {
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

export async function removePathIfExists(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

export function checkpointDirJoin(baseDir: string): string {
  return join(baseDir, "checkpoint.json");
}

export function watchedPathJoin(baseDir: string): string {
  return join(baseDir, "watched.txt");
}

export function exactSentinelBytes(): Buffer {
  return Buffer.from(SENTINEL_UTF8, "utf8");
}

export function bytesContainExactSentinel(data: string | Buffer): boolean {
  const needle = exactSentinelBytes();
  const haystack = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return haystack.includes(needle);
}

export function capturedBuffersContainExactSentinel(buffers: {
  restateWorkerStdout: readonly string[];
  restateWorkerStderr: readonly string[];
  runnerDiagnostics: readonly string[];
  phaseAStdout?: readonly string[];
  phaseAStderr?: readonly string[];
  phaseBStdout?: readonly string[];
  phaseBStderr?: readonly string[];
}): boolean {
  const combined =
    buffers.restateWorkerStdout.join("")
    + buffers.restateWorkerStderr.join("")
    + buffers.runnerDiagnostics.join("")
    + (buffers.phaseAStdout ?? []).join("")
    + (buffers.phaseAStderr ?? []).join("")
    + (buffers.phaseBStdout ?? []).join("")
    + (buffers.phaseBStderr ?? []).join("");
  return bytesContainExactSentinel(combined);
}

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

export function buildAgentChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  options: {
    deploymentUri: string;
    watchedPath: string;
    checkpointPath: string;
    phase: "phase-a" | "phase-b";
  },
): NodeJS.ProcessEnv {
  const env = buildWorkerChildEnv(parentEnv);
  env.CK_RESTATE_DEPLOYMENT_URI = options.deploymentUri;
  env.CK_SPIKE_WATCHED_PATH = options.watchedPath;
  env.CK_SPIKE_CHECKPOINT_PATH = options.checkpointPath;
  env.CK_SPIKE_PHASE = options.phase;
  return env;
}

export function isTerminalInvocationStatus(status: unknown): boolean {
  return status === "completed";
}

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

export function selectExactlyOneCompletedInvocationId(
  rows: readonly SameKeyInvocationRow[],
): string {
  const { terminalIds, nonTerminal } = classifySameKeyInvocations(rows);
  if (nonTerminal.length > 0 || terminalIds.length !== 1 || terminalIds[0] === undefined) {
    throw new Error(
      `Expected exactly one completed ContinuityCommitT2bV1 invocation; terminal=${String(terminalIds.length)} nonTerminal=${String(nonTerminal.length)}`,
    );
  }
  return terminalIds[0];
}

export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualJson(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join("\0") !== rightKeys.join("\0")) return false;
    for (const key of leftKeys) {
      if (!deepEqualJson(left[key], right[key])) return false;
    }
    return true;
  }
  return false;
}

export function buildFrozenAcceptedReceipt(): Record<string, unknown> {
  return {
    status: "accepted",
    code: "ACCEPTED",
    namespaceId: NAMESPACE_ID,
    caseId: CASE_ID,
    commandId: FROZEN_COMMAND_ID,
    requestHash: FROZEN_REQUEST_HASH,
    authorizationVersion: "7",
    caseVersion: "4",
    payloadRef: "payload:test:attachment-001",
    projectionSchemaVersion: 1,
    projection: structuredClone(FROZEN_COMPLETED_PROJECTION),
    projectionDigest: FROZEN_PROJECTION_DIGEST,
  };
}

export function assertRecoveredAcceptedReceipt(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid recovered receipt");
  }
  const receipt = value as Record<string, unknown>;
  const keys = Object.keys(receipt).sort();
  const expectedKeys = [...ACCEPTED_RECEIPT_KEYS].sort();
  if (keys.join("\0") !== expectedKeys.join("\0")) {
    throw new Error("Invalid recovered receipt: key set mismatch");
  }
  if (receipt.status !== "accepted") {
    throw new Error(`Invalid recovered receipt: status ${String(receipt.status)}`);
  }
  if (receipt.code !== "ACCEPTED") {
    throw new Error(`Invalid recovered receipt: code ${String(receipt.code)}`);
  }
  if (receipt.namespaceId !== NAMESPACE_ID) {
    throw new Error(`Invalid recovered receipt: namespaceId ${String(receipt.namespaceId)}`);
  }
  if (receipt.caseId !== CASE_ID) {
    throw new Error(`Invalid recovered receipt: caseId ${String(receipt.caseId)}`);
  }
  if (receipt.commandId !== FROZEN_COMMAND_ID) {
    throw new Error(`Invalid recovered receipt: commandId ${String(receipt.commandId)}`);
  }
  if (receipt.requestHash !== FROZEN_REQUEST_HASH) {
    throw new Error(`Invalid recovered receipt: requestHash ${String(receipt.requestHash)}`);
  }
  if (String(receipt.authorizationVersion) !== "7") {
    throw new Error(
      `Invalid recovered receipt: authorizationVersion ${String(receipt.authorizationVersion)}`,
    );
  }
  if (String(receipt.caseVersion) !== "4") {
    throw new Error(`Invalid recovered receipt: caseVersion ${String(receipt.caseVersion)}`);
  }
  if (receipt.payloadRef !== "payload:test:attachment-001") {
    throw new Error(`Invalid recovered receipt: payloadRef ${String(receipt.payloadRef)}`);
  }
  if (receipt.projectionSchemaVersion !== 1) {
    throw new Error(
      `Invalid recovered receipt: projectionSchemaVersion ${String(receipt.projectionSchemaVersion)}`,
    );
  }
  if (!deepEqualJson(receipt.projection, FROZEN_COMPLETED_PROJECTION)) {
    throw new Error("Invalid recovered receipt: projection mismatch");
  }
  let recomputedDigest: string;
  try {
    recomputedDigest = canonicalHash(receipt.projection);
  } catch (error) {
    throw new Error(
      `Invalid recovered receipt: projection digest recompute failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (recomputedDigest !== FROZEN_PROJECTION_DIGEST) {
    throw new Error(
      `Invalid recovered receipt: recomputed projectionDigest ${recomputedDigest}`,
    );
  }
  if (receipt.projectionDigest !== FROZEN_PROJECTION_DIGEST) {
    throw new Error(
      `Invalid recovered receipt: projectionDigest ${String(receipt.projectionDigest)}`,
    );
  }
  return receipt;
}

export function withVerifiedStoredProjectionDigest(
  stored: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof stored.projection !== "object" || stored.projection === null || Array.isArray(stored.projection)) {
    throw new Error("Stored receipt missing projection");
  }
  let projectionDigest: string;
  try {
    projectionDigest = canonicalHash(stored.projection);
  } catch (error) {
    throw new Error(
      `Stored projection digest recompute failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (projectionDigest !== FROZEN_PROJECTION_DIGEST) {
    throw new Error(`Stored projection digest mismatch: ${projectionDigest}`);
  }
  if (
    stored.projectionDigest !== undefined
    && stored.projectionDigest !== projectionDigest
  ) {
    throw new Error("Stored projectionDigest conflicts with recomputed digest");
  }
  return { ...stored, projectionDigest };
}

export type CanonicalRowsScanOutcome =
  | { status: "ok"; serialized: string }
  | { status: "error"; error: string };

export interface CanonicalRowsPrivacyScanResult {
  scanFailed: boolean;
  rawFileContentInCanonicalRows: boolean;
  serialized: string;
}

/**
 * Canonical-row privacy scan must fail closed: query/scan errors never become empty clean evidence.
 */
export function evaluateCanonicalRowsPrivacyScan(
  outcome: CanonicalRowsScanOutcome,
): CanonicalRowsPrivacyScanResult {
  if (outcome.status === "error") {
    return {
      scanFailed: true,
      // Fail closed: treat as unclean so empty "" cannot pass privacy.
      rawFileContentInCanonicalRows: true,
      serialized: "",
    };
  }
  return {
    scanFailed: false,
    rawFileContentInCanonicalRows: bytesContainExactSentinel(outcome.serialized),
    serialized: outcome.serialized,
  };
}

export function isCanonicalRowsPrivacyScanFailure(
  result: CanonicalRowsPrivacyScanResult,
): boolean {
  return result.scanFailed;
}

/** Mechanically derive duplicate consequence count from final receipt/history counts. */
export function deriveDuplicateConsequenceCount(
  finalCommandReceiptCount: number,
  finalAcceptedHistoryCount: number,
): number {
  return Math.max(
    0,
    finalCommandReceiptCount - 1,
    finalAcceptedHistoryCount - 1,
  );
}

export function checkpointTempSiblingPath(checkpointPath: string): string {
  return `${checkpointPath}.tmp`;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function anyCheckpointWriteArtifactExists(
  checkpointPath: string,
): Promise<boolean> {
  return (
    (await pathExists(checkpointPath))
    || (await pathExists(checkpointTempSiblingPath(checkpointPath)))
  );
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

export async function queryCompletedSameKeyInvocations(
  serviceKey: string = FROZEN_COMMAND_ID,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
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
  const invocationId = selectExactlyOneCompletedInvocationId(payload.rows ?? []);
  return [invocationId];
}

export async function attachCompletedInvocation(
  invocationId: string,
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(
    `${RESTATE_INGRESS_BASE}/restate/attach/${encodeURIComponent(invocationId)}`,
  );
  if (!response.ok) {
    throw new Error(
      `Workflow attach failed (${String(response.status)}): ${await response.text()}`,
    );
  }
  const body: unknown = await response.json();
  return assertRecoveredAcceptedReceipt(body);
}

/**
 * Parent control-plane only. Counts phase-child PostgreSQL connections by application_name prefix.
 * Phase children never open PostgreSQL, so this remains zero on the PASS path.
 */
export async function countAgentPhaseDbConnections(sql: unknown): Promise<number> {
  const query = sql as (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => PromiseLike<Array<{ count: number }>>;
  const rows = await query`
    SELECT count(*)::integer AS count
    FROM pg_catalog.pg_stat_activity
    WHERE application_name LIKE ${`${PHASE_DB_APP_NAME_PREFIX}%`}
  `;
  return rows[0]?.count ?? 0;
}

export interface PhaseAProcessOptions {
  watchedPath: string;
  checkpointPath: string;
  deploymentUri?: string | undefined;
  readBytes: () => Promise<Buffer>;
  submit?: (
    commandId: string,
    request: ResolveCaseRequest,
    workflowId?: string,
  ) => Promise<CommitResult>;
  onAdapterInvoked?: () => Promise<void> | void;
  onAcceptedBeforeCheckpoint?: (
    commit: CommitResult,
    counts: { adapterCalls: number; submitCalls: number },
  ) => Promise<void> | void;
  onBeforeCheckpointWrite?: () => void;
  /** When true, return after accepted barrier hook without writing a checkpoint. */
  skipCheckpoint?: boolean;
}

/**
 * Phase A: one adapter, one submit, accepted barrier before any checkpoint write.
 * No catch-or-cleanup checkpoint fallback — forced termination must leave checkpoint absent.
 */
export async function runPhaseAProcess(options: PhaseAProcessOptions): Promise<PhaseAResult> {
  validateDeploymentUri(options.deploymentUri);
  const submitFn = options.submit ?? submitCommand;

  let adapterCalls = 0;
  let submitCalls = 0;

  const bytes = await options.readBytes();
  const contentDigest = contentDigestOf(bytes);
  const observation = buildObservation({ contentDigest });
  const observationId = observationIdOf(observation);
  const commandId = commandIdOf(observationId);

  if (observationId !== FROZEN_OBSERVATION_ID || commandId !== FROZEN_COMMAND_ID) {
    throw new Error("Frozen v1 observation/command identity mismatch");
  }

  const existing = await readCompletedCheckpoint(options.checkpointPath);
  if (existing !== null) {
    throw new Error("Phase A requires absent checkpoint");
  }

  const workingSet = buildWorkingSet({
    contentDigest,
    observationId,
    watchedPathLabel: observation.watchedPathLabel,
  });
  assertWorkingSet(workingSet);

  const command = scriptedAdapter(workingSet);
  assertExactCommand(command);
  adapterCalls += 1;
  await options.onAdapterInvoked?.();

  submitCalls += 1;
  const commit = await submitFn(commandId, command, commandId);
  if (
    commit.status !== "accepted"
    || commit.code !== "ACCEPTED"
    || String(commit.caseVersion) !== "4"
    || commit.requestHash !== FROZEN_REQUEST_HASH
  ) {
    throw new Error(
      `Expected accepted/ACCEPTED/version 4; got ${commit.status}/${commit.code}/${String(commit.caseVersion)}`,
    );
  }

  // Barrier: accepted result observed, checkpoint writer has not started.
  await options.onAcceptedBeforeCheckpoint?.(commit, { adapterCalls, submitCalls });

  if (options.skipCheckpoint === true) {
    return {
      adapterCalls,
      submitCalls,
      observationId,
      commandId,
      commit,
    };
  }

  options.onBeforeCheckpointWrite?.();
  const checkpoint = buildCheckpoint({ observationId, commandId });
  const checkpointBytes = await writeCheckpointAtomic(options.checkpointPath, checkpoint);

  return {
    adapterCalls,
    submitCalls,
    observationId,
    commandId,
    commit,
    checkpoint,
    checkpointBytes,
  };
}

export interface PhaseBProcessOptions {
  watchedPath: string;
  checkpointPath: string;
  deploymentUri?: string | undefined;
  readBytes: () => Promise<Buffer>;
  fetchImpl?: FetchLike;
}

/**
 * Phase B: zero adapter/submit; one completed-invocation query + one attach; atomic checkpoint.
 * Must not open PostgreSQL — parent compares canonical receipt separately.
 */
export async function runPhaseBProcess(options: PhaseBProcessOptions): Promise<PhaseBResult> {
  validateDeploymentUri(options.deploymentUri);
  const fetchImpl = options.fetchImpl ?? fetch;

  const bytes = await options.readBytes();
  const contentDigest = contentDigestOf(bytes);
  const observation = buildObservation({ contentDigest });
  const observationId = observationIdOf(observation);
  const commandId = commandIdOf(observationId);

  if (observationId !== FROZEN_OBSERVATION_ID || commandId !== FROZEN_COMMAND_ID) {
    throw new Error("Frozen v1 observation/command identity mismatch");
  }

  const existing = await readCompletedCheckpoint(options.checkpointPath);
  if (existing !== null) {
    throw new Error("Phase B requires absent checkpoint before recovery write");
  }

  const invocationIds = await queryCompletedSameKeyInvocations(commandId, fetchImpl);
  const invocationId = invocationIds[0];
  if (invocationId === undefined) {
    throw new Error("Completed invocation id missing after query");
  }
  const recovered = await attachCompletedInvocation(invocationId, fetchImpl);

  const checkpoint = buildCheckpoint({ observationId, commandId });
  const checkpointBytes = await writeCheckpointAtomic(options.checkpointPath, checkpoint);

  return {
    adapterCalls: 0,
    submitCalls: 0,
    invocationLookupCalls: 1,
    attachCalls: 1,
    observationId,
    commandId,
    recovered,
    checkpoint,
    checkpointBytes,
    recoverySource: "restate_completed_invocation",
  };
}
