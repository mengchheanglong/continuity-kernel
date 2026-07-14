# Continuity Kernel

A research-grade conformance harness for testing continuity properties across stateful agent and simulation runtimes.

## Current status

```text
T0 DOCUMENTATION SCAFFOLD: COMPLETE
T1 CONTRACT/VECTORS/MATRIX: FROZEN
T2 DBOS COUNTEREXAMPLE: COMPLETE — DBOS_REJECTED_PENDING_ALTERNATIVE
T2B RESTATE: COMPLETE — RESTATE_PASSES_V4
GATE D FOUNDATION: COMPLETE — GATE_D_PASSES_FOUNDATION_V3
T4 DETERMINISTIC ACTOR: INCOMPLETE AT ORIGINAL BOUND — PRIOR PASS SUPERSEDED
T4R ACTOR PRIVACY CORRECTION: COMPLETE — T4R_PASSES_CORRECTION
CONSUMER GATE: CANDIDATE ONLY — PRIOR PASS SUPERSEDED
CUSTOM PERSISTENCE: PARKED
T5 AND LATER: LOCKED
EXTERNAL DEMAND: NOT ESTABLISHED
REPOSITORY VISIBILITY: PRIVATE
```

### How to read the current limit

The **technical foundation target is complete**. Restate/PostgreSQL passed the frozen foundation suite, and T4R closed the actor privacy correction.

The **product/expansion limit is also real**:

- no Tier-A external user evidence is on file;
- the reference consumer is still candidate-only;
- T5 memory/product work remains locked until external signal or a named real consumer need;
- this does **not** mean the project is worthless;
- it means further internal feature expansion is no longer the highest-value move.

The current highest-value work is **external-evidence packaging**: make the sealed result outsider-readable and stranger-runnable, then seek evidence. Packaging is not a claim of demand.

## Research question

Can existing TypeScript durable infrastructure with PostgreSQL, plus a thin deterministic domain layer, satisfy the frozen continuity contract without framework-internal bypasses or custom persistence?

Answer so far:

1. **DBOS 4.23.6** failed the named pre-commit V4 recovery guarantee → `DBOS_REJECTED_PENDING_ALTERNATIVE`.
2. **Restate + PostgreSQL** passed unchanged V4 and the full foundation suite → `GATE_D_PASSES_FOUNDATION_V3`.
3. Custom persistence therefore remains **parked**.
4. Original T4 actor bound closed incomplete for privacy/evidence process reasons; **T4R** later passed the correction → `T4R_PASSES_CORRECTION`.
5. External demand remains **unknown**, not proven present and not proven globally absent.

## Architecture rule

```text
Canonical state changes only through deterministic validation and the selected transaction path.
AI may observe and propose but never owns truth.
Existing durable infrastructure must be tested before custom persistence is justified.
```

## Start here (humans)

1. `docs/public-safe-overview.md` — ~10-minute outsider explanation
2. `docs/architecture-overview.md` — one diagram + layer map
3. `docs/non-claims.md`
4. `docs/runbook.md` — clean local run path
5. `docs/publication-blockers.md` — why this is still private / candidate
6. Sealed decisions:
   - `artifacts/2026-07-11-gate-d-final.md`
   - `artifacts/2026-07-12-t4-bound-review.md`
   - `artifacts/2026-07-12-t4r-final.md`
   - `artifacts/2026-07-12-consumer-gate-review.md`

Agent routing: `AGENTS.md`.

Mission authority and research evidence live in the sibling repository:

- `../transcendiverse-research/GOAL.md`
- `../transcendiverse-research/mission-control/missions/continuity-kernel-v0/`
- `../transcendiverse-research/references/roadmap-verification-2026-07-10.md`

When this repository and Mission Control differ, stop and reconcile before implementation.

## Six frozen headline vectors

1. Authorization and ordered revocation races.
2. Conflict-aware durable command idempotency.
3. Unqueued expected-version conflict.
4. External-kill crash-boundary recovery.
5. Stable RFC 8785/SHA-256 materialization and explicit version failure.
6. Optional-payload erasure without durable runtime leakage.

See `docs/conformance-vectors.md` for exact fixtures and outcomes.

## Runnable harness

See `docs/runbook.md`.

```bash
pnpm install
pnpm run db:up
pnpm run db:setup
docker compose up -d --wait restate
pnpm run doctor
export CK_RESTATE_DEPLOYMENT_URI=http://<host-ip>:9080
pnpm run test:gate-d
pnpm run test:t4
pnpm run example:consumer
```

The reference consumer is an unpromoted in-repo demonstration candidate. It does not open T5 or claim external demand.

## Explicit exclusions

No LLM product, frontend product, vector database, identity-standard adapter, distributed multi-tenant service, Unity, 3D, biometric/neural data, or consciousness claim belongs in the foundation or T4/T4R benchmark.

No identifier, stored memory, behavioral similarity, or computational continuity result proves natural-person identity or subjective continuity.
