# Gate D Preflight — Restate/PostgreSQL Foundation Integrity

**Recorded:** 2026-07-11T07:02:18Z  
**Status:** execution active; amended by Scope Reviews 1–4 before foundation decision
**Baseline:** `4e43d892e0aa4459e6dfe44cf02c5377cf75116f`  
**Prior decision:** `RESTATE_PASSES_V4`  
**Evidence:** `artifacts/2026-07-11-t2b-final.md`

## Decision context

T2 rejected DBOS 4.23.6 for the frozen pre-commit recovery boundary. T2b then established that pinned Restate Server 1.7.2 with TypeScript SDK/client 1.15.1 passes unchanged V4A/V4B/V4C while PostgreSQL receipts remain canonical.

Gate D is not another candidate comparison. It completes the surviving Restate/PostgreSQL foundation by running all six frozen vectors and all mandatory supporting assertions against one explicitly layered design.

Scope Review 1 (`artifacts/2026-07-11-gate-d-scope-review-1.md`) supersedes incomplete evidence mappings in the original planning commit. Scope Review 2 (`artifacts/2026-07-11-gate-d-scope-review-2.md`) supersedes the pre-transaction concurrency barrier with an internal serializable-snapshot barrier. Scope Review 3 (`artifacts/2026-07-11-gate-d-scope-review-3.md`) restricts that barrier to attempt 1 and requires exact `pg_locks` identity proof. Scope Review 4 (`artifacts/2026-07-11-gate-d-scope-review-4.md`) records the observed Restate 1.7.2 cancel-signal semantics and moves no-failpoint endpoint recovery before cancellation confirmation, while retaining quiescence, exact cancellation evidence, reconciliation, and the five-second no-late-effect window. The original start time and deadline remain unchanged. Task 1 is historically complete and must not be rerun; the clock must not reset.

```text
SURVIVING DIRECTION: Restate 1.7.2 + SDK/client 1.15.1 + canonical PostgreSQL
CUSTOM PERSISTENCE: PARKED
FOUNDATION PROMOTION: NOT YET CLAIMED
GATE D CLOCK: STARTED 2026-07-11T07:12:49Z; DEADLINE 2026-07-11T15:12:49Z
```

## Objective

Prove or falsify that the surviving direction satisfies all ten foundation invariants without weakening `docs/conformance-vectors.md`, using:

- Restate public ingress, attach, Admin management, deployment, and SQL-introspection APIs for runtime claims;
- the existing canonical PostgreSQL transaction and receipt for semantic authority;
- the existing direct database/canonical tests for transaction-internal, privilege, and serialization properties;
- external child-process kills for recovery evidence;
- synthetic data only.

Gate D passes only when one aggregate command demonstrates all six headline vectors plus mandatory supporting assertions and the dated artifact records limitations and measurements honestly.

## Frozen versions and topology

| Item | Frozen value |
|---|---|
| Node.js | `24.14.0` minimum; exact runtime recorded in start/final artifacts |
| pnpm | `10.32.1` |
| Restate Server | `1.7.2` |
| Restate image, Linux/AMD64 | `sha256:9c9b8dc71581c02ce1d85dd9928ed2728b92a5a43499880c86a1fa8b01fab86a` |
| Restate TypeScript SDK/client | `1.15.1` / `1.15.1` |
| PostgreSQL image, Linux/AMD64 | `sha256:0c49c0c906cb405ea65e70c284570fee91c7750ca9336369afc0edf4fce211db` |
| Runtime endpoint process | one direct Node child, native IPC, no shell wrapper |
| Canonical database | existing `continuity_app_db` |
| Runtime role | existing `continuity_app`, no canonical-table DML/ownership |
| Canonical write | existing `continuity.commit_command` security-definer function |
| Canonical authority | PostgreSQL request-hash receipt and state/history transaction |
| Restate embedded state | not used for canonical state |
| Custom persistence | forbidden |

No new package, image, database, table, column, event store, journal, projector, snapshot, queue, LLM, model, memory system, identity adapter, or UI belongs in Gate D.

## Source hierarchy

1. `docs/conformance-vectors.md` — frozen outcomes and fixtures.
2. `docs/invariants.md` — ten promotion invariants.
3. `docs/threat-and-privacy-boundary.md` — privacy and non-claim limits.
4. `docs/architecture/t2b-preflight.md` — frozen Restate topology and V4 semantics.
5. `artifacts/2026-07-11-t2b-final.md` — surviving-direction evidence.
6. This preflight — Gate-D execution bounds and mapping.
7. `docs/plans/2026-07-11-gate-d-implementation-plan.md` — task order.

If these conflict, stop before implementation. Do not edit a frozen expected outcome to make a test pass.

## Layered evidence rule

Not every transaction-internal property must be forced through Restate when the public runtime cannot expose a deterministic barrier without changing canonical SQL. Gate D uses the narrowest authoritative layer:

- **Restate end to end:** runtime submission, attachment, workflow-key semantics, process restart, cancellation, supported purge, durable journal/privacy, and external-kill recovery.
- **Canonical PostgreSQL integration:** grant/case lock ordering, transaction rollback, object ownership/function privileges, cross-namespace receipts, unsupported validator/projection versions, and exact state/history/audit records.
- **Pure canonicalization/raw ingestion:** RFC 8785/I-JSON adversarial vectors, duplicate-key-aware `parseCanonicalJson`, and frozen hashes.

A direct PostgreSQL test cannot prove a Restate durability claim. A Restate workflow key cannot prove semantic request equality. Passing requires the combined surviving-direction aggregate.

## Gate-D vector matrix

| Vector | Required surviving-direction evidence | Planned test surface |
|---|---|---|
| V1A out-of-scope | Restate submission returns typed authorization rejection; no accepted state/history; privacy-limited audit exists | `tests/restate-foundation.test.ts` + database probes |
| V1B revocation-first | version-8 revocation commits first; Restate returns revoked/version conflict; prior state remains | Restate foundation test using existing `revokeGrant` |
| V1C command-first | canonical command locks/checks first, one commit, revocation waits then reaches version 8 | existing deterministic `tests/database.test.ts` barrier |
| V2A same ID/hash | two independent submitter processes/connections overlap; same-key case may coalesce to one Restate invocation waiting inside transaction attempt 1, while distinct-key case proves two version-3 snapshots through two exact ungranted `ShareLock` waiters on the parent's known snapshot-barrier advisory-lock identity; retries run without the barrier and both cases return one stored receipt/transition | Restate foundation test + test-only submitter children + attempt-1 `snapshot_barrier` function branch |
| V2B different hash | caller boundary and PostgreSQL receipt both reject; survives endpoint restart, new workflow key, and supported completed-invocation purge | Restate foundation test; `PATCH /invocations/{id}/purge` only after completion |
| V3 conflict | two independent submitter processes/connections and distinct workflow keys each establish an attempt-1 serializable snapshot that observes version 3, then appear as exact ungranted `ShareLock` waiters on the parent's known snapshot-barrier advisory-lock identity before concurrent release; retries run normally without the barrier; no queue/concurrency-one; one accepted and one expected-version conflict | Restate foundation test + test-only submitter children + attempt-1 `snapshot_barrier` function branch |
| V3 watchdog/cancel | forced `40001` retries observed without payload data; parent kills endpoint at five seconds, observes child exit and datasource-backend disappearance, calls `PATCH /invocations/{id}/cancel`, confirms cancellation-specific terminal state and no late commit after restart | Restate foundation/worker test; existing SQL `retry_forever` failpoint |
| V4A/V4B/V4C | unchanged external-kill and recovery behavior | existing `tests/restate-crash.test.ts` |
| V5 digest/version | exact frozen digest after restart; strict object boundary and raw-JSON ingestion fail closed; unsupported domain, request-hash, authorization-model, validator/rule, projection, serializer, and runtime-application versions fail explicitly | Restate foundation + existing canonical/database tests |
| V6 erasure | opaque `PayloadRef` only; required state/history survives deletion; sentinel and SHA-256 derivatives absent from logical application data, Restate journal/metadata/errors, and logs | Restate foundation/crash + database scans + supported Admin SQL |

## Invariant coverage matrix

| Invariant | Required Gate-D evidence |
|---|---|
| 1. Scoped stable identifiers | V2 receipts plus explicit cross-namespace same-command-ID independence; V5 stable projection IDs |
| 2. Single canonical case state | V3 one-winner conflict, V4 recovery, and V5 exact position/digest |
| 3. Authorization and scope | V1A/V1B through Restate, V1C transaction barrier, and runtime-role privilege negatives |
| 4. Single canonical commit path | privilege/ownership/public-execution negatives, V3 atomicity, and V4 external-kill evidence |
| 5. Minimum auditable history | V1 privacy-limited rejection audit, V4 receipt/history counts, and V6 erasure with required history intact |
| 6. Atomicity, concurrency, and conflict-aware idempotency | V2 receipt equality/mismatch, V3 one-winner race, transaction rollback, and V4 exactly-once canonical outcome |
| 7. Recovery equivalence | V4A/V4B/V4C, V5 restart digest, and V3 durable-cancellation/no-late-commit distinction |
| 8. Causal traceability | for root commands, causation is the durable `(command_id, request_hash)` pair and correlation is durable `(namespace_id, case_id)`; tests also assert actor, grant/version, validator, position, and resulting record |
| 9. Explicit time and external inputs | hashed semantic `worldTime`; PostgreSQL `ingestion_time` as the canonical commit's wall-clock sample; operational wall clock is non-authoritative and cannot change request hash/projection digest; no randomness/model input |
| 10. Versioned authority and adapters | strict technical `CommitInput` compatibility envelope plus explicit closed failures for domain, request-hash, authorization-model, validator/rule, projection, serializer, and runtime-application versions |

### Mandatory supporting assertions

The aggregate must also retain or add explicit evidence for:

- all-or-none rollback;
- catalog proof that canonical objects remain owned by `continuity_owner`, `continuity_app` has no ownership/owner-role membership, `PUBLIC` has no commit-function execution, and runtime-role DML/truncate/role escalation/unauthorized reads fail;
- cross-namespace command-ID independence;
- supported runtime-history purge cannot bypass PostgreSQL receipts;
- independent submitter processes/connections and deterministic same-version barriers for V2A/V3;
- strict complete `CommitInput` plus semantic request validation; malformed, extra-property, unsupported-schema/version, lone-surrogate, non-finite, negative-zero, unsafe-number, and `undefined` object inputs fail closed through the approved caller/handler boundary; duplicate-key raw JSON fails through `parseCanonicalJson` before object submission;
- cancellation is durable and no commit appears during the five-second post-restart window;
- all fixtures remain synthetic and contain no real personal, biometric, medical, or neural data;
- no Restate internal table/file/protocol or embedded state is used.

## Public Restate management surfaces

Only documented public interfaces are permitted:

```text
POST  /deployments
POST  /query
PATCH /invocations/{invocationId}/cancel
PATCH /invocations/{invocationId}/purge
GET   /restate/attach/{invocationId}
POST  /restate/send/ContinuityCommitT2bV1/{workflowId}/run
```

The purge assertion may run only on a completed invocation. It must independently verify that Restate journal/metadata are gone through supported introspection and that a fresh workflow key with the same command still receives PostgreSQL's stored receipt. No runtime volume, RocksDB, WAL, filesystem, or private API may be read or modified.

## Runtime-schema and privacy boundary

The approved caller/server boundary must validate a strict complete `CommitInput` before `workflowSubmit` so undeclared optional bytes cannot enter Restate through that path. The workflow handler must independently validate direct/tampered input and fail terminally before PostgreSQL.

The technical envelope is outside the frozen semantic request hash and contains exactly:

```text
domainSchemaVersion=1
authorizationModelVersion=1
validatorVersion=1
projectionSchemaVersion=1
serializerVersion=rfc8785-sha256-base64url-nopad-v1
runtimeApplicationVersion=continuity-kernel-restate-gate-d-v1
commandId=<opaque command ID>
request=<unchanged frozen semantic request>
```

Unsupported technical versions fail with fixed data-free local/terminal codes. The approved object boundary runs strict schema plus I-JSON/canonical validation before submission. `parseCanonicalJson` is the raw-JSON ingestion boundary and remains responsible for duplicate-key detection before an object can reach Restate. No technical envelope field is added to the semantic request or frozen request hash.

This does not claim Restate can erase bytes that an unauthorized caller directly submits to ingress before application validation; such direct ingress is outside the approved boundary and remains an explicit operational access-control concern. Gate D proves that the approved boundary sends only the synthetic semantic request and opaque `PayloadRef`.

Optional payload bytes and plaintext-derived hashes must be absent from:

- approved Restate request input;
- `sys_invocation` metadata, status, and failures;
- `sys_journal.raw` and JSON projections;
- worker stdout/stderr;
- Restate container logs;
- logical PostgreSQL text/JSON columns outside the deletable payload store;
- returned results and evidence exports.

Backup media, PostgreSQL WAL, Restate internal storage media, replicas, and physical restoration remain unproven and must be named as boundaries.

## Bounds

| Bound | Frozen value |
|---|---:|
| Gate-D implementation maximum | 8 hours |
| Current combined surviving-direction lines | 328 |
| Combined surviving-direction cap | 400 nonblank, noncomment TypeScript/SQL lines |
| Maximum additional counted production lines | 72 |
| Endpoint/service readiness | 30 seconds |
| PostgreSQL backend disappearance | 45 seconds on Windows/Docker Desktop |
| Recovery completion after release | 30 seconds |
| Cancellation confirmation | 10 seconds |
| Post-cancellation observation | 5 seconds |
| Per-test hard maximum | 120 seconds |

Counted production path:

```text
src/domain/canonical.ts
src/domain/request.ts
src/alternative/restate/**/*.ts
migrations/001_continuity.sql
```

Tests, generated files, package/lockfiles, Compose, documentation, artifacts, and measurement scripts are excluded. Record each file and the exact total. No required production code may be hidden in tests to fit the cap.

No dependency or new migration is expected. Scope Review 1 authorizes the strict technical compatibility envelope and stronger tests. Scope Reviews 2–3 additionally authorize only a counted test-only `snapshot_barrier` branch at the start of the existing `continuity.commit_command` function body, before its command-ID advisory lock and receipt lookup, plus harness code: only transaction attempt 1 performs the non-locking expected-version check and `pg_advisory_xact_lock_shared`; retries run without that failpoint. The parent uses a dedicated known PID/exclusive lock, and the observer must match each child PID as an ungranted `ShareLock` on the identical `pg_locks` advisory tuple, not generic activity. This does not authorize a table/column/index/role/ACL schema change, semantic request/hash change, dependency, queue, concurrency-one setting, or custom persistence. Any further need requires another dated stop review.

## Clock/start procedure

Planning, official documentation lookup, and this preflight do not start the Gate-D clock.

Immediately before the first Gate-D service/image start, deployment registration, executable probe/test, source, script, package, Compose, or migration change:

1. verify `main` is clean and local equals `origin/main`;
2. create `artifacts/2026-07-11-gate-d-start.md`;
3. record UTC start and eight-hour deadline;
4. record baseline commit, this preflight's SHA-256, exact package/image pins, host tool versions, counted paths, and current 328-line baseline;
5. state that all frozen outcomes remain unchanged and custom persistence remains parked;
6. commit and push the start artifact;
7. only then begin RED.

## TDD and execution order

Every missing assertion follows RED → GREEN → REFACTOR:

1. add one named failing test without changing frozen fixtures;
2. run only that test and retain the expected failure;
3. make the smallest production or test-harness change allowed by the current dated scope review;
4. rerun the focused test;
5. run the Gate-D aggregate;
6. commit a verified slice.

Configuration/start artifacts are allowed before RED. Production code may not precede the failing test that requires it.

## Aggregate and metrics

Add one script:

```text
pnpm run test:gate-d
```

It must run only the surviving direction:

```text
tests/canonical.test.ts
tests/database.test.ts
tests/restate-foundation.test.ts
tests/restate-crash.test.ts
```

Rejected DBOS tests remain in the repository as historical evidence but are not part of the surviving-direction pass/fail aggregate.

Report measurements without inventing production SLOs:

- five endpoint cold-start-to-ready samples;
- canonical commit latency samples under fixture reset;
- V4A/V4B/V4C recovery completion durations;
- cancellation confirmation and post-cancellation observation;
- runtime replay throughput as `NOT APPLICABLE` because no event replay capability was approved or implemented.

Record raw samples plus min/median/max. These are local synthetic benchmark observations, not production guarantees.

## Stop and decision rules

### All six vectors and ten invariants pass

```text
GATE_D_PASSES_FOUNDATION_V3
CUSTOM PERSISTENCE REMAINS PARKED
```

Promote only the foundation to V3. Stop for mission review before T4. Do not begin an LLM, memory system, inspector, portability, or environment.

### Setup or harness failure

```text
GATE_D_INCONCLUSIVE
```

Fix only within the frozen clock. Setup friction is not an intrinsic architecture failure and does not authorize custom persistence.

### Intrinsic surviving-direction failure

```text
GATE_D_REVISE
```

Require the unchanged assertion to fail twice with fresh IDs and independent canonical/runtime evidence. Record the exact missing capability. Do not silently switch candidates or build custom persistence.

### Deadline or line-bound breach

```text
GATE_D_INCOMPLETE_AT_BOUND
```

Stop immediately and record incomplete work. Do not reset the clock, exclude required source, weaken tests, or move production logic into the harness.

## Official interface anchors

- Restate 1.7.2 pinned source: `crates/admin/src/rest_api/invocations.rs` defines `/invocations/{invocation_id}/purge`; `cli/src/clients/admin_interface.rs` constructs the same versioned route.
- Restate invocation management: <https://docs.restate.dev/services/invocation/managing-invocations>
- Restate HTTP invocation, attach, lookup, and cancellation: <https://docs.restate.dev/operate/invocation>
- Restate SQL introspection: <https://docs.restate.dev/operate/introspection>
- Restate TypeScript service communication: <https://docs.restate.dev/develop/ts/service-communication>

The pinned-tag source check is research-only and does not start the Gate-D implementation clock.

## Required final artifact

Write `artifacts/2026-07-11-gate-d-final.md` containing:

- start/deadline/decision timestamps and elapsed duration;
- baseline and final commits;
- exact pins, image digests, topology, and host routing workaround if still needed;
- vector/invariant coverage matrix;
- focused RED/GREEN commands and decisive output;
- final aggregate and static/direct database output;
- privacy and private-API scans;
- counted production lines;
- raw local measurements;
- failed/skipped checks and unproven boundaries;
- one frozen decision from the rules above.
