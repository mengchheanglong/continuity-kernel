/**
 * PRV1 G2 — parent-owned fake broker + claim/reconcile model.
 * Local synthetic only. Not a production service or exactly-once guarantee.
 */

export type BrokerOutcome = "none" | "pending" | "accepted" | "rejected" | "unavailable";

export type ClaimPhase =
  | "unclaimed"
  | "claimed_pending"
  | "submitted_unknown"
  | "reconciling"
  | "accepted"
  | "rejected"
  | "manual_review"
  | "unknown_reconcile_required";

export type ClaimStoreMode = "safe" | "unsafe_ttl_reclaim";

export interface BrokerCounters {
  submissions: number;
  physicalConsequences: number;
  recoverySubmissions: number;
  statusQueries: number;
}

export interface FakeBrokerConfig {
  semanticKey: string;
  submitOutcome: Exclude<BrokerOutcome, "none">;
  deliverAck: boolean;
  nativeDedupe: boolean;
  ttlMs: number;
}

export interface SubmitResult {
  delivered: boolean;
  outcome: BrokerOutcome;
  physicalApplied: boolean;
  countedAsRecoverySubmission: boolean;
}

export interface RecoverResult {
  phase: ClaimPhase;
  queried: boolean;
  submitted: boolean;
  attached: boolean;
}

export interface AttemptResult {
  phase: ClaimPhase;
  submitted: boolean;
  delivered: boolean;
  outcome: BrokerOutcome;
}

interface BrokerOrder {
  semanticKey: string;
  outcome: Exclude<BrokerOutcome, "none">;
  physicalCount: number;
}

interface ClaimRecord {
  semanticKey: string;
  phase: ClaimPhase;
  claimedAtMs: number;
  everSubmitted: boolean;
}

export class ParentOwnedFakeBroker {
  private readonly config: FakeBrokerConfig;
  private readonly counters: BrokerCounters = {
    submissions: 0,
    physicalConsequences: 0,
    recoverySubmissions: 0,
    statusQueries: 0,
  };
  private readonly orders = new Map<string, BrokerOrder>();
  private clockMs = 0;

  constructor(config: FakeBrokerConfig) {
    this.config = config;
  }

  getCounters(): BrokerCounters {
    return { ...this.counters };
  }

  getBrokerRecord(semanticKey: string): BrokerOutcome {
    return this.orders.get(semanticKey)?.outcome ?? "none";
  }

  submit(
    semanticKey: string,
    opts?: { isRecovery?: boolean },
  ): SubmitResult {
    const isRecovery = opts?.isRecovery === true;
    const existing = this.orders.get(semanticKey);

    if (existing !== undefined && this.config.nativeDedupe) {
      // Dedupe path: counts as a submission attempt but no second physical effect.
      this.counters.submissions += 1;
      if (isRecovery) this.counters.recoverySubmissions += 1;
      return {
        delivered: this.config.deliverAck,
        outcome: existing.outcome,
        physicalApplied: false,
        countedAsRecoverySubmission: isRecovery,
      };
    }

    if (existing !== undefined && !this.config.nativeDedupe) {
      // Second physical consequence when broker has no native dedupe.
      this.counters.submissions += 1;
      if (isRecovery) this.counters.recoverySubmissions += 1;
      existing.physicalCount += 1;
      this.counters.physicalConsequences += 1;
      return {
        delivered: this.config.deliverAck,
        outcome: existing.outcome,
        physicalApplied: true,
        countedAsRecoverySubmission: isRecovery,
      };
    }

    this.counters.submissions += 1;
    if (isRecovery) this.counters.recoverySubmissions += 1;
    this.counters.physicalConsequences += 1;
    const outcome = this.config.submitOutcome;
    this.orders.set(semanticKey, {
      semanticKey,
      outcome,
      physicalCount: 1,
    });
    return {
      delivered: this.config.deliverAck,
      outcome,
      physicalApplied: true,
      countedAsRecoverySubmission: isRecovery,
    };
  }

  queryStatus(semanticKey: string): BrokerOutcome {
    this.counters.statusQueries += 1;
    return this.orders.get(semanticKey)?.outcome ?? "none";
  }

  advanceTime(ms: number): void {
    if (ms < 0) throw new Error("advanceTime requires non-negative ms");
    this.clockMs += ms;
  }

  now(): number {
    return this.clockMs;
  }
}

export class ClaimStore {
  private readonly mode: ClaimStoreMode;
  private readonly ttlMs: number;
  private readonly claims = new Map<string, ClaimRecord>();

  constructor(mode: ClaimStoreMode, ttlMs: number) {
    this.mode = mode;
    this.ttlMs = ttlMs;
  }

  claim(semanticKey: string, nowMs: number): { ok: true } | { ok: false; reason: string } {
    const existing = this.claims.get(semanticKey);
    if (existing === undefined) {
      this.claims.set(semanticKey, {
        semanticKey,
        phase: "claimed_pending",
        claimedAtMs: nowMs,
        everSubmitted: false,
      });
      return { ok: true };
    }
    if (existing.phase === "claimed_pending" && this.mode === "unsafe_ttl_reclaim") {
      // Only reclaimable if sweep deleted it; live claimed_pending blocks.
      return { ok: false, reason: "ALREADY_CLAIMED" };
    }
    if (
      existing.phase === "accepted" ||
      existing.phase === "rejected" ||
      existing.phase === "submitted_unknown" ||
      existing.phase === "reconciling" ||
      existing.phase === "manual_review" ||
      existing.phase === "unknown_reconcile_required" ||
      existing.phase === "claimed_pending"
    ) {
      return { ok: false, reason: `NOT_CLAIMABLE:${existing.phase}` };
    }
    return { ok: false, reason: "NOT_CLAIMABLE" };
  }

  markSubmitted(semanticKey: string): void {
    const claim = this.require(semanticKey);
    claim.everSubmitted = true;
    claim.phase = "submitted_unknown";
  }

  beginReconcile(semanticKey: string): void {
    const claim = this.require(semanticKey);
    if (claim.phase === "accepted" || claim.phase === "rejected") return;
    claim.phase = "reconciling";
  }

  attachAccepted(semanticKey: string): void {
    const claim = this.require(semanticKey);
    claim.phase = "accepted";
  }

  markRejected(semanticKey: string): void {
    const claim = this.require(semanticKey);
    claim.phase = "rejected";
  }

  markManualOrUnknown(semanticKey: string): void {
    const claim = this.require(semanticKey);
    claim.phase = "unknown_reconcile_required";
  }

  getPhase(semanticKey: string): ClaimPhase {
    return this.claims.get(semanticKey)?.phase ?? "unclaimed";
  }

  isClaimable(semanticKey: string, nowMs: number): boolean {
    void nowMs;
    const existing = this.claims.get(semanticKey);
    if (existing === undefined) return true;
    // Safe mode: never claimable once a durable claim exists in non-terminal uncertainty
    // or terminal states. Only absent row is claimable.
    return false;
  }

  sweepTtl(nowMs: number): number {
    let swept = 0;
    if (this.mode === "safe") {
      // Safe mode: TTL must never delete submitted/unknown claims to reopen automatic submit.
      for (const claim of this.claims.values()) {
        if (!claim.everSubmitted) continue;
        if (
          claim.phase === "submitted_unknown" ||
          claim.phase === "reconciling" ||
          claim.phase === "claimed_pending"
        ) {
          const age = nowMs - claim.claimedAtMs;
          if (age >= this.ttlMs) {
            claim.phase = "unknown_reconcile_required";
          }
        }
      }
      return 0;
    }

    // Unsafe TTL reclaim: delete unresolved rows so they become claimable again.
    for (const [key, claim] of this.claims) {
      const age = nowMs - claim.claimedAtMs;
      if (age < this.ttlMs) continue;
      if (
        claim.phase === "claimed_pending" ||
        claim.phase === "submitted_unknown" ||
        claim.phase === "reconciling"
      ) {
        this.claims.delete(key);
        swept += 1;
      }
    }
    return swept;
  }

  wasEverSubmitted(semanticKey: string): boolean {
    return this.claims.get(semanticKey)?.everSubmitted === true;
  }

  private require(semanticKey: string): ClaimRecord {
    const claim = this.claims.get(semanticKey);
    if (claim === undefined) {
      throw new Error(`CLAIM_MISSING:${semanticKey}`);
    }
    return claim;
  }
}

export class ReconciliationAgent {
  private readonly broker: ParentOwnedFakeBroker;
  private readonly store: ClaimStore;

  constructor(broker: ParentOwnedFakeBroker, store: ClaimStore) {
    this.broker = broker;
    this.store = store;
  }

  attemptSubmit(semanticKey: string): AttemptResult {
    return this.submitOnce(semanticKey, { isRecovery: false });
  }

  /**
   * Explicit recovery-resubmit path for the unsafe TTL-reclaim negative control.
   * Safe recovery never uses this — it only queries/attaches.
   */
  attemptRecoveryResubmit(semanticKey: string): AttemptResult {
    return this.submitOnce(semanticKey, { isRecovery: true });
  }

  private submitOnce(
    semanticKey: string,
    opts: { isRecovery: boolean },
  ): AttemptResult {
    const now = this.broker.now();
    const claimed = this.store.claim(semanticKey, now);
    if (!claimed.ok) {
      return {
        phase: this.store.getPhase(semanticKey),
        submitted: false,
        delivered: false,
        outcome: "none",
      };
    }
    const result = this.broker.submit(semanticKey, { isRecovery: opts.isRecovery });
    // Always leave submitted_unknown after physical submit. Local terminal settle /
    // checkpoint is a later step; parent may kill before that barrier continues.
    this.store.markSubmitted(semanticKey);
    return {
      phase: this.store.getPhase(semanticKey),
      submitted: true,
      delivered: result.delivered,
      outcome: result.outcome,
    };
  }

  recover(semanticKey: string): RecoverResult {
    const phase = this.store.getPhase(semanticKey);

    if (phase === "unclaimed") {
      // No durable claim — recovery must not invent a blind fire without claim.
      // For this spike, unclaimed means nothing to attach; do not submit.
      return { phase: "unclaimed", queried: false, submitted: false, attached: false };
    }

    if (phase === "accepted") {
      return { phase: "accepted", queried: false, submitted: false, attached: true };
    }
    if (phase === "rejected") {
      return { phase: "rejected", queried: false, submitted: false, attached: false };
    }

    // Any post-submit or uncertain phase: query only, never blind resubmit.
    if (phase === "claimed_pending" && !this.store.wasEverSubmitted(semanticKey)) {
      // Claimed but never submitted: first submit is allowed (not a recovery resubmit).
      const result = this.broker.submit(semanticKey, { isRecovery: false });
      this.store.markSubmitted(semanticKey);
      this.applyOutcome(semanticKey, result.outcome, result.delivered);
      return {
        phase: this.store.getPhase(semanticKey),
        queried: false,
        submitted: true,
        attached: result.outcome === "accepted" && result.delivered,
      };
    }

    // Remaining uncertain phases: submitted_unknown | reconciling | manual_review |
    // unknown_reconcile_required | claimed_pending(with prior submit).
    this.store.beginReconcile(semanticKey);
    const status = this.broker.queryStatus(semanticKey);
    if (status === "accepted") {
      this.store.attachAccepted(semanticKey);
      return {
        phase: "accepted",
        queried: true,
        submitted: false,
        attached: true,
      };
    }
    if (status === "rejected") {
      this.store.markRejected(semanticKey);
      return {
        phase: "rejected",
        queried: true,
        submitted: false,
        attached: false,
      };
    }
    if (status === "pending") {
      this.store.beginReconcile(semanticKey);
      return {
        phase: "reconciling",
        queried: true,
        submitted: false,
        attached: false,
      };
    }
    // remaining: unavailable | none
    this.store.markManualOrUnknown(semanticKey);
    return {
      phase: "unknown_reconcile_required",
      queried: true,
      submitted: false,
      attached: false,
    };
  }

  private applyOutcome(
    semanticKey: string,
    outcome: BrokerOutcome,
    delivered: boolean,
  ): void {
    if (!delivered) return;
    if (outcome === "accepted") this.store.attachAccepted(semanticKey);
    else if (outcome === "rejected") this.store.markRejected(semanticKey);
    else if (outcome === "pending" || outcome === "unavailable") {
      this.store.beginReconcile(semanticKey);
    }
  }
}

export type ChildBrokerOp =
  | { op: "claim"; semanticKey: string }
  | { op: "attemptSubmit"; semanticKey: string }
  | { op: "attemptRecoveryResubmit"; semanticKey: string }
  | { op: "recover"; semanticKey: string }
  | { op: "query"; semanticKey: string }
  | { op: "sweepTtl" }
  | { op: "advanceTime"; ms: number }
  | { op: "getCounters" }
  | { op: "getPhase"; semanticKey: string }
  | { op: "isClaimable"; semanticKey: string };

export interface ParentRuntime {
  broker: ParentOwnedFakeBroker;
  store: ClaimStore;
  agent: ReconciliationAgent;
  handle(op: ChildBrokerOp): unknown;
}

export function createParentRuntime(
  config: FakeBrokerConfig,
  mode: ClaimStoreMode = "safe",
): ParentRuntime {
  const broker = new ParentOwnedFakeBroker(config);
  const store = new ClaimStore(mode, config.ttlMs);
  const agent = new ReconciliationAgent(broker, store);

  return {
    broker,
    store,
    agent,
    handle(op: ChildBrokerOp): unknown {
      switch (op.op) {
        case "claim":
          return store.claim(op.semanticKey, broker.now());
        case "attemptSubmit":
          return agent.attemptSubmit(op.semanticKey);
        case "attemptRecoveryResubmit":
          return agent.attemptRecoveryResubmit(op.semanticKey);
        case "recover":
          return agent.recover(op.semanticKey);
        case "query":
          return broker.queryStatus(op.semanticKey);
        case "sweepTtl":
          return store.sweepTtl(broker.now());
        case "advanceTime":
          broker.advanceTime(op.ms);
          return { now: broker.now() };
        case "getCounters":
          return broker.getCounters();
        case "getPhase":
          return store.getPhase(op.semanticKey);
        case "isClaimable":
          return store.isClaimable(op.semanticKey, broker.now());
        default: {
          const _exhaustive: never = op;
          throw new Error(`Unknown op ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
  };
}
