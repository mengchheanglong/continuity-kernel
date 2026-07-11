# T4 Deterministic Actor Implementation Plan

> **For Hermes:** Use test-driven development and bounded Codex slices; independently verify and review every checkpoint before commit.

**Goal:** Build and verify one pure deterministic actor that converts a strict permitted observation into one typed case-resolution proposal and uses the existing Restate/PostgreSQL path for accepted or rejected consequences.

**Architecture:** `src/actor/deterministic.ts` owns strict observation parsing and pure proposal selection. `src/actor/execute.ts` is a thin adapter to the existing `submitCommand`; it adds no authority or storage. Unit tests prove determinism and local rejection. Restate integration tests prove accepted, duplicate, stale, and interrupted-actor consequences while existing Gate-D tests remain unchanged.

**Tech Stack:** TypeScript 6, Zod 4, canonical RFC 8785/SHA-256 helper, Restate SDK/client 1.15.1, PostgreSQL 18.3, Vitest 4.

---

## Task 1: Commit the approval and frozen preflight

**Objective:** Make the T4 authority, contract, bounds, vectors, and stop rules immutable before executable work.

**Files:**
- Create: `artifacts/2026-07-11-foundation-review.md`
- Create: `docs/architecture/t4-preflight.md`
- Create: `docs/plans/2026-07-11-t4-deterministic-actor-plan.md`

**Steps:**

1. Review the three documents against `GOAL.md`, Mission Control `TASKS.md`, Gate-D final evidence, and frozen invariants.
2. Verify no executable source, test, dependency, migration, compose, or frozen-contract file changed.
3. Run `git diff --check`.
4. Obtain independent pre-commit review.
5. Commit and push: `docs: approve bounded T4 deterministic actor`.
6. Verify `HEAD == origin/main` and a clean tree.
7. In sibling `transcendiverse-research`, update only Mission Control `TASKS.md` to record `T4 APPROVED — PREFLIGHT FROZEN`, reference the exact planning commit, retain T5 lock, and state that no executable work has started.
8. Commit that one-file Mission Control update separately; preserve unrelated `output/` and verify the research tree is clean.
9. Do not create the T4 start artifact or any executable T4 file unless both the implementation-repository planning commit and authoritative Mission Control approval commit exist.

## Task 2: Start the bounded clock and establish pure-actor RED

**Objective:** Record the start before executable T4 changes and prove the actor contract is absent.

**Files:**
- Create and commit first: `artifacts/2026-07-11-t4-start.md`
- Create after start commit: `tests/deterministic-actor.test.ts`

**Steps:**

1. Record one authoritative UTC timestamp, baseline commit, exact timestamp-plus-four-hours deadline, clean status, pins, 140-line cap, and no-reset rule. The clock starts at that recorded timestamp; writing/committing/pushing the artifact counts.
2. Commit/push the start artifact before writing any executable T4 file. The artifact timestamp—not commit time or first test edit—is authoritative.
3. Add RED tests for:
   - exact deterministic proposal fixture and digest;
   - delay-independent repeated evaluation;
   - malformed/unsupported observation and rule versions;
   - undeclared hidden field;
   - declared actor/grant-actor mismatch;
   - non-open case;
   - undeclared action/resolution;
   - world time after deadline;
   - fixed data-free error codes;
   - no submitter call after local rejection.
4. Run:

```bash
pnpm exec vitest run tests/deterministic-actor.test.ts --no-file-parallelism --bail=1
```

Expected: RED because `src/actor/deterministic.ts` and `src/actor/execute.ts` do not exist.
5. Commit the reviewed RED test only.

## Task 3: Implement the pure selector and thin adapter

**Objective:** Turn the pure-actor RED green with no new authority or hidden state.

**Files:**
- Create: `src/actor/deterministic.ts`
- Create: `src/actor/execute.ts`
- Modify only if required for test command: `package.json`

**Required public surface:**

```ts
export type ActorObservationV1 = z.infer<typeof actorObservationSchema>;
export interface ActorProposalV1 { /* frozen preflight fields only */ }
export class ActorDecisionError extends Error { readonly code: ActorDecisionCode }
export function selectProposal(input: unknown): ActorProposalV1;
export async function executeObservation(input: unknown, workflowId?: string): Promise<ActorConsequenceV1>;
```

**Implementation rules:**

1. Use `z.strictObject`; reject technical versions with fixed version-specific codes before generic schema failure.
2. Compare `actorId === grantActorId` locally, explicitly as declared-input consistency rather than authorization.
3. Require open status, fixed action/resolution, and semantic `worldTime <= commitmentDeadline`.
4. Build the existing `ResolveCaseRequest` without extra envelope fields.
5. Derive command ID only from `canonicalHash(parsedObservation)`.
6. Derive proposal digest only from the frozen proposal object.
7. `execute.ts` may import only `selectProposal` and the existing Restate `submitCommand` client.
8. No clock, randomness, environment, filesystem, database, Restate Admin, private runtime, mutable module state, or logging.
9. Keep both production files together at or below 140 counted lines.

**Verification:**

```bash
pnpm exec vitest run tests/deterministic-actor.test.ts --no-file-parallelism --bail=1
pnpm run typecheck
pnpm run lint
```

Expected: all pure actor tests pass. Independently scan imports and counted lines. Review, commit, and push.

## Task 4: Establish end-to-end actor RED

**Objective:** Freeze trusted synthetic observation provenance, authoritative invalid-grant rejection, accepted, duplicate, stale, causal-trace, and process-loss reproduction evidence before integration implementation/harness changes.

**Files:**
- Create: `tests/restate-actor.test.ts`
- Create: `tests/actor-child.ts`
- Create: `tests/actor-observation-fixture.ts`
- Modify: `package.json` to add `test:t4`

**Steps:**

1. Reuse `tests/db-fixture.ts`, existing Restate worker, approved client, and public Admin deployment registration only in the test harness.
2. Add a test-only trusted observation fixture that joins case and grant on namespace/case/actor/grant/version and requires unrevoked state before emitting only frozen observation fields. Label it synthetic provenance, not a production API.
3. Add one `T4-V2B` test with subcases for revoked grant (`AUTHORIZATION_REVOKED`), wrong actor/case/namespace (`AUTHORIZATION_DENIED`), and stale version on an otherwise current unrevoked grant (`AUTHORIZATION_VERSION_CONFLICT`); each apparently well-formed proposal must reach the canonical path, preserve its exact rejection through the actor consequence, create no accepted history/state change, retain one rejected receipt and required rejection audit, and leave the case at version 3/open.
4. Add `T4-V3` accepted trace assertions across proposal, result, stored receipt, accepted history, state, actor, authorization/version, position, projection, and consequence code.
5. Add `T4-V4` two independent executions with distinct workflow keys; assert equal receipt and counts 1/1.
6. Add `T4-V5` proposal at version 3, competing canonical acceptance to version 4, stale submission rejection, no stale accepted row, unchanged state.
7. Add `T4-V6` child proposal emission, sanitized IPC schema assertion, external child kill before submission, parent-supplied identical observation to a fresh child, exact reproduction, then one accepted consequence. State that this does not prove autonomous recovery or observation reacquisition.
8. Add one integration boundary/cleanup test so this file contains exactly six tests total.
9. Ensure no child IPC/log contains request body, payload reference, authorization grant, or request hash. IPC is frozen to `{type, commandId, proposalDigest}` using synthetic identities only.
10. Set `test:t4` exactly to `vitest run tests/deterministic-actor.test.ts tests/restate-actor.test.ts --no-file-parallelism --bail=1`; the two files must collect exactly 16 tests (10 pure, 6 integration).
11. Run the focused command and capture RED. RED must reflect missing/incorrect integration behavior, not setup failure.
12. Review and commit RED tests.

## Task 5: Turn actor integration GREEN

**Objective:** Pass all frozen T4 vectors with the minimal existing-path adapter.

**Files:**
- Modify only as demanded by RED: `src/actor/deterministic.ts`, `src/actor/execute.ts`, test-only harness files

**Steps:**

1. Make only minimal corrections required by the integration RED.
2. Do not change migrations, canonical transaction, Restate service/index/client protocol, dependencies, lockfile, compose, roles, or privileges.
3. Run:

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:t4
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:gate-d
pnpm run typecheck
pnpm run lint
pnpm run build
docker compose config --quiet
git diff --check
```

4. Verify exactly 16 T4 tests, exact actor line count using the preflight command, import boundary, no forbidden APIs, cleanup, and Gate-D 105/105 regression.
5. Obtain independent security/spec/code review; fix material findings; rerun full pack.
6. Commit and push: `feat: add deterministic actor baseline`.

## Task 6: Record bounded measurements

**Objective:** Produce raw local synthetic T4 measurements without SLO claims or sensitive exports.

**Files:**
- Create: `scripts/t4-metrics.ts`
- Create during execution: `artifacts/2026-07-11-t4-metrics.json`
- Modify: `package.json`, `tsconfig.json`, `eslint.config.js`

**Steps:**

1. Measure five pure proposal evaluations.
2. Record exact deterministic repeat equality.
3. Measure one accepted consequence, one duplicate consequence, one stale rejection, and process-loss-to-reproduced-proposal.
4. Store raw/min/median/max for every numeric measurement, including singleton summaries.
5. Add hard subprocess timeouts and cleanup.
6. Export only numeric values, booleans, schema labels, and limitations.
7. Scan artifact for requests, hashes, payload/grant refs, credentials, URLs, environment values, and sentinel material.
8. Add `scripts/**/*.ts` to `tsconfig.json` and the typed ESLint file match in `eslint.config.js`; freeze package lint to `eslint src tests scripts`; execute metrics through exact package script `"measure:t4": "tsx scripts/t4-metrics.ts"`.
9. Run `pnpm run measure:t4`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build`; review, commit, and push: `chore: record T4 local measurements`.

## Task 7: Final T4 aggregate and decision

**Objective:** Produce one independently reviewable T4 decision and stop before T5.

**Files:**
- Create: `artifacts/2026-07-11-t4-final.md`
- Modify after decision: `README.md`, `AGENTS.md`
- Synchronize afterward: sibling Mission Control `TASKS.md` in a separate local research commit

**Verification pack:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:t4
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:gate-d
pnpm run typecheck
pnpm run lint
pnpm run build
docker compose config --quiet
git diff --check
```

Also verify:

- all six named T4 vectors, the V2A/V2B sub-boundaries, exactly 16 collected tests, and every approval condition;
- actor source at or below 140 counted lines;
- frozen and forbidden-file diffs are empty;
- deterministic selector import/API scan;
- no secret/private material in logs, IPC, metrics, or evidence;
- pinned image/deployment evidence;
- zero orphan child/worker/backend/lock state.

Record exactly one frozen T4 decision, obtain independent final review, commit/push, verify local/remote equality, update Mission Control separately, preserve unrelated `output/`, and stop only benchmark containers.

A T4 pass stops for review. T5 remains locked.
