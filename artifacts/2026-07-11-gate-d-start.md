# Gate D Start — Restate/PostgreSQL Foundation Integrity

**Recorded/start:** 2026-07-11T07:12:49Z  
**Hard deadline:** 2026-07-11T15:12:49Z  
**Maximum duration:** 8 hours  
**Clean baseline:** `b20d337556a3372d43983adeab449a59c0f6f8aa`  
**Remote baseline:** `origin/main` = `b20d337556a3372d43983adeab449a59c0f6f8aa`  
**Baseline status:** clean

## Authority

- Preflight: `docs/architecture/gate-d-preflight.md`
- Preflight SHA-256: `b4b6b8ce098b93ef3c26d95289a0cfb82308840175a14ffdb71a55e3b527d31d`
- Task plan: `docs/plans/2026-07-11-gate-d-implementation-plan.md`
- Prior decision/evidence: `artifacts/2026-07-11-t2b-final.md`
- Frozen vectors: `docs/conformance-vectors.md`
- Ten invariants: `docs/invariants.md`

```text
T2B DECISION: RESTATE_PASSES_V4
GATE D CLOCK: STARTED
CUSTOM PERSISTENCE: PARKED
FOUNDATION PROMOTION: NOT YET CLAIMED
```

## Host/tool baseline

```text
Node.js:       v24.14.0
pnpm:          10.32.1
Docker client: 29.6.1
Docker server: 29.6.1
Git:           2.49.0.windows.1
Host:          Windows 10 with Git Bash/MSYS
```

Docker was already running for an unrelated workload. The Continuity Kernel PostgreSQL and Restate containers were stopped when this artifact was created. Starting those benchmark services, registering the endpoint, running executable probes/tests, or changing source/configuration occurs only after this artifact is committed and pushed.

## Frozen candidate/runtime pins

```text
Restate Server: 1.7.2
Restate Linux/AMD64 image:
sha256:9c9b8dc71581c02ce1d85dd9928ed2728b92a5a43499880c86a1fa8b01fab86a

@restatedev/restate-sdk: 1.15.1
sha512-MYIBoggyx806UjHvIpoXr1wi9ivCrlHesOhxE/pW8bTXrvBBV6tN0EwhQR1126DmpkFw5qaVFMSJ4I2rr2Tlkw==

@restatedev/restate-sdk-clients: 1.15.1
sha512-8VBX2sbbJYGmbpS95Ara14BdRvoQjmR6zg/EYIxuoKbrIP7N+JeSmgk27YRh23jBaZX8xUMaDiDSAO5H/iuzAQ==

PostgreSQL Linux/AMD64 image:
sha256:0c49c0c906cb405ea65e70c284570fee91c7750ca9336369afc0edf4fce211db
```

No package, image, database, migration, runtime service, state store, or custom persistence is added by Gate D.

## Frozen topology

- one direct Node endpoint child using native IPC;
- Restate public ingress/Admin/SQL-introspection APIs only;
- existing `continuity_app` runtime role;
- existing canonical PostgreSQL `continuity.commit_command` function;
- PostgreSQL request-hash receipt remains semantic exactly-once authority;
- Restate embedded state is not canonical state;
- no queue/concurrency-one setting as conflict proof;
- no DBOS test is required to pass for the surviving direction;
- rejected DBOS evidence remains unchanged in the repository.

## Counted production baseline and cap

Hand-written nonblank, noncomment TypeScript/SQL:

```text
src/domain/canonical.ts=79
src/alternative/restate/client.ts=30
src/alternative/restate/index.ts=95
migrations/001_continuity.sql=124

BASELINE=328
CAP=400
AVAILABLE=72
```

Tests, scripts, package/lockfiles, Compose, docs, generated files, and artifacts are excluded. Required production logic may not be hidden in excluded paths. No dependency or migration change is expected; a RED test requiring either triggers a dated scope review before change.

## Frozen vector and invariant scope

Gate D must cover, without changing expected outcomes:

1. V1 authorization and ordered revocation races;
2. V2 conflict-aware durable command idempotency;
3. V3 unqueued expected-version conflict and durable cancellation/no-late-commit;
4. V4 external-kill recovery before, inside, and after commit;
5. V5 stable materialization/digest and closed version/schema failures;
6. V6 optional-payload erasure without durable leakage;
7. all ten invariants and every mandatory supporting assertion.

## Exact planned Gate-D runtime test names

```text
GateD-V1A rejects an out-of-scope actor through Restate
GateD-V1B rejects after grant version 8 commits before Restate validation
GateD-V2A returns one stored receipt for concurrent same-hash submissions
GateD-V2B rejects different hash across same and new workflow keys
GateD-V2B preserves receipt authority after endpoint restart and supported invocation purge
GateD supporting assertion keeps command IDs independent across namespaces
GateD-V3 returns one accepted and one expected-version conflict without a queue
GateD-V3 durably cancels retrying invocation and observes no late commit
T2b-V4A Restate recovers exactly once after a pre-transaction worker kill
T2b-V4B Restate rolls back then recovers exactly once after a mid-transaction worker kill
T2b-V4C Restate deduplicates recovery after commit before step completion
GateD-V5 rejects undeclared optional payload bytes before workflow submission
GateD-V5 rejects malformed direct ingress input without a canonical transition
GateD-V5 rejects unsupported request-hash schema through Restate
GateD-V5 returns the exact frozen projection digest after endpoint restart
GateD-V5 records supported Restate service/deployment version through public introspection
GateD-V6 erases optional payload bytes without application, journal, metadata, result, error, or log leakage
```

Existing canonical/database test names remain unchanged and provide transaction-internal, privilege, lock-ordering, version, cross-namespace, and RFC 8785/I-JSON evidence.

## Frozen timeout bounds

```text
Endpoint/service readiness:            30 seconds
PostgreSQL backend disappearance:      45 seconds
Recovery after barrier release:        30 seconds
Cancellation confirmation:             10 seconds
Post-cancellation observation:          5 seconds
Per-test hard maximum:                120 seconds
```

## Aggregate target

```text
pnpm run test:gate-d
```

The final aggregate will include only the surviving direction:

```text
tests/canonical.test.ts
tests/database.test.ts
tests/restate-foundation.test.ts
tests/restate-crash.test.ts
```

## Measurements

Record raw local synthetic samples plus min/median/max for:

- five endpoint cold starts;
- canonical commit latency under fixture reset;
- V4A/V4B/V4C recovery completion;
- cancellation confirmation and post-cancellation observation.

Runtime replay throughput is `NOT_APPLICABLE_NO_EVENT_REPLAY`; no event-sourced capability was approved. No production SLO is inferred.

## Privacy and scope

- Synthetic data only.
- Optional private bytes stay only in the deletable payload store.
- Approved Restate input contains semantic request fields and opaque `PayloadRef` only.
- Supported `sys_invocation`/`sys_journal`, application tables, worker logs, container logs, results, errors, and artifacts receive sentinel/derived-hash scans.
- PostgreSQL WAL, Restate physical storage media, backups, replicas, and physical restoration remain unproven boundaries.
- No LLM, memory system, inspector, identity portability, frontend, 3D, Unity, robotics, BCI, or consciousness claim belongs in Gate D.

## Stop decisions

```text
GATE_D_PASSES_FOUNDATION_V3
GATE_D_INCONCLUSIVE
GATE_D_REVISE
GATE_D_INCOMPLETE_AT_BOUND
```

All vectors and ten invariants must pass for foundation V3. A setup issue, intrinsic failure, deadline, or line breach is recorded honestly and does not authorize custom persistence.

## Contract preservation

The frozen fixtures, request hashes, projection digest, expected outcomes, canonical transaction, privacy boundary, role separation, and external-kill semantics are unchanged at start. Custom persistence remains parked regardless of Gate-D outcome unless a later dated mission decision explicitly changes that rule.
