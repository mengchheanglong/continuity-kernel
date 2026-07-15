/**
 * PRV1 G2 child process — IPC-only client of a parent-owned fake broker.
 * Parent controls kill barriers. Checkpoint writes are parent-owned only.
 */

export type G2Scenario =
  | "accepted_ack_lost"
  | "still_pending"
  | "rejected"
  | "unavailable_beyond_ttl"
  | "accepted_then_checkpoint_crash"
  | "unsafe_ttl_reclaim";

export type G2Role = "primary" | "recovery";

export type G2BarrierName =
  | "after-submit-before-ack"
  | "after-accepted-before-checkpoint"
  | "after-claim-before-resubmit";

export interface G2StartMessage {
  type: "start";
  scenario: G2Scenario;
  role: G2Role;
  semanticKey: string;
}

export interface G2BrokerRequest {
  type: "broker-request";
  id: number;
  body: Record<string, unknown>;
}

export interface G2BrokerResponse {
  type: "broker-response";
  id: number;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

export interface G2BarrierMessage {
  type: "barrier";
  name: G2BarrierName;
}

export interface G2ResultMessage {
  type: "result";
  role: G2Role;
  scenario: G2Scenario;
  phase: string;
  submitted: boolean;
  delivered: boolean;
  attached: boolean;
  pid: number;
}

export interface G2ErrorMessage {
  type: "error";
  message: string;
}

export interface G2ReadyMessage {
  type: "ready";
  pid: number;
}

type Outbound =
  | G2ReadyMessage
  | G2BrokerRequest
  | G2BarrierMessage
  | G2ResultMessage
  | G2ErrorMessage;

type Inbound = G2StartMessage | G2BrokerResponse | { type: "continue" };

function send(message: Outbound): void {
  if (typeof process.send !== "function") {
    throw new Error("IPC channel unavailable");
  }
  process.send(message);
}

function waitForMessage<T extends Inbound>(
  match: (value: Inbound) => value is T,
  timeoutMs = 30_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Child IPC wait timeout"));
    }, timeoutMs);
    const onMessage = (value: unknown) => {
      const msg = value as Inbound;
      if (match(msg)) {
        cleanup();
        resolve(msg);
      }
    };
    const onDisconnect = () => {
      cleanup();
      reject(new Error("IPC disconnected"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      process.off("message", onMessage);
      process.off("disconnect", onDisconnect);
    };
    process.on("message", onMessage);
    process.on("disconnect", onDisconnect);
  });
}

let nextId = 1;

async function brokerCall(body: Record<string, unknown>): Promise<unknown> {
  const id = nextId;
  nextId += 1;
  send({ type: "broker-request", id, body });
  const response = await waitForMessage(
    (v): v is G2BrokerResponse => v.type === "broker-response" && v.id === id,
  );
  if (!response.ok) {
    throw new Error(response.error ?? "broker op failed");
  }
  return response.payload;
}

async function waitForeverAtBarrier(name: G2BarrierName): Promise<never> {
  send({ type: "barrier", name });
  // Parent owns kill. Never self-checkpoint. No cleanup checkpoint writer.
  await waitForMessage((v): v is { type: "continue" } => v.type === "continue", 3_600_000);
  throw new Error(`Unexpected continue at barrier ${name}`);
}

async function runPrimary(scenario: G2Scenario, semanticKey: string): Promise<void> {
  if (scenario === "unsafe_ttl_reclaim") {
    const attempt = (await brokerCall({
      op: "attemptSubmit",
      semanticKey,
    })) as { phase: string; submitted: boolean; delivered: boolean; outcome: string };
    if (!attempt.submitted) {
      throw new Error("unsafe primary expected physical submit");
    }
    await waitForeverAtBarrier("after-submit-before-ack");
  }

  if (scenario === "accepted_ack_lost") {
    const attempt = (await brokerCall({
      op: "attemptSubmit",
      semanticKey,
    })) as { phase: string; submitted: boolean; delivered: boolean; outcome: string };
    if (!attempt.submitted) {
      throw new Error("expected submission");
    }
    if (attempt.delivered) {
      throw new Error("ack must be lost for accepted_ack_lost");
    }
    await waitForeverAtBarrier("after-submit-before-ack");
  }

  if (scenario === "still_pending" || scenario === "rejected" || scenario === "unavailable_beyond_ttl") {
    const attempt = (await brokerCall({
      op: "attemptSubmit",
      semanticKey,
    })) as { phase: string; submitted: boolean; delivered: boolean; outcome: string };
    if (!attempt.submitted) {
      throw new Error("expected first submission");
    }
    await waitForeverAtBarrier("after-submit-before-ack");
  }

  if (scenario === "accepted_then_checkpoint_crash") {
    const attempt = (await brokerCall({
      op: "attemptSubmit",
      semanticKey,
    })) as { phase: string; submitted: boolean; delivered: boolean; outcome: string };
    if (!attempt.submitted || !attempt.delivered || attempt.outcome !== "accepted") {
      throw new Error("expected delivered accepted outcome before checkpoint barrier");
    }
    await waitForeverAtBarrier("after-accepted-before-checkpoint");
  }

  throw new Error(`Unhandled primary scenario ${scenario}`);
}

async function runRecovery(scenario: G2Scenario, semanticKey: string): Promise<void> {
  if (scenario === "unavailable_beyond_ttl") {
    await brokerCall({ op: "advanceTime", ms: 60_000 });
    await brokerCall({ op: "sweepTtl" });
  }

  if (scenario === "unsafe_ttl_reclaim") {
    await brokerCall({ op: "advanceTime", ms: 60_000 });
    await brokerCall({ op: "sweepTtl" });
    const claimable = (await brokerCall({ op: "isClaimable", semanticKey })) as boolean;
    if (!claimable) {
      throw new Error("unsafe control expected claimable after TTL sweep");
    }
    send({ type: "barrier", name: "after-claim-before-resubmit" });
    await waitForMessage((v): v is { type: "continue" } => v.type === "continue", 30_000);
    // Explicit recovery-resubmit path (negative control only).
    const attempt = (await brokerCall({
      op: "attemptRecoveryResubmit",
      semanticKey,
    })) as { phase: string; submitted: boolean; delivered: boolean; outcome: string };
    send({
      type: "result",
      role: "recovery",
      scenario,
      phase: attempt.phase,
      submitted: attempt.submitted,
      delivered: attempt.delivered,
      attached: false,
      pid: process.pid,
    });
    return;
  }

  const recovered = (await brokerCall({
    op: "recover",
    semanticKey,
  })) as {
    phase: string;
    queried: boolean;
    submitted: boolean;
    attached: boolean;
  };

  send({
    type: "result",
    role: "recovery",
    scenario,
    phase: recovered.phase,
    submitted: recovered.submitted,
    delivered: false,
    attached: recovered.attached,
    pid: process.pid,
  });
}

async function main(): Promise<void> {
  send({ type: "ready", pid: process.pid });
  const start = await waitForMessage((v): v is G2StartMessage => v.type === "start");
  if (start.role === "primary") {
    await runPrimary(start.scenario, start.semanticKey);
    return;
  }
  await runRecovery(start.scenario, start.semanticKey);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    send({ type: "error", message });
  } catch {
    // IPC may already be gone.
  }
  // No cleanup checkpoint writer. Exit non-zero after error report.
  process.exitCode = 1;
});
