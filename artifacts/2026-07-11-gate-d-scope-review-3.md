# Gate D Scope Review 3 — Retry-Safe Exact Barrier Proof

**Recorded:** 2026-07-11T08:13:32Z
**Gate-D start:** 2026-07-11T07:12:49Z
**Hard deadline:** 2026-07-11T15:12:49Z
**Clock reset:** no
**Foundation promotion:** not claimed
**Production GREEN before this review:** none

## Trigger

The final fresh review of Scope Review 2 returned two material blockers:

1. applying `snapshot_barrier` on every serializable attempt would make a retry observe version 4 and fail before returning the required V2A stored receipt or V3 `EXPECTED_VERSION_CONFLICT`;
2. generic `pg_stat_activity` lock-wait counts could mistake the existing command-ID advisory lock for the intended snapshot barrier.

Both findings are accepted without weakening any frozen vector or invariant.

## Correction 1 — Barrier only on attempt 1

The Restate datasource loop already numbers serializable attempts. Under `CK_FAILPOINT=snapshot_barrier`:

- only attempt 1 sets local PostgreSQL configuration `continuity.test_failpoint='snapshot_barrier'` before calling the canonical function;
- every retry calls the normal canonical function without that setting;
- transaction-local configuration ends automatically with the failed/committed transaction;
- V2A's losing first attempt may retry and read the stored receipt;
- V3's losing first attempt may retry against version 4 and return typed `EXPECTED_VERSION_CONFLICT`.

The existing `retry_forever` cancellation failpoint remains separate and intentionally applies on every attempt. The two failpoints must not be conflated.

## Correction 2 — Exact advisory-lock identity

The parent must use a dedicated database session:

1. record the parent's PostgreSQL PID;
2. acquire a granted `ExclusiveLock` for `hashtextextended('continuity-gate-d-snapshot-barrier',0)`;
3. keep that session pinned until cleanup.

The `snapshot_barrier` function branch must execute on attempt 1 before the existing command-ID advisory lock and receipt lookup. It performs the non-locking expected-version read and then requests `pg_advisory_xact_lock_shared` on the same key.

A separate observer must query `pg_locks` and:

- locate the parent's granted advisory `ExclusiveLock` by known PID;
- capture its exact identity tuple `(database,classid,objid,objsubid)`;
- require each expected child as a distinct PID;
- require each child row to use `mode='ShareLock'` and `granted=false`;
- require each child row to match the parent's exact advisory identity tuple.

Generic datasource counts, `pg_stat_activity` lock waits, or any waiter on the command-ID advisory lock cannot pass.

Same-key V2A requires one exact snapshot-barrier waiter while two independent submissions remain outstanding and may share one invocation ID. Distinct-key V2A and V3 require two exact snapshot-barrier waiters.

The parent releases its exclusive lock in `finally`. The child `ShareLock` requests are mutually compatible, so after parent release they proceed concurrently rather than queue behind each other.

## Scope remains narrow

Authorized:

- attempt-1 selection in the existing Restate serializable loop;
- exact `pg_locks` observer and dedicated parent lock session in tests;
- previously authorized counted `snapshot_barrier` branch before command locking/receipt lookup;
- synchronized documentation and evidence.

Not authorized:

- any table, column, index, role, ACL, ownership, semantic request, or request-hash change;
- any new dependency or migration file;
- queues, concurrency-one, exclusive child transaction barriers, or caller-only concurrency claims;
- custom persistence, replay, memory, LLM, UI, or portability work;
- clock reset or Task-1 rerun;
- weakened tests, timeouts, privacy scans, or line cap.

## Required implementation assertions

```text
snapshot failpoint configured only when attempt === 1
parent PID and granted ExclusiveLock captured
child PIDs distinct where two transactions are required
child lock mode exactly ShareLock
child granted exactly false before release
child advisory identity tuple exactly equals parent tuple
barrier branch placed before command-ID lock and receipt lookup
parent lock released in finally
retry bypasses snapshot barrier
V2A retry returns stored receipt
V3 retry returns EXPECTED_VERSION_CONFLICT
```

## Superseding hashes

```text
docs/architecture/gate-d-preflight.md
SHA-256 085f8137e21d8c4ec9bbd244008ac197d51127faa33d609500f5570b3e904854

docs/plans/2026-07-11-gate-d-implementation-plan.md
SHA-256 0292287ae07dafb66c66774864c997bcc3582f3fc0c9f0e51dd287c8adf54b8c
```

These hashes supersede Scope Reviews 1–2 for execution. Earlier artifacts remain historical evidence.

## Focused micro-review outcome

```text
2026-07-11T08:19:38Z
delegation: deleg_31886758
verdict: EXECUTION_READY
```

The micro-review checked only the two Scope-Review-3 corrections and found no remaining material blocker. The reviewed preflight and plan hashes above remain unchanged.

## Decision

```text
SCOPE_REVIEW_3_EXECUTION_READY
PRODUCTION_GREEN_AUTHORIZED_WITHIN_REVIEWED_SCOPE
CLOCK_CONTINUES_WITHOUT_RESET
FOUNDATION_V3_NOT_CLAIMED
CUSTOM_PERSISTENCE_REMAINS_PARKED
```
