# T4R Preflight - Corrective Deterministic Actor Experiment

**Recorded:** 2026-07-12
**Status:** frozen specification candidate; executable work locked
**Authority:** `artifacts/2026-07-12-t4-bound-review.md`
**Prior outcome preserved:** `T4_INCOMPLETE_AT_BOUND`
**Foundation preserved:** `GATE_D_PASSES_FOUNDATION_V3`

## Purpose

T4R is a separately named corrective experiment for the T4 deterministic actor boundary. It may prove only that the existing deterministic actor can recompute one immutable test-only synthetic proposal in a process-independent way while preserving the bidirectional privacy contract that original T4 missed.

T4R cannot retroactively change the original T4 decision. A T4R pass records a new correction decision only. Gate D remains the foundation authority. Consumer and doctor repairs remain outside T4R.

## Frozen correction

Original T4 passed green tests but failed the frozen evidence contract because the parent sent a complete `ActorObservationV1` over parent-to-child IPC and the privacy oracle checked stdout/stderr too early. T4R corrects that by changing the process-loss proof:

- both parent and child import the same frozen immutable test-only synthetic fixture module from source;
- the parent may launch the child process;
- the parent sends zero inbound IPC messages to the child;
- the parent sends no observation, request body, payload reference, authorization grant, request hash, semantic ID, environment key/value, or secret/private data to the child over IPC, argv, env, stdout, or stderr;
- the actor child is launched with an explicitly empty environment object; it must not inherit the parent environment;
- the child emits exactly one outbound IPC message to the parent:

```json
{"type":"proposal","commandId":"<derived command id>","proposalDigest":"<derived proposal digest>"}
```

This proves process-independent deterministic recomputation for one immutable fixture only. It is not parent-supplied observation, observation reacquisition, autonomous actor recovery, pending-submission recovery, a production observation service, or a general prohibited-knowledge proof.

## Scope

Allowed implementation scope after approval:

- minimal test-harness correction for bidirectional IPC privacy;
- an immutable test-only fixture used by both parent and child;
- focused regression assertions inside the existing T4 integration surface;
- T4R metrics script and metrics artifact;
- package script needed to run metrics.

Production actor code remains unchanged unless a reviewed failing test proves a production change is required. If production actor code changes, the corrected experiment must explain why the failure was not harness-only and must keep `src/actor/deterministic.ts` plus `src/actor/execute.ts` at `116/140` production lines unless an independent review approves a still-under-140 delta.

Forbidden scope:

- dependencies, migrations, Compose changes, ACL changes, services, queues, custom persistence, LLMs, memory, UI, T5, consumer/doctor repairs, real personal data, production observation service, Restate private storage, or canonical transaction changes;
- weakening any Gate-D vector, T4 semantic vector, request/digest fixture, invariant, privacy boundary, or non-claim;
- treating local actor checks as authorization.

## Test contract

`test:t4` remains:

```json
"test:t4": "vitest run tests/deterministic-actor.test.ts tests/restate-actor.test.ts --no-file-parallelism --bail=1"
```

T4R preserves exactly 10 pure tests and 6 integration tests, 16 total. The pure test names remain:

1. `selects the exact deterministic proposal fixture`
2. `repeats exactly after a real delay without changing canonical identity`
3. `rejects an unsupported observation schema version with a fixed data-free code`
4. `rejects an unsupported actor rule version with a fixed data-free code`
5. `rejects malformed or undeclared representations as schema errors`
6. `rejects declared actor and grant-actor mismatch as local consistency only`
7. `rejects a non-open case locally with a fixed data-free code`
8. `rejects undeclared action and resolution values with distinct fixed codes`
9. `rejects semantic world time after the commitment deadline`
10. `submits nothing for every executeObservation V2A local rejection category`

The integration test names are frozen as:

1. `proves exact trusted observation provenance and independently denies every authority mismatch`
2. `T4R-V2B preserves exact authoritative authorization rejections in isolated subcases`
3. `T4R-V3 records one accepted causal trace consistently across every available surface`
4. `T4R-V4 returns the same stored acceptance for duplicate proposals on distinct workflows`
5. `T4R-V5 rejects a stale proposal after one exact competing transition`
6. `T4R-V6 proves zero-inbound process-independent deterministic reproduction only, not restart or reacquisition`

The six integration vectors must retain their original semantic assertions. T4R may add assertions inside those tests, especially the sixth test, but may not reduce the vector coverage or hide a failing semantic check behind a privacy-only pass.

Required bidirectional privacy assertions:

- source and runtime-controller evidence show zero calls to `child.send` or any equivalent parent-to-child channel;
- the child installs a fail-closed inbound-message handler with one fixed data-free failure exit, while the parent sends no message and V6 observes no such failure;
- actual `ChildProcess.spawnargs` are captured and scanned rather than reconstructed evidence;
- the exact environment object supplied to the actor child is captured in-memory and asserted to have zero own keys; persisted evidence records only the zero count;
- stdout and stderr are captured after spawn and after proposal receipt, then rechecked only after the child `close` event confirms process termination and stdio closure;
- launch, IPC, process error, stdout, stderr, and log evidence contain no observation object, request body, payload reference, authorization grant, request hash, proposal digest from inbound surfaces, command ID from inbound surfaces, DB URL, password, token, deployment URI, host address, inherited environment key/value, or raw subprocess output in persisted artifacts;
- child-to-parent IPC contains exactly one message and exactly the keys `type`, `commandId`, `proposalDigest`.

## Harness and script caps

T4R production cap:

```bash
python -c "from pathlib import Path; ps=[Path('src/actor/deterministic.ts'),Path('src/actor/execute.ts')]; print(sum(1 for p in ps for line in p.read_text(encoding='utf-8').splitlines() if line.strip() and not line.strip().startswith('//')))"
```

Expected before and after T4R: `116`, maximum `140`.

T4R corrective harness/script cap is separate from production code:

- at most 120 added nonblank, noncomment TypeScript lines across `tests/actor-child.ts`, `tests/actor-child-runner.ts`, `tests/actor-child-fixture.ts`, and `tests/restate-actor.test.ts` relative to the T4R start baseline;
- `scripts/t4r-metrics.ts` at most 320 nonblank, noncomment TypeScript lines;
- block comments are forbidden in `scripts/t4r-metrics.ts`.

Exact metrics-script count command:

```bash
python -c "from pathlib import Path; p=Path('scripts/t4r-metrics.ts'); print(sum(1 for line in p.read_text(encoding='utf-8').splitlines() if line.strip() and not line.strip().startswith('//')))"
```

The additive harness count must be recorded with the T4R start baseline commit and this command shape:

```bash
git diff --unified=0 <T4R_START_BASE> -- tests/actor-child.ts tests/actor-child-runner.ts tests/actor-child-fixture.ts tests/restate-actor.test.ts | python -c "import sys; print(sum(1 for line in sys.stdin if line.startswith('+') and not line.startswith('+++') and line[1:].strip() and not line[1:].lstrip().startswith('//')))"
```

## Metrics contract

T4R must add:

- executable `scripts/t4r-metrics.ts`;
- package script `"measure:t4r": "tsx scripts/t4r-metrics.ts"`;
- generated artifact `artifacts/<UTC-date>-t4r-metrics.json`.

Six required metric classes:

1. pure proposal evaluation latency, exactly 5 samples;
2. deterministic repeat equality result with exactly 5 timing samples;
3. accepted consequence completion with exactly 1 sample;
4. duplicate consequence completion with two distinct Restate workflow IDs and exactly 1 sample;
5. stale rejection completion with exactly 1 sample;
6. process-spawn-to-reproduced-proposal duration with exactly 1 sample.

Every numeric class must include `rawMs`, `minMs`, `medianMs`, and `maxMs`. Harness-inclusive timings must be labelled `harnessInclusive: true`. Singleton classes still include one-value `rawMs`, `minMs`, `medianMs`, and `maxMs`.

The metrics runner must reuse the verified focused T4R vectors rather than reimplement their durable semantics. Opt-in instrumentation may emit one fixed-prefix numeric-only marker per focused run; the metrics process parses only that marker and never serializes captured test output. The actor child still receives an empty environment. The metrics runner must enforce a hard outer subprocess timeout with kill and wait, bounded stdout/stderr capture, cleanup verification, and no final artifact after partial failure. The final JSON must be written only after all measurements, cleanup, and leakage scans pass.

The metrics artifact must not contain semantic fields, namespace/case/actor IDs, command IDs, request hashes, proposal digests, payload references, grants, DB URLs, passwords, tokens, deployment URI, host addresses, environment values, logs, stdout, stderr, or raw subprocess output.

Required artifact schema:

```json
{
  "schemaVersion": 1,
  "experiment": "T4R",
  "recordedAt": "RFC3339 UTC timestamp",
  "sourceCommit": "git commit",
  "environment": {
    "node": "approved tool-version string",
    "pnpm": "approved tool-version string",
    "restateServer": "version string or NOT_RECORDED",
    "postgres": "version string or NOT_RECORDED"
  },
  "measurements": {
    "pureProposalEvaluation": {"harnessInclusive": false, "rawMs": [0], "minMs": 0, "medianMs": 0, "maxMs": 0},
    "deterministicRepeatEquality": {"equal": true, "harnessInclusive": false, "rawMs": [0], "minMs": 0, "medianMs": 0, "maxMs": 0},
    "acceptedConsequenceCompletion": {"harnessInclusive": true, "rawMs": [0], "minMs": 0, "medianMs": 0, "maxMs": 0},
    "duplicateConsequenceCompletion": {"distinctWorkflowIds": true, "harnessInclusive": true, "rawMs": [0], "minMs": 0, "medianMs": 0, "maxMs": 0},
    "staleRejectionCompletion": {"harnessInclusive": true, "rawMs": [0], "minMs": 0, "medianMs": 0, "maxMs": 0},
    "processSpawnToReproducedProposal": {"harnessInclusive": true, "rawMs": [0], "minMs": 0, "medianMs": 0, "maxMs": 0}
  },
  "privacyScan": {
    "artifactForbiddenMatches": 0,
    "stdoutCapturedBytesPersisted": 0,
    "stderrCapturedBytesPersisted": 0
  },
  "cleanup": {
    "actorChildren": 0,
    "workers": 0,
    "datasourceBackends": 0,
    "advisoryLocks": 0
  },
  "limitations": [
    "local synthetic measurements only",
    "not a production SLO"
  ]
}
```

The zero values above are schema placeholders, not expected timings. The four approved tool/runtime version strings are metadata, not inherited actor-child environment values. `sourceCommit` must be the pushed T4R GREEN checkpoint used by the metrics run.

## Governance and clock

Preflight and plan must be independently reviewed and committed before Mission Control approval. Mission Control approval must be a separate research-repository commit referencing the implementation-repository planning commit before any T4R start artifact or executable work is created.

Recommended bound: 10 hours.

The T4R clock starts at the exact UTC timestamp recorded in an immutable start artifact, `artifacts/<UTC-date>-t4r-start.md`, created only after planning and Mission Control approval. The deadline is exactly start timestamp plus 10 hours. Writing, committing, pushing, fetching, reviews, tests, metrics, debugging, reruns, final decision artifacts, and local/remote equality checks all count. The clock never resets.

Strict sequence:

1. preflight and plan review;
2. implementation-repository planning commit and push;
3. sibling Mission Control approval commit;
4. T4R start artifact commit and push;
5. RED checkpoint with production unchanged;
6. independent RED review;
7. RED commit, push, fetch, and local/remote equality;
8. GREEN implementation;
9. focused GREEN privacy/code review, commit, push, fetch, and equality;
10. metrics;
11. full aggregate verification, exact test-name/count extraction, strict metrics-artifact schema/string scan, and cleanup evidence;
12. independent security/spec review of code plus metrics/evidence;
13. independent final review;
14. final decision commit, push, fetch, and local/remote equality.

If any required item misses the deadline, record `T4R_INCOMPLETE_AT_BOUND`. A green test suite cannot override contract, privacy, review, metrics, push, or equality failures.

## Required final verification

Before any T4R pass decision:

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:t4
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:gate-d
pnpm run measure:t4r
pnpm run typecheck
pnpm run lint
pnpm run build
docker compose config --quiet
git diff --check
```

Additional required checks:

- `test:t4` reports exactly 16 tests;
- `test:gate-d` reports exactly 105 tests;
- production actor count is at or below 140 and expected to remain 116;
- metrics script count is at or below 320;
- T4R harness additive count is at or below 120;
- child IPC privacy assertions pass in both directions;
- metrics artifact leakage scan has zero forbidden matches;
- no orphan actor child, worker, datasource backend, or advisory lock remains;
- changed-file allowlist matches the T4R implementation plan;
- JSON reporter evidence mechanically confirms the exact 10 pure and 6 frozen integration titles, all passed;
- an external strict-schema/string validator proves the metrics artifact contains only the frozen keys, numeric/boolean evidence, approved tool-version strings, one UTC timestamp, one commit hash, and the two exact limitations; a short known-value scan is supplemental and cannot substitute for this validator;
- local `HEAD` equals the fetched remote branch immediately before creating the final decision artifact;
- the final decision becomes effective only if its own commit is pushed, fetched, and proven equal to the remote branch before the deadline. The artifact records the pre-decision equality proof and this explicit effectiveness condition; post-commit equality is captured in the execution evidence and final report rather than claimed inside an uncommitted artifact.

## Decisions

Record exactly one final decision:

```text
T4R_PASSES_CORRECTION
T4R_REVISE
T4R_INCONCLUSIVE
T4R_INCOMPLETE_AT_BOUND
```

`T4R_PASSES_CORRECTION` stops at correction review. It does not open T5 and does not promote the consumer gate.

## Unproven boundaries

T4R does not prove:

- production observation integrity;
- autonomous actor restart;
- observation reacquisition;
- pending-submission recovery;
- prohibited-knowledge exclusion beyond the strict immutable fixture test;
- privacy across WAL, backups, replicas, private Restate storage, external telemetry, or future restore media;
- production latency, availability, security, or compliance;
- memory coherence, LLM behavior, portability, external demand, natural-person identity, consciousness, or subjective continuity.
