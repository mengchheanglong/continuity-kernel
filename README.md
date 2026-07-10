# Continuity Kernel

A research-grade conformance harness for testing continuity properties across stateful agent and simulation runtimes.

## Current status

```text
T0 DOCUMENTATION SCAFFOLD: COMPLETE — 66fe253
T1 CONTRACT/VECTORS/MATRIX: FROZEN
T2 12-HOUR IMPLEMENTATION CLOCK: RUNNING — DEADLINE 2026-07-11T07:09:28Z
CUSTOM PERSISTENCE: NOT AUTHORIZED
```

The documentation baseline is commit `66fe2539f1ff1b93e38663e7b27c32804d2d0fc4`. T2 started from clean status at `2026-07-10T19:09:28Z`; implementation evidence begins at `artifacts/2026-07-10-t2-start.md`.

## Research question

Can DBOS TypeScript with PostgreSQL, plus a thin deterministic domain layer, satisfy six frozen continuity vectors within 12 implementation hours and at most 300 counted hand-written non-test TypeScript/SQL lines—without modifying or bypassing DBOS internals or introducing a generic custom event store/projector?

If yes, bespoke-kernel-first is falsified and parked. If DBOS repeatedly fails one unchanged mission-defining vector for an intrinsic reason, the failure must survive the appropriate bounded existing alternative before any exact custom capability can be considered.

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

## T2 clock boundary

The 12-hour clock started at `2026-07-10T19:09:28Z` and stops no later than `2026-07-11T07:09:28Z`. All package, dependency, PostgreSQL/DBOS setup, migration, script, source, test, debugging, and rerun time now counts. Expected vector outcomes remain frozen.

## Explicit exclusions

No LLM, frontend, vector database, identity-standard adapter, distributed service, Unity, 3D, biometric/neural data, or consciousness claim belongs in the foundation benchmark.

No identifier, stored memory, behavioral similarity, or computational continuity result proves natural-person identity or subjective continuity.
