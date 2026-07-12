import {
  fork,
  type ChildProcess,
  type MessageOptions,
  type SendHandle,
  type Serializable,
} from "node:child_process";

import { canonicalHash } from "../src/domain/canonical.js";
import type { ActorObservationV1 } from "../src/actor/deterministic.js";
import { actorChildObservationFixture } from "./actor-child-fixture.js";

export interface ProposalMessage {
  type: "proposal";
  commandId: string;
  proposalDigest: string;
}

export interface ActorChildController {
  waitForProposal(timeoutMs: number): Promise<ProposalMessage>;
  kill(signal: "SIGKILL", timeoutMs: number): Promise<void>;
  waitForExit(timeoutMs: number): Promise<{ signal: string | null; exitCode: number | null }>;
  getLaunchEvidence(): { spawnargs: string[]; suppliedEnvOwnKeyCount: number; parentSendCount: number;
    outboundMessageCount: number; firstOutboundMessage: unknown; stdout: string; stderr: string };
}

interface TrackedChild {
  child: ChildProcess;
  controller: ActorChildController;
}

const active = new Set<TrackedChild>();
const actorChildObservationFixtureHash = canonicalHash(actorChildObservationFixture);
const maxCapturedOutputBytes = 4_096;

export function clearActorChildObservation(): void {}

export function activeActorChildCount(): number {
  return active.size;
}

export async function stopActorChildren(): Promise<void> {
  const pending = [...active];
  await Promise.all(pending.map((tracked) => tracked.controller.kill("SIGKILL", 5_000)));
}

export function spawnActorChild(observation: ActorObservationV1): ActorChildController {
  if (canonicalHash(observation) !== actorChildObservationFixtureHash) {
    throw new Error("ACTOR_CHILD_OBSERVATION_MISMATCH");
  }

  const messages: ProposalMessage[] = [];
  let outboundMessageCount = 0;
  let firstOutboundMessage: unknown;
  let invalidMessage = false;
  let parentSendCount = 0;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let capturedOutputBytes = 0;
  const suppliedEnv: Record<string, string> = {};
  const child = fork(new URL("./actor-child-runner.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: suppliedEnv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const originalSend = child.send.bind(child);
  child.send = function instrumentedSend(
    message: Serializable,
    sendHandleOrCallback?: SendHandle | ((error: Error | null) => void),
    optionsOrCallback?: MessageOptions | ((error: Error | null) => void),
    callback?: (error: Error | null) => void,
  ): boolean {
    parentSendCount += 1;
    if (typeof sendHandleOrCallback === "function") return originalSend(message, sendHandleOrCallback);
    if (typeof optionsOrCallback === "function") return originalSend(message, sendHandleOrCallback, optionsOrCallback);
    return originalSend(message, sendHandleOrCallback, optionsOrCallback, callback);
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    capturedOutputBytes = appendBoundedOutput(stdoutChunks, chunk, capturedOutputBytes);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    capturedOutputBytes = appendBoundedOutput(stderrChunks, chunk, capturedOutputBytes);
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
      const exited = waitForProcessExit(child, timeoutMs);
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
    getLaunchEvidence() {
      return {
        spawnargs: [...child.spawnargs],
        suppliedEnvOwnKeyCount: Object.keys(suppliedEnv).length,
        parentSendCount,
        outboundMessageCount,
        firstOutboundMessage,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      };
    },
  };
  tracked.controller = controller;
  active.add(tracked);
  return controller;
}

function appendBoundedOutput(chunks: Buffer[], chunk: Buffer, currentBytes: number): number {
  const remaining = maxCapturedOutputBytes - currentBytes;
  if (remaining <= 0) return currentBytes;
  const retained = chunk.subarray(0, remaining);
  chunks.push(retained);
  return currentBytes + retained.length;
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
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
