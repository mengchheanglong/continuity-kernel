# T4 Preflight — One Deterministic Actor

**Recorded:** 2026-07-11T15:26:27Z
**Authority:** `artifacts/2026-07-11-foundation-review.md`
**Baseline:** `3bf0f35e9b904325b001bdea534bd8b35fcf6bb1`
**Status:** frozen before T4 implementation; executable work remains locked until sibling Mission Control records this approval in a separate committed update

## Objective

Implement and benchmark one deterministic actor in one synthetic case-resolution scenario. A test-only trusted fixture derives the permitted-observation representation from authoritative synthetic PostgreSQL rows; no production observation service is introduced:

```text
observe permitted state
→ select fixed rule/goal
→ propose typed action
→ validate
→ commit or reject
→ record consequence
```

The actor proposes only. Its local checks prove representation validity and declared-scope consistency, not authorization. Existing request validation, Restate submission, canonical PostgreSQL transaction, receipts, history, and privileges remain authoritative.

## Bounds

- Maximum implementation time: **four hours** from a separately committed T4 start artifact.
- Maximum T4-specific non-test TypeScript: **140 nonblank, non-comment lines**.
- Maximum production files: **two** under `src/actor/`.
- No new dependency, migration, table, column, index, role, ACL, container, service, queue, event store, projector, snapshot store, or runtime protocol.
- Existing Gate-D production and frozen documents may not be weakened.
- Synthetic data only.

Mandatory vectors, exact authorization handoff, cleanup, and Gate-D regression take priority over measurements and report polish. If the remaining clock cannot support the mandatory verification and independent review, stop with `T4_INCOMPLETE_AT_BOUND`; do not drop vectors, compress review, weaken parsing, or obscure logic to satisfy the line/time caps.

The authoritative clock is the UTC timestamp written into the separately committed T4 start artifact. The four-hour deadline is exactly that timestamp plus four hours. Writing, committing, and pushing the start artifact all count after its recorded timestamp; every later executable-test, harness, source, metrics, debugging, implementation commit/push, final evidence/decision write, review, and rerun action also counts and must complete by the deadline. The timestamp never changes and the clock never resets. No start artifact or T4 executable file may be created until the reviewed planning commit is pushed and sibling Mission Control has separately committed `T4 APPROVED — PREFLIGHT FROZEN` referencing that planning commit. No executable file may be created before the start artifact commit is then pushed.

## Frozen evidence boundaries

T4 distinguishes three boundaries and must not conflate them:

1. **Synthetic observation provenance:** a test-only trusted fixture performs an authoritative join over the synthetic case and authorization grant, requiring matching namespace, case, actor, grant ID/version, and `is_revoked = false`, and emits only the frozen permitted fields. This proves provenance only for the benchmark fixture, not a production observation API.
2. **Local actor consistency:** the pure selector strictly validates the representation and checks declared actor/grant consistency, case status, fixed action, and semantic deadline. These checks are fail-fast ergonomics, not authorization.
3. **Authoritative authorization:** every apparently well-formed proposal is still untrusted. Only the existing canonical PostgreSQL transaction decides grant ownership, namespace/case scope, version, revocation, and state validity. The actor consequence must preserve its typed rejection.

Arbitrary callers can construct schema-valid observations. T4 therefore does not prove general prohibited-knowledge exclusion or production observation integrity.

## Frozen actor contract

### Permitted observation V1

The only actor input is a strict object containing:

```text
observationSchemaVersion = 1
actorRuleVersion = 1
namespaceId
caseId
actorId
grantActorId
authorizationGrantId
authorizationVersion
expectedCaseVersion
worldTime
caseStatus = open
commitmentDeadline
payloadRef
permittedAction = resolve_case
permittedResolution = completed
```

No display profile, credential, memory, undeclared field, database row, runtime handle, environment value, wall clock, random seed, model output, or external observation is part of this representation. Undeclared fields fail closed. This is a schema claim, not proof about a production observation source.

### Fixed rule/goal

The single rule is:

```text
If the observation representation is valid, locally consistent with its declared grant actor, the case is open,
the only permitted action is resolve_case, and worldTime is not after commitmentDeadline,
propose resolution=completed using expectedCaseVersion from the observation.
Otherwise reject locally and submit nothing.
```

No alternative goal selection, planning search, learning, or policy configuration is in scope.

### Deterministic proposal

The proposal contains only:

```text
proposalSchemaVersion = 1
actorRuleVersion = 1
commandId = "proposal:t4:v1:" + canonicalHash(observation)
request = existing ResolveCaseRequest
proposalDigest = canonicalHash({proposalSchemaVersion, actorRuleVersion, commandId, request})
```

Repeated identical observations must produce byte-equivalent canonical proposals, command IDs, request hashes, and proposal digests. Declared semantic changes must change the relevant identity. Proposal selection must be a pure function.

### Commit and consequence

The actor adapter may call only the existing approved `submitCommand(commandId, request, workflowId?)` client. It may not call PostgreSQL, Restate Admin, private Restate state/storage, or the canonical commit function directly.

The consequence is a typed wrapper over the proposal identity and the existing accepted/rejected result. The PostgreSQL receipt, accepted history, decision audit, and resulting canonical state remain durable authority. T4 adds no actor-state or consequence table.

## Frozen vectors

### T4-V1 Deterministic repetition

Given the same permitted observation twice, both proposals have exact-equal canonical JSON, command ID, request hash, and proposal digest. Delay between evaluations changes nothing.

### T4-V2A Representation and local-consistency rejection

Each of the following rejects locally and invokes no submitter:

- malformed or unsupported observation schema/rule version;
- undeclared extra field representing unobserved information;
- declared actor/grant-actor mismatch;
- non-open case;
- undeclared action or resolution;
- world time after deadline.

Errors are fixed, data-free codes.

This vector proves strict representation and declared consistency only. Rejection of an undeclared hidden field proves schema enforcement, not that a production actor lacked prohibited knowledge.

### T4-V2B Authoritative authorization handoff

Submit apparently well-formed actor proposals through `submitCommand` with each of the following authoritative defects: revoked grant → `AUTHORIZATION_REVOKED`; wrong actor, wrong case, or wrong namespace → `AUTHORIZATION_DENIED`; stale authorization version on an otherwise current unrevoked grant → `AUTHORIZATION_VERSION_CONFLICT`. Require the actor consequence to preserve that exact rejection, create no accepted history/state change, retain one rejected command receipt and the required decision audit, and leave the case at version 3/open. Local equality of caller-supplied fields is never accepted as authorization proof.

### T4-V3 Accepted causal trace

A permitted proposal submitted through the approved Restate client is accepted exactly once. The proposal, result, PostgreSQL receipt/history, and resulting state agree on namespace, case, actor, command, request hash, authorization/version, position, projection, and consequence code.

### T4-V4 Duplicate proposal

Two independent executions of the same observation, using distinct Restate workflow keys, return the same stored accepted receipt. Exactly one receipt and one accepted-history row exist.

### T4-V5 Stale proposal

Create a proposal from expected version 3, commit a competing valid command to version 4, then submit the original proposal. It returns `EXPECTED_VERSION_CONFLICT`, creates no accepted record for the stale command, and does not alter version 4 state.

### T4-V6 Deterministic reproduction after actor-process loss

Evaluate a proposal in a child process, terminate that actor process after proposal emission but before submission, then have the parent supply the identical observation to a fresh actor process and prove it emits the exact same sanitized proposal identity. Submit once through the existing client and observe exactly one canonical consequence. This proves process-independent deterministic recomputation only. It does not prove autonomous restart, observation reacquisition, detection of prior submission, pending-submission recovery, or mid-commit recovery; Gate-D V4 remains authoritative for runtime recovery.

## Measurements

Record local synthetic samples for:

- proposal evaluation latency, five samples;
- deterministic repeat equality;
- accepted end-to-end consequence latency;
- duplicate consequence completion;
- stale rejection completion;
- process-loss-to-reproduced-proposal duration.

Measurements are not production SLOs and must not export request bodies, hashes tied to private data, credentials, URLs, or environment values.

## Verification

```bash
pnpm run test:t4
pnpm run test:gate-d
pnpm run typecheck
pnpm run lint
pnpm run build
docker compose config --quiet
git diff --check
```

Also verify:

- exact T4 production line count at or below 140 using only `src/actor/deterministic.ts` and `src/actor/execute.ts`;
- `tsconfig.json` includes `scripts/**/*.ts`, `eslint.config.js` applies typed rules to `scripts/**/*.ts`, and the package lint command is exactly `eslint src tests scripts`, so `scripts/t4-metrics.ts` cannot escape static verification;
- no diff to migrations, canonical schemas, Gate-D runtime protocol, dependencies, lockfile, compose, or frozen vector/invariant/privacy documents;
- no PostgreSQL/Restate Admin/private-storage import from `src/actor/`;
- no clock/random/model/network/database access in proposal selection;
- zero orphan actor/worker processes and database backends;
- no synthetic hidden-field or payload material in logs/evidence.

`test:t4` is frozen exactly as:

```json
"test:t4": "vitest run tests/deterministic-actor.test.ts tests/restate-actor.test.ts --no-file-parallelism --bail=1"
```

The aggregate must collect exactly **16 tests**: 10 pure-selector/adapter tests and 6 Restate integration tests. A different count is a failure until reconciled by a dated pre-implementation review.

The exact line-count command is:

```bash
python -c "from pathlib import Path; ps=[Path('src/actor/deterministic.ts'),Path('src/actor/execute.ts')]; print(sum(1 for p in ps for line in p.read_text(encoding='utf-8').splitlines() if line.strip() and not line.strip().startswith('//')))"
```

Block comments are forbidden in the two counted actor files, making this command an exact nonblank/non-comment count.

## Decisions

Record exactly one:

```text
T4_PASSES_DETERMINISTIC_ACTOR
T4_REVISE
T4_INCONCLUSIVE
T4_INCOMPLETE_AT_BOUND
```

A pass stops for T4 review. It does not begin T5 automatically.
