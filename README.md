# Continuity Kernel

A research-grade conformance harness for testing continuity properties across stateful agent and simulation runtimes.

## Current status

```text
T0 DOCUMENTATION SCAFFOLD: CONTENT COMPLETE; BASELINE COMMIT PENDING
T1 CONTRACT/VECTORS/MATRIX: FROZEN; BASELINE COMMIT PENDING
T2 12-HOUR IMPLEMENTATION CLOCK: NOT STARTED
CUSTOM PERSISTENCE: NOT AUTHORIZED
```

This repository currently contains documentation only. It intentionally has no package manifest, lockfile, dependencies, database configuration, migrations, build scripts, implementation source, or tests.

The Git boundary is an unborn `main` branch with an uncommitted documentation baseline. T2 cannot start until that baseline is reviewed, committed, and the repository is clean.

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

The 12-hour clock has **not** started.

Before any of the following is created or run, record the UTC start timestamp and clean Git status under `artifacts/`:

- package manifest or lockfile;
- dependency installation;
- PostgreSQL or DBOS configuration;
- migration or build script;
- implementation source or executable tests.

After the timestamp, all setup, coding, debugging, and reruns count.

## Explicit exclusions

No LLM, frontend, vector database, identity-standard adapter, distributed service, Unity, 3D, biometric/neural data, or consciousness claim belongs in the foundation benchmark.

No identifier, stored memory, behavioral similarity, or computational continuity result proves natural-person identity or subjective continuity.
