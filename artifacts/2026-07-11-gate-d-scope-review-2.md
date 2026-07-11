# Gate D Scope Review 2 — Serializable Snapshot Barrier

**Recorded:** 2026-07-11T08:00:57Z
**Gate-D start:** 2026-07-11T07:12:49Z
**Hard deadline:** 2026-07-11T15:12:49Z
**Clock reset:** no
**Foundation promotion:** not claimed
**Production GREEN before this review:** none

## Trigger

The fresh review of Scope Review 1 was saved at:

```text
C:/Users/User/AppData/Local/hermes/profiles/dev/cache/delegation/subagent-summary-0-20260711_144820_062032.txt
```

It identified five blockers. Four were corrected in the final Scope-Review-1 document hashes before this review completed. One remained material: a handler-side pre-transaction barrier could not prove that two serializable PostgreSQL transactions had each observed case version 3 before release.

## Finding dispositions

### 1. Contradictory clock — corrected before Scope Review 2

The preflight now records:

```text
STARTED 2026-07-11T07:12:49Z
DEADLINE 2026-07-11T15:12:49Z
```

Task 1 is historically complete. It must not be rerun and the clock must not reset.

### 2. `src/domain/request.ts` absent from counted source — corrected before Scope Review 2

The counted production path explicitly includes:

```text
src/domain/canonical.ts
src/domain/request.ts
src/alternative/restate/**/*.ts
migrations/001_continuity.sql
```

The combined nonblank/noncomment cap remains 400 lines. The original 328-line baseline leaves 72 lines for every counted Gate-D production change, including the request schema and snapshot barrier.

### 3. Impossible two-invocation same-key barrier — corrected before Scope Review 2

Same-workflow-key V2A permits Restate to coalesce both submissions into one workflow invocation. The corrected evidence requires:

- two independent submitter child processes/connections;
- the first invocation blocked inside its serializable transaction;
- the second submission confirmed outstanding while the first remains blocked;
- both submissions may resolve to the same invocation ID;
- both obtain the same stored PostgreSQL receipt/outcome.

Two datasource transactions are required only for distinct workflow keys.

### 4. Pre-transaction barrier does not establish same-version snapshots — accepted; Scope Review 2 change

A handler barrier before `app.begin` cannot prove both transactions began from version 3. Opening a serializable transaction without executing a query also does not establish a snapshot.

Scope Review 2 replaces that design with the counted test-only `snapshot_barrier` branch inside the existing `continuity.commit_command` function body.

#### Barrier protocol

1. The parent test connection acquires an exclusive advisory lock identified by:

```sql
pg_catalog.hashtextextended('continuity-gate-d-snapshot-barrier', 0)
```

2. Under `CK_FAILPOINT=snapshot_barrier`, the Restate datasource transaction sets `continuity.test_failpoint='snapshot_barrier'` locally and calls the normal canonical function.
3. Before the existing command-ID advisory lock, receipt lookup, grant/case row locks, or state mutation, the function branch performs a non-locking read of the target case version in the current serializable transaction. This placement is required so distinct-workflow-key V2A transactions sharing one command ID can both establish snapshots before command-level serialization.
4. The branch requires the observed version to equal the request's declared expected version (`3` for the frozen vectors).
5. It then calls `pg_catalog.pg_advisory_xact_lock_shared` with the same key.
6. The parent's exclusive lock blocks shared waiters. A waiter visible in `pg_stat_activity` therefore proves that transaction already established a snapshot and observed version 3.
7. Same-key V2A requires exactly one waiting datasource transaction. Distinct-key V2A and V3 require two distinct waiting datasource backends/transactions.
8. The parent verifies canonical state remains version 3 and submitters remain outstanding.
9. The parent releases the exclusive advisory lock in `finally`.
10. Both transaction waiters hold compatible shared locks and proceed concurrently. The barrier therefore does not serialize the two candidate transactions.
11. Normal function locking and PostgreSQL serializable behavior decide the outcome. V3 requires one commit, one `40001` retry, then typed `EXPECTED_VERSION_CONFLICT`.

Exclusive transaction advisory locks, queues, runtime concurrency-one settings, or a barrier before snapshot establishment cannot pass.

#### Why the existing function must change

`continuity_app` is intentionally denied direct table reads. Endpoint code cannot establish the required case-version snapshot without bypassing the security boundary. A minimal test-only branch inside the existing SECURITY DEFINER function is therefore the narrowest honest proof.

This edits the existing migration's function body; it is not a new migration or database schema change.

### 5. Raw `ZodError` RED conflicts with fixed error contract — corrected before Scope Review 2

Before production GREEN, the first RED test must be strengthened to expect fixed local code `INVALID_REQUEST_SCHEMA`, prove the error excludes the sentinel and schema issue values/paths, and retain all zero-invocation/zero-receipt/prior-state assertions. The strengthened test must be rerun and remain decisively RED before production changes.

## Authorized changes

Scope Review 2 authorizes only:

- the counted `snapshot_barrier` branch inside the existing `continuity.commit_command` function body;
- endpoint code that sets that failpoint locally for the designated test environment;
- test harness code that acquires/releases the parent lock, verifies waiting backends, and drives independent submitter children;
- synchronized documentation and evidence artifacts;
- the previously authorized Scope-Review-1 request/technical-envelope validation.

## Explicitly not authorized

- no table, column, index, role, ACL, or ownership change;
- no semantic request field or frozen request-hash change;
- no new dependency or package pin;
- no new migration file;
- no queue or concurrency-one setting;
- no custom persistence, event replay, memory, LLM, UI, or portability work;
- no weakened vector, invariant, privacy assertion, timeout, line cap, or deadline;
- no production logic hidden in tests;
- no rerun of Task 1 or clock reset.

## TDD continuation

Before any production GREEN:

1. update only the established undeclared-payload RED error assertion to the fixed application error code/type required by Scope Reviews 1 and 2;
2. retain zero Restate invocation, zero receipt/history, prior canonical state, and sentinel non-disclosure assertions;
3. rerun the focused test and preserve the decisive RED;
4. obtain one final fresh adversarial review of the synchronized Scope-Review-2 documents;
5. only after `EXECUTION_READY`, implement the smallest counted GREEN.

The snapshot-barrier branch itself also requires a focused RED that proves the old pre-transaction harness cannot demonstrate two established snapshots before its production implementation.

## Superseding document hashes

```text
docs/architecture/gate-d-preflight.md
SHA-256 b0ce5c59f38753d5432014b2c756db0fb3e10d4e065fb8cfb39ccfac5ff7a005

docs/plans/2026-07-11-gate-d-implementation-plan.md
SHA-256 3b3e40032ee724b8fbb62227b7f67a9295a7504195867a0b59c9b2317921f37c
```

These hashes supersede Scope Review 1 for execution. Scope Review 1 and the start artifact remain historical evidence.

## Decision

```text
SCOPE_REVIEW_2_REQUIRES_FINAL_FRESH_PASS
PRODUCTION_GREEN_PAUSED
CLOCK_CONTINUES_WITHOUT_RESET
FOUNDATION_V3_NOT_CLAIMED
CUSTOM_PERSISTENCE_REMAINS_PARKED
```
