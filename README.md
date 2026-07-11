# Continuity Kernel

A research-grade conformance harness for testing continuity properties across stateful agent and simulation runtimes.

## Current status

```text
T0 DOCUMENTATION SCAFFOLD: COMPLETE — 66fe253
T1 CONTRACT/VECTORS/MATRIX: FROZEN
T2 DBOS COUNTEREXAMPLE: COMPLETE — DBOS_REJECTED_PENDING_ALTERNATIVE — 6ceb5b1
T2B RESTATE: COMPLETE — RESTATE_PASSES_V4
GATE D FOUNDATION: COMPLETE — GATE_D_PASSES_FOUNDATION_V3
T4 DETERMINISTIC ACTOR: COMPLETE — T4_PASSES_DETERMINISTIC_ACTOR
CUSTOM PERSISTENCE: PARKED
T5 AND LATER: LOCKED
```

The documentation baseline is commit `66fe2539f1ff1b93e38663e7b27c32804d2d0fc4`. T2 ended with the evidence-backed DBOS decision in `artifacts/2026-07-11-t2-final.md`. T2b completed with `RESTATE_PASSES_V4`; see `artifacts/2026-07-11-t2b-final.md`. Gate D completed with `GATE_D_PASSES_FOUNDATION_V3`; see `artifacts/2026-07-11-gate-d-final.md`. T4 completed within its original four-hour bound with `T4_PASSES_DETERMINISTIC_ACTOR`; see `artifacts/2026-07-11-t4-final.md`.

## Research question

Can existing TypeScript durable infrastructure with PostgreSQL, plus a thin deterministic domain layer, satisfy the frozen continuity contract without framework-internal bypasses or custom persistence? T2 showed that DBOS 4.23.6 fails the named pre-commit V4 recovery guarantee. T2b showed pinned Restate satisfies unchanged V4, Gate D showed the Restate/PostgreSQL direction passes the complete frozen foundation suite, and T4 showed one pure deterministic actor can propose through that foundation without owning truth.

Restate passed the foundation and the deterministic-actor baseline, so custom persistence remains parked. T5 is not started automatically.

## Architecture rule

```text
Canonical state changes only through deterministic validation and the selected transaction path.
AI may observe and propose but never owns truth.
Existing durable infrastructure must be tested before custom persistence is justified.
```

## Read first

1. `AGENTS.md`
2. `docs/research-question.md`
3. `docs/non-claims.md`
4. `docs/threat-and-privacy-boundary.md`
5. `docs/invariants.md`
6. `docs/conformance-vectors.md`
7. `docs/implementation-matrix.md`
8. `docs/architecture/preflight-decisions.md`
9. `artifacts/2026-07-11-gate-d-final.md`
10. `artifacts/2026-07-11-t4-final.md`
11. `docs/architecture/t4-preflight.md`

Mission authority and research evidence live in the sibling repository:

- `../transcendiverse-research/GOAL.md`
- `../transcendiverse-research/mission-control/missions/continuity-kernel-v0/SPEC.md`
- `../transcendiverse-research/mission-control/missions/continuity-kernel-v0/TASKS.md`
- `../transcendiverse-research/references/roadmap-verification-2026-07-10.md`
- `../transcendiverse-research/references/continuity-kernel-technical-validation-2026-07-10.md`

When this repository and Mission Control differ, stop and reconcile the conflict before implementation.

## Six frozen headline vectors

1. Authorization and ordered revocation races.
2. Conflict-aware durable command idempotency.
3. Unqueued expected-version conflict.
4. External-kill crash-boundary recovery.
5. Stable RFC 8785/SHA-256 materialization and explicit version failure.
6. Optional-payload erasure without durable runtime leakage.

See `docs/conformance-vectors.md` for exact fixtures and outcomes.

## Clock boundaries

The T2 clock closed with decision commit `6ceb5b1`. T2b ran within its six-hour deadline and 150-line candidate cap. Gate D ran within its original eight-hour deadline and 400-line cap. T4 ran from `2026-07-11T15:46:31Z` to decision at `2026-07-11T18:47:37Z`, within its four-hour deadline and 140-line actor cap (116 counted lines).

## Explicit exclusions

No LLM, frontend, vector database, identity-standard adapter, distributed service, Unity, 3D, biometric/neural data, or consciousness claim belongs in the foundation or T4 benchmark.

No identifier, stored memory, behavioral similarity, or computational continuity result proves natural-person identity or subjective continuity.
