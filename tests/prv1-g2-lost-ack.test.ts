/**
 * PRV1 G2 — lost-ack reconciliation spike (provider-free).
 * Parent-owned fake broker; forked children; parent kill barriers.
 */
import { fork, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  createParentRuntime,
  type ChildBrokerOp,
  type ParentRuntime,
} from "./prv1-g2-model.js";
import type {
  G2BarrierName,
  G2ResultMessage,
  G2Scenario,
} from "./prv1-g2-child.js";

interface TrackedChild {
  child: ChildProcess;
  logs: string[];
  inbox: Record<string, unknown>[];
}

const activeChildren = new Set<TrackedChild>();
const SEMANTIC_KEY = "prv1:g2:semantic:order-001";

function spawnChild(): TrackedChild {
  const child = fork(new URL("./prv1-g2-child.ts", import.meta.url), [], {
    execPath: process.execPath,
    execArgv: ["--import", "tsx"],
    env: {},
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const tracked: TrackedChild = { child, logs: [], inbox: [] };
  child.stdout?.on("data", (chunk: Buffer) => {
    tracked.logs.push(chunk.toString("utf8"));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    tracked.logs.push(chunk.toString("utf8"));
  });
  child.on("message", (value: unknown) => {
    tracked.inbox.push(value as Record<string, unknown>);
  });
  activeChildren.add(tracked);
  return tracked;
}

async function waitMessage(
  tracked: TrackedChild,
  match: (value: Record<string, unknown>) => boolean,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idx = tracked.inbox.findIndex((m) => match(m));
    if (idx >= 0) {
      const [msg] = tracked.inbox.splice(idx, 1);
      if (msg === undefined) throw new Error("inbox race");
      return msg;
    }
    if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) {
      throw new Error(
        `Child exited before message code=${String(tracked.child.exitCode)} signal=${String(tracked.child.signalCode)} logs=${tracked.logs.join("")}`,
      );
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error(
    `Child message timeout; logs=${tracked.logs.join("")} exit=${String(tracked.child.exitCode)}`,
  );
}

async function killChild(tracked: TrackedChild, timeoutMs = 10_000): Promise<void> {
  if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) {
    activeChildren.delete(tracked);
    return;
  }
  const exited = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Child kill wait timeout"));
    }, timeoutMs);
    tracked.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  tracked.child.kill("SIGKILL");
  await exited;
  // Parent-owned kill must be observed as SIGKILL, not a voluntary exit.
  expect(tracked.child.exitCode).toBeNull();
  expect(tracked.child.signalCode).toBe("SIGKILL");
  activeChildren.delete(tracked);
}

async function stopAllChildren(): Promise<void> {
  const pending = [...activeChildren];
  await Promise.all(pending.map(async (tracked) => killChild(tracked)));
}

function attachBrokerHost(tracked: TrackedChild, runtime: ParentRuntime): () => void {
  const onMessage = (value: unknown) => {
    const msg = value as Record<string, unknown>;
    if (msg.type !== "broker-request") return;
    const id = msg.id;
    const body = msg.body as ChildBrokerOp;
    try {
      const payload = runtime.handle(body);
      tracked.child.send({ type: "broker-response", id, ok: true, payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tracked.child.send({ type: "broker-response", id, ok: false, error: message });
    }
  };
  tracked.child.on("message", onMessage);
  return () => {
    tracked.child.off("message", onMessage);
  };
}

async function runPrimaryToBarrier(options: {
  scenario: G2Scenario;
  runtime: ParentRuntime;
  barrier: G2BarrierName;
}): Promise<{ tracked: TrackedChild; pid: number }> {
  const tracked = spawnChild();
  attachBrokerHost(tracked, options.runtime);
  const ready = await waitMessage(tracked, (m) => m.type === "ready");
  expect(typeof ready.pid).toBe("number");
  expect(ready.pid).toBe(tracked.child.pid);
  tracked.child.send({
    type: "start",
    scenario: options.scenario,
    role: "primary",
    semanticKey: SEMANTIC_KEY,
  });
  await waitMessage(
    tracked,
    (m) => m.type === "barrier" && m.name === options.barrier,
  );
  return { tracked, pid: ready.pid as number };
}

async function runRecovery(options: {
  scenario: G2Scenario;
  runtime: ParentRuntime;
  continueBarrier?: G2BarrierName;
}): Promise<G2ResultMessage & { pid: number }> {
  const tracked = spawnChild();
  const detach = attachBrokerHost(tracked, options.runtime);
  try {
    const ready = await waitMessage(tracked, (m) => m.type === "ready");
    expect(typeof ready.pid).toBe("number");
    expect(ready.pid).toBe(tracked.child.pid);
    tracked.child.send({
      type: "start",
      scenario: options.scenario,
      role: "recovery",
      semanticKey: SEMANTIC_KEY,
    });

    if (options.continueBarrier !== undefined) {
      await waitMessage(
        tracked,
        (m) => m.type === "barrier" && m.name === options.continueBarrier,
      );
      tracked.child.send({ type: "continue" });
    }

    const result = (await waitMessage(
      tracked,
      (m) => m.type === "result",
    )) as unknown as G2ResultMessage;

    expect(typeof result.pid).toBe("number");
    expect(result.pid).toBe(tracked.child.pid);

    if (tracked.child.exitCode === null && tracked.child.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Recovery child did not exit"));
        }, 10_000);
        tracked.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    activeChildren.delete(tracked);
    return { ...result, pid: result.pid };
  } finally {
    detach();
    if (activeChildren.has(tracked)) {
      await killChild(tracked);
    }
  }
}

afterEach(async () => {
  await stopAllChildren();
  expect(activeChildren.size).toBe(0);
});

describe("PRV1 G2 lost-ack reconciliation (provider-free)", () => {
  it("accepted + acknowledgement lost: recover attaches without resubmit", async () => {
    const runtime = createParentRuntime({
      semanticKey: SEMANTIC_KEY,
      submitOutcome: "accepted",
      deliverAck: false,
      nativeDedupe: false,
      ttlMs: 5_000,
    });

    const primary = await runPrimaryToBarrier({
      scenario: "accepted_ack_lost",
      runtime,
      barrier: "after-submit-before-ack",
    });
    expect(runtime.broker.getCounters().submissions).toBe(1);
    expect(runtime.broker.getCounters().physicalConsequences).toBe(1);
    await killChild(primary.tracked);

    const recovered = await runRecovery({ scenario: "accepted_ack_lost", runtime });
    expect(recovered.pid).not.toBe(primary.pid);
    expect(recovered.submitted).toBe(false);
    expect(recovered.attached).toBe(true);
    expect(recovered.phase).toBe("accepted");

    const c = runtime.broker.getCounters();
    expect(c.submissions).toBe(1);
    expect(c.physicalConsequences).toBe(1);
    expect(c.recoverySubmissions).toBe(0);
    expect(c.statusQueries).toBeGreaterThanOrEqual(1);
    expect(runtime.store.getPhase(SEMANTIC_KEY)).toBe("accepted");
  }, 30_000);

  it("still pending: recovery stays reconciling and never resubmits", async () => {
    const runtime = createParentRuntime({
      semanticKey: SEMANTIC_KEY,
      submitOutcome: "pending",
      deliverAck: true,
      nativeDedupe: false,
      ttlMs: 5_000,
    });

    const primary = await runPrimaryToBarrier({
      scenario: "still_pending",
      runtime,
      barrier: "after-submit-before-ack",
    });
    await killChild(primary.tracked);

    const recovered = await runRecovery({ scenario: "still_pending", runtime });
    expect(recovered.pid).not.toBe(primary.pid);
    expect(recovered.submitted).toBe(false);
    expect(recovered.attached).toBe(false);
    expect(["reconciling", "submitted_unknown"]).toContain(recovered.phase);

    const c = runtime.broker.getCounters();
    expect(c.submissions).toBe(1);
    expect(c.physicalConsequences).toBeLessThanOrEqual(1);
    expect(c.recoverySubmissions).toBe(0);
    expect(c.statusQueries).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("rejected: recovery marks rejected without resubmit", async () => {
    const runtime = createParentRuntime({
      semanticKey: SEMANTIC_KEY,
      submitOutcome: "rejected",
      deliverAck: true,
      nativeDedupe: false,
      ttlMs: 5_000,
    });

    const primary = await runPrimaryToBarrier({
      scenario: "rejected",
      runtime,
      barrier: "after-submit-before-ack",
    });
    await killChild(primary.tracked);

    const recovered = await runRecovery({ scenario: "rejected", runtime });
    expect(recovered.pid).not.toBe(primary.pid);
    expect(recovered.submitted).toBe(false);
    expect(recovered.phase).toBe("rejected");

    const c = runtime.broker.getCounters();
    expect(c.submissions).toBe(1);
    expect(c.physicalConsequences).toBeLessThanOrEqual(1);
    expect(c.recoverySubmissions).toBe(0);
    expect(c.statusQueries).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("authority unavailable beyond TTL: UNKNOWN never becomes claimable due TTL", async () => {
    const runtime = createParentRuntime({
      semanticKey: SEMANTIC_KEY,
      submitOutcome: "unavailable",
      deliverAck: true,
      nativeDedupe: false,
      ttlMs: 1_000,
    });

    const primary = await runPrimaryToBarrier({
      scenario: "unavailable_beyond_ttl",
      runtime,
      barrier: "after-submit-before-ack",
    });
    await killChild(primary.tracked);

    const recovered = await runRecovery({
      scenario: "unavailable_beyond_ttl",
      runtime,
    });
    expect(recovered.pid).not.toBe(primary.pid);
    expect(recovered.submitted).toBe(false);
    expect(["manual_review", "unknown_reconcile_required", "reconciling"]).toContain(
      recovered.phase,
    );
    expect(runtime.store.isClaimable(SEMANTIC_KEY, runtime.broker.now())).toBe(false);

    runtime.broker.advanceTime(60_000);
    runtime.store.sweepTtl(runtime.broker.now());
    expect(runtime.store.isClaimable(SEMANTIC_KEY, runtime.broker.now())).toBe(false);

    const c = runtime.broker.getCounters();
    expect(c.submissions).toBe(1);
    expect(c.physicalConsequences).toBeLessThanOrEqual(1);
    expect(c.recoverySubmissions).toBe(0);
    expect(c.statusQueries).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("accepted response observed then checkpoint crash: attach without resubmit", async () => {
    const runtime = createParentRuntime({
      semanticKey: SEMANTIC_KEY,
      submitOutcome: "accepted",
      deliverAck: true,
      nativeDedupe: false,
      ttlMs: 5_000,
    });

    const primary = await runPrimaryToBarrier({
      scenario: "accepted_then_checkpoint_crash",
      runtime,
      barrier: "after-accepted-before-checkpoint",
    });
    await killChild(primary.tracked);

    const recovered = await runRecovery({
      scenario: "accepted_then_checkpoint_crash",
      runtime,
    });
    expect(recovered.pid).not.toBe(primary.pid);
    expect(recovered.submitted).toBe(false);
    expect(recovered.attached).toBe(true);
    expect(recovered.phase).toBe("accepted");

    const c = runtime.broker.getCounters();
    expect(c.submissions).toBe(1);
    expect(c.physicalConsequences).toBe(1);
    expect(c.recoverySubmissions).toBe(0);
    expect(c.statusQueries).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("unsafe TTL-reclaim negative control: second submission and physical=2 without broker dedupe", async () => {
    const runtime = createParentRuntime(
      {
        semanticKey: SEMANTIC_KEY,
        submitOutcome: "accepted",
        deliverAck: false,
        nativeDedupe: false,
        ttlMs: 1_000,
      },
      "unsafe_ttl_reclaim",
    );

    const primary = await runPrimaryToBarrier({
      scenario: "unsafe_ttl_reclaim",
      runtime,
      barrier: "after-submit-before-ack",
    });
    expect(runtime.broker.getCounters().submissions).toBe(1);
    expect(runtime.broker.getCounters().physicalConsequences).toBe(1);
    await killChild(primary.tracked);

    const recovered = await runRecovery({
      scenario: "unsafe_ttl_reclaim",
      runtime,
      continueBarrier: "after-claim-before-resubmit",
    });
    expect(recovered.pid).not.toBe(primary.pid);
    expect(recovered.submitted).toBe(true);

    const c = runtime.broker.getCounters();
    expect(c.submissions).toBe(2);
    expect(c.physicalConsequences).toBe(2);
    expect(c.physicalConsequences).toBeGreaterThan(1);
    // Explicit recovery-resubmit path must account the unsafe recovery fire.
    expect(c.recoverySubmissions).toBe(1);
  }, 30_000);

  it("child source has no finally checkpoint writer", () => {
    const src = readFileSync(new URL("./prv1-g2-child.ts", import.meta.url), "utf8");
    expect(src.includes("finally")).toBe(false);
    expect(src.includes("writeCheckpoint")).toBe(false);
    expect(src.includes("SIGKILL")).toBe(false);
  });
});
