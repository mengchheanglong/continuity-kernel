# Gate D Scope Review 4 — Restate Cancellation Consumption

**Recorded:** 2026-07-11T13:22:19Z
**Gate-D start:** 2026-07-11T07:12:49Z
**Hard deadline:** 2026-07-11T15:12:49Z
**Clock reset:** no
**Foundation promotion:** not claimed
**Baseline before V3:** `4ddc67a0458bc857b7e256477bc4154565dbbb81`

## Trigger

The unchanged V3 cancellation procedure failed twice with fresh invocation IDs:

```text
kill endpoint and wait for datasource quiescence
PATCH /invocations/{id}/cancel => 202
poll for cancellation-specific terminal state before endpoint restart
result: invocation remained backing-off and timed out
```

The unqueued V3 conflict vector passed. PostgreSQL remained at the synthetic prior state after each cancellation failure: version 3/open, zero receipts, and zero accepted history. No late commit occurred.

The failures identify a procedure/runtime mismatch rather than a weaker semantic outcome. Restate 1.7.2 appends a cancel signal for an already invoked workflow and returns `202`; a reachable endpoint must consume that signal before the invocation can become terminal.

The operator was shown the conflict and directed execution to continue. This review records the narrow amendment before any V3 checkpoint is accepted.

## Pinned Restate 1.7.2 evidence

Authoritative pinned source:

- `crates/admin/src/rest_api/invocations.rs`: an invoked cancellation maps `CancelInvocationResponse::Appended` to HTTP `202`;
- `crates/worker/src/partition/state_machine/lifecycle/cancel.rs`: an invoked/backing-off cancellation appends or forwards the cancel signal;
- `crates/types/src/errors.rs`: `ABORTED` is code `409`, and `CANCELED_INVOCATION_ERROR` uses code `ABORTED` with message `canceled`.

Observed supported public representations after the no-failpoint endpoint consumed the signal:

```text
sys_invocation.status = completed
sys_invocation.completion_result = failure
sys_invocation.completion_failure = [409] Cancelled

GET /restate/attach/{invocationId}
HTTP 409
{"code":409,"message":"Cancelled"}
```

A generic completed or failed status cannot pass. Both exact supported representations are required.

## Narrow amendment

The cancellation procedure is superseded only as follows:

```text
1. start retry_forever invocation and capture invocation ID
2. observe sanitized attempt IPC and more than five attempts
3. at five seconds, externally kill the endpoint
4. observe direct child exit and datasource-backend disappearance
5. PATCH the exact invocation ID with /cancel; accept only 200 or 202
6. restart and register the same endpoint without any failpoint
7. within ten seconds, require exact SQL [409] Cancelled and exact attach HTTP 409 body
8. only then reconcile PostgreSQL state/receipts/history
9. observe the same no-failpoint endpoint for five full seconds
10. prove no late transition, receipt, or accepted history
```

The restart moves before terminal confirmation solely because the pinned runtime requires an endpoint to consume the already appended cancel signal. Reconciliation still occurs only after endpoint/backend quiescence and cancellation-specific confirmation.

## Unchanged requirements

- Five-second watchdog remains measured from submission.
- Endpoint kill remains external and direct.
- Datasource disappearance remains bounded at 45 seconds.
- Cancellation confirmation remains bounded at ten seconds after no-failpoint registration.
- Retry IPC remains exactly `{type,vector,count}` and contains no IDs, hashes, requests, payload references, payload bytes, or errors.
- Ordinary behavior retains the five-attempt terminal retry bound.
- V3 conflict still requires two exact attempt-1 snapshot waiters and an observed attempt-2 serialization retry.
- No queue, concurrency-one setting, schema, table, role, ACL, ownership, request, hash, dependency, private Restate storage, or custom persistence change is authorized.
- Production remains subject to the exact 400-line cap.
- Original start and hard deadline remain unchanged.

## Focused execution outcome

After the amendment:

```text
GateD-V3 returns one accepted and one expected-version conflict without a queue: PASS
GateD-V3 durably cancels retrying invocation and observes no late commit: PASS
focused V3: 2/2
```

The race test additionally observes sanitized `{type:"attempt",vector:"V3",count:2}` evidence after both attempt-1 transactions passed the non-locking version-3 read and waited on the exact shared advisory-lock tuple.

## Superseding hashes

```text
docs/architecture/gate-d-preflight.md
SHA-256 10e93aad1913950c7ba916a0b72c4f7f0c500e54db0be5def1d7401155111b52

docs/plans/2026-07-11-gate-d-implementation-plan.md
SHA-256 152dac588ab0b406a109b073cdb735f35580daf5d6d617d137b99ae829b1f797
```

These hashes and this record supersede only the Task-6 cancellation sequence and representation text. Scope Reviews 1–3 remain authoritative for all other Gate-D execution rules.

## Decision

```text
SCOPE_REVIEW_4_EXECUTION_CONTINUES
V3_CANCELLATION_PROCEDURE_AMENDED_FOR_PINNED_RUNTIME_SEMANTICS
FROZEN_CANCELLATION_OUTCOME_RETAINED
CLOCK_CONTINUES_WITHOUT_RESET
FOUNDATION_V3_NOT_CLAIMED
CUSTOM_PERSISTENCE_REMAINS_PARKED
```
