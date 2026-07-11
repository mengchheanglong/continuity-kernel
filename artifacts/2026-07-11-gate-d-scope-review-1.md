# Gate D Scope Review 1 — Adversarial Plan Correction

**Recorded:** 2026-07-11T07:37:43Z
**Gate-D start:** 2026-07-11T07:12:49Z
**Hard deadline:** 2026-07-11T15:12:49Z
**Original planning commit:** `b20d337556a3372d43983adeab449a59c0f6f8aa`
**Start commit:** `a3862ddf74ae3b9f8d4fddc83c2405f8cb0b4b53`
**Status:** production GREEN paused pending fresh adversarial review

## Why this review exists

A blocking fresh-context review completed after Gate D had started and found material omissions in the original preflight/implementation plan. The review did not invalidate the already-observed RED for undeclared private payload bytes, but it showed that passing only the original plan could not honestly prove all six vectors and ten invariants.

The Gate-D clock continues without reset. This artifact narrows and strengthens evidence requirements before production implementation. It does not weaken a frozen vector, modify the semantic request/hash, or authorize custom persistence.

## State at pause

```text
Production source changes: none
Migration changes: none
Dependency/lockfile changes: none
RED executable changes: package.json + tests/restate-foundation.test.ts
Focused undeclared-payload RED: independently reproduced
Foundation promotion: not claimed
Custom persistence: parked
```

Decisive RED behavior:

```text
local validation error: absent
Restate invocation count: 1 (required 0)
PostgreSQL receipt/history: 1/1 (required 0/0)
case state: version 4 resolved (required version 3 open)
```

## Finding dispositions

### 1. Causal traceability and time semantics — ACCEPTED

The original plan omitted explicit proof for Invariants 8 and 9.

Gate D remains within the existing canonical schema by freezing the following root-command mapping:

```text
causation = durable (command_id, request_hash)
correlation = durable (namespace_id, case_id)
```

Tests must additionally assert actor, authorization grant/version, validator version, canonical position, and resulting record. This proves root-command causation only; no parent-command/event chain is claimed.

Time mapping:

```text
semantic world time = request.worldTime, included in the frozen request hash
ingestion time = PostgreSQL ingestion_time, sampled from wall clock inside the canonical commit
operational wall clock = non-authoritative process/test clock; never part of request hash or projection digest
```

Tests must prove the distinctions and that operational delay cannot redefine canonical hashes/digests. No database migration is required for this bounded root-command foundation claim. If tests falsify this mapping, stop with another scope review or `GATE_D_REVISE`.

### 2. Unsupported V5 version dimensions — ACCEPTED

The original plan incorrectly treated static pins as sufficient for serializer/runtime compatibility and omitted domain/authorization-model mismatch tests.

Gate D now requires a strict technical `CommitInput` envelope outside the unchanged semantic request hash:

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

Every unsupported dimension must fail explicitly with fixed data-free local/terminal codes. The handler passes validated validator/projection versions to the existing canonical function; direct PostgreSQL tests retain their own closed-failure proof. No technical field enters the semantic request or changes the exact frozen request hash.

### 3. V2/V3 concurrency strength — ACCEPTED

Two promises from one process are insufficient. V2A and V3 now require:

- two independent direct submitter child processes/connections;
- deterministic endpoint `before_transaction` phase signals;
- proof both invocations reached the barrier while canonical state remained version 3;
- simultaneous release;
- same and distinct workflow-key V2A cases;
- distinct workflow-key V3 one-winner conflict;
- no queue/concurrency-one configuration.

Only test harness files may implement submitter orchestration. Required production barrier handling must remain test-only and within the 400-line cap.

### 4. Runtime schema/canonicalization boundary — PARTIALLY ACCEPTED

The review's UTC-offset observation was stale: the committed plan already used `z.iso.datetime()`, which is Z-only by default. A focused non-UTC-offset negative test is still required.

Accepted corrections:

- validate the strict complete technical wrapper and strict semantic request;
- run I-JSON/canonical validation before approved submission and independently in the handler;
- translate schema, canonicalization, and compatibility failures to fixed data-free outcomes;
- parameterize object-boundary tests for extra properties, lone surrogates, non-finite values, negative zero, unsafe numbers, `undefined`, non-UTC offsets, and unsupported versions.

Duplicate JSON keys cannot exist in an already parsed object. The existing duplicate-key-aware `parseCanonicalJson` is therefore the authoritative raw-JSON ingestion boundary; its frozen test remains in the aggregate. Gate D will not invent a second raw parser solely for Restate.

### 5. Privilege assertions — ACCEPTED

Gate D must add explicit catalog/negative evidence that:

- canonical schema/tables/function remain owned by `continuity_owner`;
- `continuity_app` has no ownership or owner-role membership;
- `PUBLIC` cannot execute the canonical commit function;
- `continuity_app` cannot directly read/write/truncate canonical tables or escalate role;
- `continuity_app` retains only schema usage and approved commit-function execution needed by the surviving path.

These assertions map directly to Invariants 3 and 4.

### 6. Cancellation quiescence — ACCEPTED

Before cancellation reconciliation/restart, the test must observe:

1. direct endpoint child exit;
2. PostgreSQL datasource-backend disappearance within 45 seconds;
3. documented public cancel acknowledgement (`200` or `202`);
4. cancellation-specific terminal state through supported introspection within ten seconds;
5. prior receipt/state reconciliation;
6. restart without failpoint;
7. full five-second no-late-commit observation.

A generic terminal/completed status cannot substitute for cancellation-specific evidence.

### 7. Sentinel source scan — ACCEPTED

The sentinel is intentionally declared in the frozen vector and synthetic tests. Final scans must allowlist only those declarations. Zero matches remain mandatory in:

- production source;
- approved runtime inputs, results, and errors;
- supported Restate journal/metadata surfaces;
- worker/Restate logs;
- logical application storage outside the deletable payload store;
- exported evidence/measurement artifacts.

## Amended document hashes

```text
docs/architecture/gate-d-preflight.md
SHA-256 0f1b6e5f3fa593a22aa22474cec000a947c397a695654d8004bee4110eb6df1a

docs/plans/2026-07-11-gate-d-implementation-plan.md
SHA-256 e8e318c4f18d6822d01e92a208ded5dc9e0f075c5f7be8ae78ec5a054f28db7f
```

These hashes supersede the original planning hashes for post-review execution. The start artifact remains historically correct for the original preflight and clock.

## Authorized changes

Scope Review 1 authorizes only:

- the strict technical compatibility envelope in counted Restate/domain source;
- fixed data-free validation/version failures;
- passing validated validator/projection versions to the existing canonical function;
- test-only independent submitter/barrier/cancellation harness work;
- explicit privilege, causal, time, malformed-input, version, and privacy evidence.

## Not authorized

- changing any frozen semantic request field, exact request hash, projection fixture/digest, or expected outcome;
- a database/table/column/function-signature migration;
- a new dependency, runtime database, queue, journal, event store, projector, or custom persistence;
- weakening V2/V3 concurrency, V5 version failures, V6 privacy, or cancellation evidence;
- resetting/extending the Gate-D clock;
- foundation promotion before the amended aggregate passes.

## Stop condition before GREEN

A fresh-context reviewer must inspect the amended preflight, implementation plan, and this scope review. Production GREEN resumes only if no material blocker remains. A remaining blocker triggers Scope Review 2 or an honest `GATE_D_REVISE`/`GATE_D_INCOMPLETE_AT_BOUND` decision.
