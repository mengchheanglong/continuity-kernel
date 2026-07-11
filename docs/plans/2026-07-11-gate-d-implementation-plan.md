# Gate D Restate/PostgreSQL Implementation Plan

> **For Hermes:** Execute this plan task-by-task with TDD and independent verification. Use Codex only for bounded implementation slices; Hermes owns scope, test evidence, and commits.

**Goal:** Run all six frozen conformance vectors and all ten foundation invariants against the surviving Restate/PostgreSQL direction, then record one honest Gate-D decision.

**Architecture:** Restate provides durable invocation, attachment, cancellation, and recovery through public APIs. PostgreSQL remains the canonical semantic authority through the existing request-hash receipt and atomic commit function. Direct database and canonicalization tests remain authoritative for transaction-internal and pure-serialization properties; runtime-specific claims must execute through Restate.

**Tech Stack:** Node.js 24, TypeScript 6, Vitest 4, Restate Server 1.7.2, Restate SDK/client 1.15.1, PostgreSQL 18.4, `postgres` 3.4.9, Zod 4.4.3, Docker Compose.

**Authority:** `docs/architecture/gate-d-preflight.md`

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

## Task 1: Start the Gate-D clock

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

## Task 3: Implement minimal dual boundary validation

**Objective:** Make malformed and undeclared input fail closed before approved submission and independently before PostgreSQL in the handler.

**Files:**
- Modify: `src/alternative/restate/client.ts`
- Modify: `src/alternative/restate/index.ts`
- Test: `tests/restate-foundation.test.ts`

**Minimal implementation shape:**

```ts
const requestSchema = z.strictObject({
  requestHashSchemaVersion: z.literal(1),
  namespaceId: z.string(),
  caseId: z.string(),
  actorId: z.string(),
  authorizationGrantId: z.string(),
  authorizationVersion: z.string().regex(/^(0|[1-9]\d*)$/u),
  expectedCaseVersion: z.string().regex(/^(0|[1-9]\d*)$/u),
  actionType: z.literal("resolve_case"),
  actionPayload: z.strictObject({
    commitmentDeadline: z.iso.datetime(),
    payloadRef: z.string(),
    resolution: z.enum(["completed", "cancelled"]),
  }),
  worldTime: z.iso.datetime(),
});
```

- Export one shared parser/schema from the production Restate module or a counted `schema.ts`; do not duplicate contract logic.
- Client parses before `canonicalHash` and before `workflowSubmit`.
- Handler parses independently and throws a typed `restate.TerminalError` before `ctx.run`/PostgreSQL.
- Do not include input data or validation issue values in durable/logged error text; use a fixed machine-readable code such as `INVALID_REQUEST_SCHEMA`.

**GREEN commands:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/restate-foundation.test.ts --no-file-parallelism --bail=1 -t 'GateD-V5'
pnpm run typecheck
pnpm run lint
```

**Expected:** all three V5 boundary tests pass; candidate/combined count remains at or below 400.

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
- Modify only if a public helper is reusable: `src/alternative/restate/client.ts`

**Tests:**

```text
GateD-V2A returns one stored receipt for concurrent same-hash submissions
GateD-V2B rejects different hash across same and new workflow keys
GateD-V2B preserves receipt authority after endpoint restart and supported invocation purge
GateD supporting assertion keeps command IDs independent across namespaces
```

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
- Modify: `src/alternative/restate/index.ts`
- Modify if message types are shared: `tests/restate-worker.ts`

**RED tests:**

```text
GateD-V3 returns one accepted and one expected-version conflict without a queue
GateD-V3 durably cancels retrying invocation and observes no late commit
```

Race test:

- use distinct command IDs and distinct workflow keys;
- submit completed/cancelled fixtures concurrently;
- assert one accepted, one `EXPECTED_VERSION_CONFLICT`, version 4, one accepted history, and no fork.

Cancellation test:

1. use existing `continuity.test_failpoint='retry_forever'` only under `CK_FAILPOINT=retry_forever`;
2. emit IPC messages containing exactly `{type:"attempt", vector:"V3", count}`;
3. observe more than one attempt;
4. at the frozen five-second watchdog, externally kill the endpoint;
5. call `PATCH /invocations/{id}/cancel`;
6. use supported SQL introspection to confirm terminal cancellation within ten seconds;
7. reconcile PostgreSQL receipt/state;
8. restart the same endpoint without the failpoint;
9. observe five seconds and prove no transition/receipt/history appears.

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
- Modify if shared scanning is extracted: `tests/db-fixture.ts`
- Reuse: `tests/canonical.test.ts`, `tests/database.test.ts`, `tests/restate-crash.test.ts`

**V5 tests:**

```text
GateD-V5 returns the exact frozen projection digest after endpoint restart
GateD-V5 records supported Restate service/deployment version through public introspection
```

Retain existing direct failures for unsupported request-hash, validator, and projection versions, plus all canonical JSON adversarial tests. Record serializer/runtime pin checks as static evidence; do not add fake version fields to semantic requests.

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
- sentinel/derived-hash scans over source, supported journal/metadata, logs, and artifacts;
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
- [ ] No new dependency or migration is expected.
- [ ] Combined production path remains at or below 400 lines.
- [ ] Eight-hour clock starts only after the committed start artifact.
- [ ] Privacy scans include supported journal/metadata plus application/log surfaces.
- [ ] Measurements have no invented SLOs.
- [ ] Custom persistence, event replay, LLM, memory, UI, and identity portability remain out of scope.
