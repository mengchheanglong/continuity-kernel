# Continuity Kernel

A research-grade conformance harness for testing continuity properties across stateful agent and simulation runtimes.

## Current status

```text
T0 DOCUMENTATION SCAFFOLD: COMPLETE — 66fe253
T1 CONTRACT/VECTORS/MATRIX: FROZEN
T2 DBOS COUNTEREXAMPLE: COMPLETE — DBOS_REJECTED_PENDING_ALTERNATIVE — 6ceb5b1
T2B RESTATE: COMPLETE — RESTATE_PASSES_V4
CUSTOM PERSISTENCE: PARKED
```

The documentation baseline is commit `66fe2539f1ff1b93e38663e7b27c32804d2d0fc4`. T2 started clean at `2026-07-10T19:09:28Z` and ended with the evidence-backed DBOS decision in `artifacts/2026-07-11-t2-final.md`. T2b started from commit `5cfc4b1065b407c7138d73d261e47319e9ec996d` at `2026-07-11T02:43:48Z` and completed within the frozen bounds with `RESTATE_PASSES_V4`; see `artifacts/2026-07-11-t2b-final.md`.

## Research question

Can existing TypeScript durable infrastructure with PostgreSQL, plus a thin deterministic domain layer, satisfy the frozen continuity contract without framework-internal bypasses or custom persistence? T2 showed that DBOS 4.23.6 fails the named pre-commit V4 recovery guarantee. T2b asks whether pinned Restate satisfies that unchanged boundary within six implementation hours and 150 candidate-specific non-test TypeScript/SQL lines.

If Restate passes the unchanged V4 boundary, custom persistence remains parked and the surviving direction advances to the complete Gate-D suite. If Restate repeatedly fails the same guarantee for an intrinsic reason, a dated review must name the exact missing capability before any narrow custom feasibility spike can be considered.

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
9. `artifacts/2026-07-11-t2-final.md`
10. `docs/architecture/t2b-preflight.md`
11. `artifacts/2026-07-11-t2b-final.md`

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
6. Optional-payload erasure without durable DBOS/runtime leakage.

See `docs/conformance-vectors.md` for exact fixtures and outcomes.

## Clock boundaries

The T2 clock closed with decision commit `6ceb5b1`. T2b ran from `2026-07-11T02:43:48Z` to the decision at `2026-07-11T06:51:47Z`, within its six-hour deadline and 150-line candidate cap. Restate passed unchanged V4; Gate D must still port/run all six frozen vectors before any foundation promotion.

## Explicit exclusions

No LLM, frontend, vector database, identity-standard adapter, distributed service, Unity, 3D, biometric/neural data, or consciousness claim belongs in the foundation benchmark.

No identifier, stored memory, behavioral similarity, or computational continuity result proves natural-person identity or subjective continuity.
