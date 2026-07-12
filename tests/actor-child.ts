import { fork, type ChildProcess } from "node:child_process";

import { canonicalHash } from "../src/domain/canonical.js";
import type { ActorObservationV1 } from "../src/actor/deterministic.js";

export interface ProposalMessage {
  type: "proposal";
  commandId: string;
  proposalDigest: string;
}

export interface ActorChildController {
  waitForProposal(timeoutMs: number): Promise<ProposalMessage>;
  kill(signal: "SIGKILL", timeoutMs: number): Promise<void>;
  waitForExit(timeoutMs: number): Promise<{ signal: string | null; exitCode: number | null }>;
  waitForClose(timeoutMs: number): Promise<{ signal: string | null; exitCode: number | null }>;
  getLaunchEvidence(): {
    spawnargs: string[];
    suppliedEnvOwnKeyCount: number;
    suppliedEnv: Record<string, string>;
    parentSendCount: number;
    outboundMessageCount: number;
    firstOutboundMessage: unknown;
    stdout: string;
    stderr: string;
  };
}

interface TrackedChild {
  child: ChildProcess;
  controller: ActorChildController;
}

const active = new Set<TrackedChild>();
const maxCapturedStdioBytes = 4_096;
let parentSuppliedHash: string | null = null;

export function bindActorChildObservation(observation: ActorObservationV1): void {
  parentSuppliedHash = canonicalHash(observation);
}

export function clearActorChildObservation(): void {
  parentSuppliedHash = null;
}

export function activeActorChildCount(): number {
  return active.size;
}

export async function stopActorChildren(): Promise<void> {
  const pending = [...active];
  await Promise.all(pending.map((tracked) => tracked.controller.kill("SIGKILL", 5_000)));
}

export function spawnActorChild(observation: ActorObservationV1): ActorChildController {
  if (parentSuppliedHash === null) {
    throw new Error("ACTOR_CHILD_OBSERVATION_UNBOUND");
  }
  if (canonicalHash(observation) !== parentSuppliedHash) {
    throw new Error("ACTOR_CHILD_OBSERVATION_MISMATCH");
  }

  const messages: ProposalMessage[] = [];
  let outboundMessageCount = 0;
  let firstOutboundMessage: unknown;
  let invalidMessage = false;
  let parentSendCount = 0;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const suppliedEnv = { NODE_ENV: process.env.NODE_ENV ?? "test" };
  let closedResult: { signal: string | null; exitCode: number | null } | null = null;
  const child = fork(new URL("./actor-child-runner.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: suppliedEnv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    appendBounded(stdoutChunks, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    appendBounded(stderrChunks, chunk);
  });
  child.on("message", (value: unknown) => {
    outboundMessageCount += 1;
    firstOutboundMessage ??= value;
    if (!isProposalMessage(value)) {
      invalidMessage = true;
      return;
    }
    messages.push(value);
  });
  child.once("close", (exitCode, signal) => {
    closedResult = { signal, exitCode };
  });
  parentSendCount += 1;
  child.send({ type: "observation", observation });

  const tracked: TrackedChild = {
    child,
    controller: null as unknown as ActorChildController,
  };
  const controller: ActorChildController = {
    async waitForProposal(timeoutMs: number): Promise<ProposalMessage> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (invalidMessage) throw new Error("Actor child sent an invalid IPC message");
        const message = messages.shift();
        if (message !== undefined) {
          if (Object.keys(message).sort().join() !== "commandId,proposalDigest,type") {
            throw new Error("Actor child proposal message has unexpected keys");
          }
          return message;
        }
        if (child.exitCode !== null) {
          throw new Error(`Actor child exited before proposal (${String(child.exitCode)})`);
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      }
      throw new Error("Actor child proposal timeout");
    },
    async kill(signal: "SIGKILL", timeoutMs: number): Promise<void> {
      if (child.exitCode !== null) {
        active.delete(tracked);
        return;
      }
      const exited = waitForProcessClose(child, timeoutMs, () => closedResult);
      child.kill(signal);
      await exited;
      active.delete(tracked);
    },
    async waitForExit(timeoutMs: number): Promise<{ signal: string | null; exitCode: number | null }> {
      if (child.exitCode !== null || child.signalCode !== null) {
        return { signal: child.signalCode, exitCode: child.exitCode };
      }
      await waitForProcessExit(child, timeoutMs);
      return { signal: child.signalCode, exitCode: child.exitCode };
    },
    async waitForClose(timeoutMs: number): Promise<{ signal: string | null; exitCode: number | null }> {
      await waitForProcessClose(child, timeoutMs, () => closedResult);
      if (closedResult === null) throw new Error("Actor child close result missing");
      return closedResult;
    },
    getLaunchEvidence() {
      return {
        spawnargs: [...child.spawnargs],
        suppliedEnvOwnKeyCount: Object.keys(suppliedEnv).length,
        suppliedEnv,
        parentSendCount,
        outboundMessageCount,
        firstOutboundMessage,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      };
    },
  };
  tracked.controller = controller;
  active.add(tracked);
  return controller;
}

function appendBounded(chunks: string[], chunk: Buffer): void {
  const currentLength = chunks.reduce((total, value) => total + value.length, 0);
  if (currentLength >= maxCapturedStdioBytes) return;
  chunks.push(chunk.toString().slice(0, maxCapturedStdioBytes - currentLength));
}

function isProposalMessage(value: unknown): value is ProposalMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "proposal"
    && typeof message.commandId === "string"
    && typeof message.proposalDigest === "string"
    && Object.keys(message).sort().join() === "commandId,proposalDigest,type";
}

function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Actor child exit timeout"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function waitForProcessClose(
  child: ChildProcess,
  timeoutMs: number,
  currentResult: () => { signal: string | null; exitCode: number | null } | null,
): Promise<void> {
  if (currentResult() !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Actor child close timeout"));
    }, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
