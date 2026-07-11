# Gate D Restate/PostgreSQL Implementation Plan

> **For Hermes:** Execute this plan task-by-task with TDD and independent verification. Use Codex only for bounded implementation slices; Hermes owns scope, test evidence, and commits.

**Goal:** Run all six frozen conformance vectors and all ten foundation invariants against the surviving Restate/PostgreSQL direction, then record one honest Gate-D decision.

**Architecture:** Restate provides durable invocation, attachment, cancellation, and recovery through public APIs. PostgreSQL remains the canonical semantic authority through the existing request-hash receipt and atomic commit function. Direct database and canonicalization tests remain authoritative for transaction-internal and pure-serialization properties; runtime-specific claims must execute through Restate.

**Tech Stack:** Node.js 24, TypeScript 6, Vitest 4, Restate Server 1.7.2, Restate SDK/client 1.15.1, PostgreSQL 18.4, `postgres` 3.4.9, Zod 4.4.3, Docker Compose.

**Authority:** `docs/architecture/gate-d-preflight.md`

**Scope amendments:** `artifacts/2026-07-11-gate-d-scope-review-1.md` corrects the original evidence map; `artifacts/2026-07-11-gate-d-scope-review-2.md` replaces the inadequate pre-transaction race barrier with the counted internal serializable-snapshot barrier; `artifacts/2026-07-11-gate-d-scope-review-3.md` limits that barrier to attempt 1 and requires exact advisory-lock identity proof. The original clock continues; Task 1 is complete and must not be rerun or reset. No semantic request/hash, table/column/index/role/ACL schema, dependency, queue, concurrency-one, or custom persistence change is authorized.

---

## Task 0: Freeze and publish Gate-D planning

**Objective:** Establish an immutable planning baseline before any executable Gate-D change.

**Files:**
- Create: `docs/architecture/gate-d-preflight.md`
- Create: `docs/plans/2026-07-11-gate-d-implementation-plan.md`
- Modify after the implementation repository's planning commit: sibling Mission Control `.active/` files

**Steps:**

1. Run `git diff --check`.
2. Confirm no frozen vector/invariant file changed.
3. Commit only the two planning documents.
4. Push `main` and verify local equals `origin/main`.
5. Synchronize Mission Control in a separate local research commit.

**Commit:**

```bash
git add docs/architecture/gate-d-preflight.md docs/plans/2026-07-11-gate-d-implementation-plan.md
git commit -m "docs: freeze Gate D execution plan"
git push origin main
```

## Task 1: Start the Gate-D clock — HISTORICALLY COMPLETE; DO NOT RERUN

**Objective:** Record a clean immutable start immediately before the first executable Gate-D change.

**Files:**
- Create: `artifacts/2026-07-11-gate-d-start.md`

**Steps:**

1. Verify clean `main` and local/remote equality.
2. Compute SHA-256 of `docs/architecture/gate-d-preflight.md` with `sha256sum`.
3. Record UTC start and `start + 8 hours` deadline.
4. Record exact package pins/integrities, image digests, Node/pnpm/Docker/Git versions, current 328-line baseline, counted paths, test names, timeouts, and stop rules.
5. State that frozen outcomes remain unchanged and custom persistence remains parked.
6. Commit and push the artifact before changing `package.json`, source, scripts, Compose, migrations, or executable tests.

**Verification:**

```bash
git show --stat --oneline HEAD
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

**Commit:** `docs: start Gate D foundation benchmark`

## Task 2: Establish RED for approved-boundary schema validation

**Objective:** Prove the current Restate caller/handler accepts malformed or undeclared input that the frozen contract requires it to reject.

**Files:**
- Create: `tests/restate-foundation.test.ts`
- Modify: `package.json`
- Reuse unchanged: `tests/restate-worker.ts`, `tests/db-fixture.ts`

**Tests to add:**

```text
GateD-V5 rejects undeclared optional payload bytes before workflow submission
GateD-V5 rejects malformed direct ingress input without a canonical transition
GateD-V5 rejects unsupported request-hash schema through Restate
```

The first test must:

1. create a unique workflow key;
2. call the approved `submitRestateCommand` boundary with a request containing an undeclared `privatePayload` sentinel;
3. expect typed local validation failure;
4. query `sys_invocation` by that workflow key and expect zero rows;
5. confirm zero canonical receipt/history and version 3.

The second may use direct ingress only to prove independent handler validation. It must not include the frozen private sentinel because Restate journals direct ingress before handler validation.

Add the aggregate script only after the test file exists:

```json
"test:gate-d": "vitest run tests/canonical.test.ts tests/database.test.ts tests/restate-foundation.test.ts tests/restate-crash.test.ts --no-file-parallelism --bail=1"
```

**RED command:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 \
  pnpm exec vitest run tests/restate-foundation.test.ts \
  --no-file-parallelism --bail=1 \
  -t 'GateD-V5 rejects undeclared optional payload bytes before workflow submission'
```

**Expected RED:** approved boundary submits or fails with an untyped downstream outcome; a Restate invocation exists when zero is required.

**Commit:** Do not commit RED alone unless needed as explicit evidence; retain command/output in the final artifact.

## Task 3: Implement strict semantic request and technical-envelope validation

**Objective:** Make malformed, undeclared, and compatibility-mismatched input fail closed before approved submission and independently before PostgreSQL in the handler, without changing the frozen semantic request/hash.

**Files:**
- Create: `src/domain/request.ts`
- Modify: `src/alternative/restate/client.ts`
- Modify: `src/alternative/restate/index.ts`
- Test: `tests/restate-foundation.test.ts`
- Modify: `tests/restate-crash.test.ts` only to construct the strict technical envelope; V4A/V4B/V4C failpoints, kill points, barriers, expected outcomes, and assertions remain unchanged

**Required shape:**

- one shared strict semantic request schema matching the frozen request exactly;
- one shared strict `CommitInput` schema containing `commandId`, unchanged `request`, and these technical pins outside the semantic hash:

```text
domainSchemaVersion=1
authorizationModelVersion=1
validatorVersion=1
projectionSchemaVersion=1
serializerVersion=rfc8785-sha256-base64url-nopad-v1
runtimeApplicationVersion=continuity-kernel-restate-gate-d-v1
```

Compatibility and validation failures must be distinguishable by these fixed data-free codes:

```text
INVALID_REQUEST_SCHEMA
INVALID_CANONICAL_REQUEST
UNSUPPORTED_DOMAIN_SCHEMA_VERSION
UNSUPPORTED_REQUEST_HASH_SCHEMA_VERSION
UNSUPPORTED_AUTHORIZATION_MODEL_VERSION
UNSUPPORTED_VALIDATOR_VERSION
UNSUPPORTED_PROJECTION_SCHEMA_VERSION
UNSUPPORTED_SERIALIZER_VERSION
UNSUPPORTED_RUNTIME_APPLICATION_VERSION
```

- IDs/payload reference are nonempty strings;
- decimal versions use `^(0|[1-9]\d*)$`;
- `commitmentDeadline` and `worldTime` use Z-only RFC 3339 UTC (`z.iso.datetime()` plus focused offset-negative tests);
- client validates the complete wrapper and canonicalizes the parsed semantic request before `workflowSubmit`;
- handler independently validates the complete wrapper and canonicalizes before `ctx.run`/PostgreSQL;
- schema failures, canonical/I-JSON failures, and every technical-version mismatch return fixed data-free local/terminal codes; no issue paths/values or input are logged;
- handler passes validated `validatorVersion` and `projectionSchemaVersion` to the canonical function instead of hardcoding hidden values;
- `parseCanonicalJson` remains the raw-JSON ingestion boundary for duplicate-key rejection; do not invent a second parser.

After the established undeclared-payload RED, refine only its error-type assertion from raw `ZodError` to the fixed local `INVALID_REQUEST_SCHEMA` error required by Scope Review 1, without changing its zero-invocation/zero-receipt/prior-state assertions. Rerun and retain the same decisive RED before production. Then turn it green and add each next malformed/version test one at a time, observing RED before GREEN:

```text
GateD-V5 rejects malformed direct ingress input without a canonical transition
GateD-V5 rejects unsupported domain schema version
GateD-V5 rejects unsupported request-hash schema version
GateD-V5 rejects unsupported authorization-model version
GateD-V5 rejects unsupported validator/rule version
GateD-V5 rejects unsupported projection version
GateD-V5 rejects unsupported serializer version
GateD-V5 rejects unsupported runtime-application version
GateD-V5 rejects non-UTC offset time, lone surrogate, non-finite, negative-zero, unsafe-number, and undefined object input
```

Retain the pure raw-ingestion duplicate-key test against `parseCanonicalJson` and exact frozen hashes.

**GREEN commands:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/restate-foundation.test.ts --no-file-parallelism --bail=1 -t 'GateD-V5'
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/restate-crash.test.ts --no-file-parallelism --bail=1
pnpm run typecheck
pnpm run lint
```

**Expected:** all added V5 boundary/version tests and unchanged V4 tests pass; combined counted source remains at or below 400.

**Commit:** `feat: validate Restate command boundary`

## Task 4: Port V1 authorization evidence

**Objective:** Verify runtime authorization outcomes while retaining the existing transaction-linearization proof.

**Files:**
- Modify: `tests/restate-foundation.test.ts`
- Reuse: `tests/database.test.ts`
- Reuse: `tests/db-fixture.ts`

**Tests:**

```text
GateD-V1A rejects an out-of-scope actor through Restate
GateD-V1B rejects after grant version 8 commits before Restate validation
```

For each test assert:

- typed code (`AUTHORIZATION_DENIED`, `AUTHORIZATION_REVOKED`, or `AUTHORIZATION_VERSION_CONFLICT` as frozen);
- case version 3 and prior digest/state;
- zero accepted history;
- no accepted canonical transition;
- one privacy-limited decision audit where required.

V1C remains the existing deterministic database barrier:

```text
commits command-first while revocation waits on its grant lock
```

Do not add queue serialization or runtime concurrency-one settings.

**Focused command:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/restate-foundation.test.ts --no-file-parallelism --bail=1 -t 'GateD-V1'
```

**Expected:** V1A/V1B pass through Restate; existing V1C database test remains green.

**Commit:** `test: port Gate D authorization vectors`

## Task 5: Port V2 receipt and supported-purge evidence

**Objective:** Prove Restate workflow history and keys cannot replace or bypass PostgreSQL semantic receipts.

**Files:**
- Modify: `tests/restate-foundation.test.ts`
- Create: `tests/restate-submitter.ts`
- Modify: `src/alternative/restate/index.ts`
- Modify: `migrations/001_continuity.sql` only for the counted `snapshot_barrier` function branch
- Modify only if a public helper is reusable: `src/alternative/restate/client.ts`

**Tests:**

```text
GateD-V2A returns one stored receipt for two independent same-hash submitters using the same workflow key
GateD-V2A returns one stored receipt for two independent same-hash submitters using distinct workflow keys
GateD-V2B rejects different hash across same and new workflow keys
GateD-V2B preserves receipt authority after endpoint restart and supported invocation purge
GateD supporting assertion keeps command IDs independent across namespaces
```

Before either V2A case, a dedicated parent database session records its PID and acquires the exclusive advisory lock identified by `hashtextextended('continuity-gate-d-snapshot-barrier',0)`. Under `CK_FAILPOINT=snapshot_barrier`, only attempt 1 of each invocation's serializable datasource loop sets `continuity.test_failpoint='snapshot_barrier'`; every retry runs the normal function without that setting. The counted function branch runs before the existing command-ID advisory lock and receipt lookup, performs a non-locking case-version read, requires the observed version to equal the request's expected version (`3` for the frozen fixture), and waits with `pg_advisory_xact_lock_shared` on the same key. This placement is mandatory because distinct-key V2A uses the same command ID.

A separate observer queries `pg_locks`, locates the parent's granted `ExclusiveLock` by known PID, captures its exact advisory identity tuple `(database,classid,objid,objsubid)`, and requires each child as a distinct PID with `mode='ShareLock'`, `granted=false`, and the identical tuple. Generic `pg_stat_activity`/lock-wait counts cannot pass. This proves each attempt-1 transaction passed the version-3 read and waits on the intended barrier rather than the command-ID lock. The parent releases its lock in `finally`; compatible shared waiters proceed concurrently. Retries then bypass the barrier, allowing V2A to read the stored receipt and V3 to return `EXPECTED_VERSION_CONFLICT`. Never use exclusive transaction locks, queues, or concurrency-one as proof.

Launch two direct submitter child processes/connections. Each child uses the public Restate SDK and approved strict-envelope builder, sends only sanitized IPC (`submitted` with invocation ID, then terminal status/code), and never sends request bodies, payload references, hashes, or sentinels. In the same-workflow-key case, require exactly one waiting datasource transaction, start the second submitter while the first remains blocked, prove both submissions remain outstanding and may share one invocation ID, then release. In the distinct-key case, require two distinct waiting datasource backends/transactions before release. Assert both results equal the one stored PostgreSQL receipt, with exactly one transition/history row.

Purge procedure:

1. submit fixture A and capture invocation ID;
2. attach and verify completion;
3. call `PATCH /invocations/{invocationId}/purge`;
4. query supported `sys_invocation`/`sys_journal` until the completed invocation is absent;
5. restart the endpoint process;
6. submit the same command/request under a fresh workflow key and obtain the stored PostgreSQL receipt;
7. submit the different-hash request under another fresh key and obtain `IDEMPOTENCY_KEY_REUSED`;
8. assert one accepted transition/history record.

Never delete Restate volumes or inspect internal storage for this test.

**Focused command:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/restate-foundation.test.ts --no-file-parallelism --bail=1 -t 'GateD-V2|cross-namespace'
```

**Commit:** `test: prove Restate receipt authority`

## Task 6: Port V3 conflict and durable cancellation

**Objective:** Prove unqueued conflict behavior and no late commit after watchdog cancellation.

**Files:**
- Modify: `tests/restate-foundation.test.ts`
- Reuse: `tests/restate-submitter.ts`
- Modify: `src/alternative/restate/index.ts`
- Modify if message types are shared: `tests/restate-worker.ts`

**RED tests:**

```text
GateD-V3 returns one accepted and one expected-version conflict without a queue
GateD-V3 durably cancels retrying invocation and observes no late commit
```

Race test:

- use two independent submitter child processes/connections with distinct command IDs and distinct workflow keys;
- a dedicated parent session records its PID and holds the snapshot-barrier `ExclusiveLock` before submission;
- under `CK_FAILPOINT=snapshot_barrier`, only attempt 1 sets the local failpoint; require two distinct attempt-1 datasource PIDs represented in `pg_locks` as ungranted `ShareLock` rows matching the exact `(database,classid,objid,objsubid)` tuple of the parent's granted advisory lock;
- reaching those exact waits proves each transaction already observed case version 3 and is not blocked on the command-ID lock;
- verify canonical state remains version 3 and both submitters are outstanding, then release the parent lock so both compatible shared waiters proceed concurrently;
- retries must run without `snapshot_barrier`; assert one accepted, one `EXPECTED_VERSION_CONFLICT` after the required serialization retry, version 4, one accepted history, and no fork;
- generic datasource/lock-wait counts cannot pass; retain the no-queue/no-concurrency-one rule and release the parent lock in `finally`.

Cancellation test:

1. use existing `continuity.test_failpoint='retry_forever'` only under `CK_FAILPOINT=retry_forever`;
2. emit IPC messages containing exactly `{type:"attempt", vector:"V3", count}`;
3. observe more than one attempt;
4. at the frozen five-second watchdog, externally kill the endpoint;
5. observe direct-child exit and PostgreSQL datasource-backend disappearance within 45 seconds;
6. call `PATCH /invocations/{id}/cancel` and accept documented `200` or `202` management acknowledgement;
7. poll supported invocation fields until a cancellation-specific terminal result appears within ten seconds; a generic completed/failed status is insufficient;
8. reconcile PostgreSQL receipt/state only after quiescence and cancellation confirmation;
9. restart the same endpoint without the failpoint;
10. observe five seconds and prove no transition/receipt/history appears.

Pinned Restate 1.7.2 source defines cancellation as the `ABORTED` invocation failure with message `canceled`. Supported SQL evidence must therefore show `status='completed'`, `completion_result='failure'`, and `completion_failure` identifying `canceled`/`ABORTED`; do not accept an unrelated terminal failure.

**Minimal production change:** test-only failpoint handling may keep retrying past the normal limit; ordinary production behavior retains the five-attempt terminal bound. No request fields, payload references, hashes, or IDs may enter retry IPC.

**Focused command:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/restate-foundation.test.ts --no-file-parallelism --bail=1 -t 'GateD-V3'
```

**Commit:** `test: verify Restate conflict and cancellation`

## Task 7: Complete V5/V6 and invariant coverage

**Objective:** Close digest/version/privacy gaps without inventing replay or legal-compliance claims.

**Files:**
- Modify: `tests/restate-foundation.test.ts`
- Modify: `tests/database.test.ts`
- Modify if shared scanning is extracted: `tests/db-fixture.ts`
- Reuse: `tests/canonical.test.ts`, `tests/restate-crash.test.ts`

**V5 and invariant tests:**

```text
GateD-V5 returns the exact frozen projection digest after endpoint restart
GateD-V5 records supported Restate service/deployment version through public introspection
GateD-V5 fails explicitly for every unsupported technical compatibility version
GateD invariant 8 maps root-command causation and case correlation to durable fields
GateD invariant 9 distinguishes semantic world time, canonical ingestion sample, and non-authoritative operational clock
GateD privileges keep canonical objects owned by continuity_owner
GateD privileges deny continuity_app ownership, owner-role membership, direct DML/truncate/read, and role escalation
GateD privileges revoke PUBLIC execution while continuity_app retains only approved function execution
```

Retain direct database failures for unsupported request-hash, validator, and projection versions and all canonical JSON/raw-ingestion tests. The Restate compatibility-envelope tests must explicitly reject unsupported domain, authorization-model, serializer, and runtime-application versions; static pin evidence alone cannot pass V5.

For Invariant 8, assert the durable root-command mapping exactly: causation = `(command_id, request_hash)` and correlation = `(namespace_id, case_id)`, plus actor, grant/version, validator, position, and resulting record. Do not claim parent-command chains.

For Invariant 9, assert `world_time` is the hashed semantic request value, `ingestion_time` is PostgreSQL's canonical wall-clock sample, operational delays do not enter request hashes/digests, and no randomness/model/external observation influences canonical state.

**V6 test expansion:**

- place the frozen sentinel only in the deletable payload store;
- submit through the approved client;
- erase the payload row;
- scan all logical application text/JSON columns outside the payload store;
- inspect supported `sys_invocation` status/failure/metadata and `sys_journal.raw`/JSON;
- inspect worker and Restate container logs;
- search plaintext sentinel, SHA-256 hex, Base64URL digest, and their hex-encoded UTF-8 forms;
- confirm required state, receipt, accepted history, projection, and digest remain valid;
- report WAL/backups/replicas/physical restoration as unproven.

**Focused command:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/restate-foundation.test.ts tests/restate-crash.test.ts --no-file-parallelism --bail=1 -t 'GateD-V5|GateD-V6|never journals'
```

**Commit:** `test: complete Gate D version and privacy vectors`

## Task 8: Add local synthetic measurements

**Objective:** Record bounded local measurements without creating production SLOs.

**Files:**
- Create: `scripts/gate-d-metrics.ts`
- Create during execution: `artifacts/2026-07-11-gate-d-metrics.json`
- Modify: `package.json`

**Measurements:**

- five direct endpoint spawn-to-ready samples;
- canonical commit latency samples with fixture reset;
- V4A/V4B/V4C recovery completion samples from the verified harness;
- cancellation confirmation duration;
- five-second post-cancellation observation;
- replay throughput = `NOT_APPLICABLE_NO_EVENT_REPLAY`.

The script writes raw samples plus min/median/max. It must not emit request bodies, payload refs, hashes, database URLs, credentials, or environment secrets.

**Command:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run measure:gate-d
```

**Verification:** inspect the JSON schema and scan it for credentials/sentinel/request bodies.

**Commit:** `chore: record Gate D local measurements`

## Task 9: Run final aggregate and record decision

**Objective:** Produce independently reviewable Gate-D evidence and one frozen decision.

**Files:**
- Create: `artifacts/2026-07-11-gate-d-final.md`
- Modify after decision: `README.md`, `AGENTS.md`
- Synchronize after implementation commit: sibling research/Mission Control state

**Verification pack:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:gate-d
pnpm run typecheck
pnpm run lint
pnpm run build
docker compose config --quiet
git diff --check
```

Also run:

- frozen-file diff checks;
- private Restate API/storage/state scan;
- sentinel/derived-hash scans with an explicit allowlist for `docs/conformance-vectors.md` and synthetic test-fixture declarations; zero matches required in production source, approved runtime inputs/results/errors, supported journal/metadata, logs, and exported evidence;
- exact candidate and combined line count;
- pinned image/deployment verification;
- orphan worker/backend checks.

**Decision:** record exactly one:

```text
GATE_D_PASSES_FOUNDATION_V3
GATE_D_INCONCLUSIVE
GATE_D_REVISE
GATE_D_INCOMPLETE_AT_BOUND
```

If passing, stop after foundation V3 review. Do not begin T4 automatically.

**Commit and push:**

```bash
git add <verified Gate-D files>
git commit -m "test: complete Gate D foundation verification"
git push origin main
```

Then update Mission Control in a separate local research commit, preserve pre-existing `output/`, stop only the benchmark containers, and verify local/remote equality.

---

## Final plan review checklist

- [ ] All six frozen vectors map to explicit test evidence.
- [ ] All ten invariants and mandatory supporting assertions map to the aggregate.
- [ ] Restate-specific claims use public Restate APIs.
- [ ] Transaction-internal claims use canonical PostgreSQL integration tests.
- [ ] No DBOS pass is required from the rejected adapter.
- [ ] TDD precedes every production change.
- [ ] No new dependency or new migration exists; the only existing-migration edit is the Scope-Reviews-2–3 counted attempt-1 `snapshot_barrier` function branch, before command locking/receipt lookup, with no table/column/index/role/ACL change.
- [ ] Combined production path remains at or below 400 lines.
- [ ] Eight-hour clock starts only after the committed start artifact.
- [ ] Privacy scans include supported journal/metadata plus application/log surfaces.
- [ ] Measurements have no invented SLOs.
- [ ] Custom persistence, event replay, LLM, memory, UI, and identity portability remain out of scope.
