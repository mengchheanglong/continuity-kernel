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
  getLaunchEvidence(): { argv: string[]; environmentKeys: string[]; stdout: string; stderr: string };
}

interface TrackedChild {
  child: ChildProcess;
  controller: ActorChildController;
}

const active = new Set<TrackedChild>();
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
  let invalidMessage = false;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const argv = [process.execPath, "--import", "tsx", new URL("./actor-child-runner.ts", import.meta.url).pathname];
  const environmentKeys = ["NODE_ENV"];
  const child = fork(new URL("./actor-child-runner.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: { NODE_ENV: process.env.NODE_ENV ?? "test" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString());
  });
  child.on("message", (value: unknown) => {
    if (!isProposalMessage(value)) {
      invalidMessage = true;
      return;
    }
    messages.push(value);
  });
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
        argv,
        environmentKeys,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      };
    },
  };
  tracked.controller = controller;
  active.add(tracked);
  return controller;
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
