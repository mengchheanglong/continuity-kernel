# T4R Corrective Experiment Plan

This plan is specification work only. Do not implement T4R until the preflight and this plan are independently reviewed, committed, pushed, and separately approved in Mission Control.

Goal: correct original T4's bidirectional IPC privacy and missing evidence without changing the original `T4_INCOMPLETE_AT_BOUND` decision.

## Task 1: Review and freeze T4R planning

**Objective:** Make the corrective scope immutable before executable work.

**Files in this specification task:**

- Create: `docs/architecture/t4r-preflight.md`
- Create: `docs/plans/2026-07-12-t4r-corrective-experiment-plan.md`

**Validation now:**

```bash
python -c "from pathlib import Path; ps=[Path('docs/architecture/t4r-preflight.md'),Path('docs/plans/2026-07-12-t4r-corrective-experiment-plan.md')]; bad=[f'{p}:{n}' for p in ps for n,line in enumerate(p.read_text(encoding='utf-8').splitlines(),1) if line != line.rstrip()]; assert not bad,bad"
git status --short --untracked-files=all -- docs/architecture/t4r-preflight.md docs/plans/2026-07-12-t4r-corrective-experiment-plan.md
git add docs/architecture/t4r-preflight.md docs/plans/2026-07-12-t4r-corrective-experiment-plan.md
git diff --cached --check
git diff --cached --name-only
```

Expected: the direct whitespace check passes; pre-stage status shows exactly the two new files; staged whitespace check passes; staged names are exactly the two planning files. Do not use an unstaged `git diff` as evidence for untracked files.

**Later governance:**

1. Obtain independent pre-commit review of the two planning files.
2. Commit and push only these two planning files.
3. Fetch and verify local `HEAD` equals the remote branch.
4. In the sibling research repository, commit a separate Mission Control approval that references the exact planning commit and keeps T5 locked.
5. Do not create a T4R start artifact or edit executable files before that approval commit exists.

## Task 2: Start the T4R clock

**Objective:** Record the immutable clock before executable changes.

**Files after approval only:**

- Create: `artifacts/<UTC-date>-t4r-start.md`

**Start artifact must record:**

- exact UTC timestamp;
- deadline exactly timestamp plus 10 hours;
- current commit;
- clean or explicitly described Git status;
- pushed planning commit;
- sibling Mission Control approval commit;
- production actor line count command and result;
- T4R harness/script caps;
- no-reset rule.

**Commands:**

```bash
git status --short
python -c "from pathlib import Path; ps=[Path('src/actor/deterministic.ts'),Path('src/actor/execute.ts')]; print(sum(1 for p in ps for line in p.read_text(encoding='utf-8').splitlines() if line.strip() and not line.strip().startswith('//')))"
git add artifacts/<UTC-date>-t4r-start.md
git commit -m "test: start T4R corrective experiment"
git push
git fetch origin
git rev-parse HEAD
git rev-parse @{u}
```

Expected: production actor count is `116`; `HEAD` and upstream match before executable edits.

## Task 3: Establish RED for bidirectional IPC privacy

**Objective:** Prove the original T4 child-process harness violates the T4R boundary while production actor code remains unchanged.

**Files after start only:**

- Modify: `tests/restate-actor.test.ts`
- Modify if needed for the failing oracle only: `tests/actor-child.ts`
- Modify if needed for the failing oracle only: `tests/actor-child-runner.ts`

**Frozen test count and names:**

`test:t4` must collect exactly 16 tests: 10 pure tests and 6 integration tests. The 10 pure test names remain unchanged from `docs/architecture/t4r-preflight.md`. The sixth integration test must be:

```text
T4R-V6 proves zero-inbound process-independent deterministic reproduction only, not restart or reacquisition
```

**RED assertions to add before harness correction:**

- parent-to-child IPC send count is exactly `0`;
- source/controller evidence proves zero parent sends, and the child's fixed fail-closed inbound-message path is not triggered;
- child computes from the shared immutable test fixture module only;
- parent captures actual `ChildProcess.spawnargs`, not a reconstructed argv list;
- actor child receives an explicitly empty environment object and persisted evidence records a zero own-key count;
- stdout and stderr are empty after spawn and proposal receipt, then remain empty after the child `close` event confirms stdio closure;
- child sends exactly one IPC message;
- child-to-parent IPC keys are exactly `type`, `commandId`, `proposalDigest`;
- no launch, process, IPC, stdout, stderr, or error evidence contains fixture payload reference, authorization grant, request hash, full observation, request body, DB URL, password, token, deployment URI, host address, inherited environment key/value, or raw subprocess output in persisted artifacts.

**Command:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/restate-actor.test.ts -t "T4R-V6" --no-file-parallelism --bail=1
```

Expected RED: the focused test fails because the existing harness sends an observation over parent-to-child IPC. The failure must occur before any production actor source change.

**Checkpoint:**

1. Record decisive RED output in a dated artifact.
2. Obtain independent RED review.
3. Commit and push the RED-only changes and RED artifact.
4. Fetch and verify local/remote equality before GREEN work.

## Task 4: Turn T4R actor privacy GREEN

**Objective:** Correct the process-loss harness without weakening actor semantics.

**Files allowed for GREEN:**

- Modify: `tests/actor-child.ts`
- Modify: `tests/actor-child-runner.ts`
- Modify: `tests/restate-actor.test.ts`
- Create only if needed for immutable fixture separation: `tests/actor-child-fixture.ts`

If any production file is needed, stop for review unless the RED failure proves a production actor defect.

**Implementation rules:**

- parent launches the child with non-semantic runner argv and an explicitly empty environment object;
- parent never calls `child.send`;
- child imports the immutable test-only fixture module directly;
- child has a fixed data-free fail-closed path if any inbound IPC message arrives;
- child computes the proposal and sends exactly one sanitized proposal message;
- child exits or can be killed deterministically after proposal;
- stdout/stderr capture is bounded and rechecked after the child `close` event;
- all original T4 integration semantics stay intact.

**Commands:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:t4
python -c "from pathlib import Path; ps=[Path('src/actor/deterministic.ts'),Path('src/actor/execute.ts')]; print(sum(1 for p in ps for line in p.read_text(encoding='utf-8').splitlines() if line.strip() and not line.strip().startswith('//')))"
git diff --unified=0 <T4R_START_BASE> -- tests/actor-child.ts tests/actor-child-runner.ts tests/restate-actor.test.ts tests/actor-child-fixture.ts | python -c "import sys; print(sum(1 for line in sys.stdin if line.startswith('+') and not line.startswith('+++') and line[1:].strip() and not line[1:].lstrip().startswith('//')))"
```

Expected GREEN: `test:t4` reports exactly 16 passed; production actor count remains `116`; additive harness count is at or below `120`.

**Checkpoint:** focused GREEN privacy/code review, commit, push, fetch, and local/remote equality. This is not the final security/spec review, which occurs only after metrics and aggregate verification exist.

## Task 5: Add and verify T4R metrics

**Objective:** Produce required local synthetic measurements without leaking semantic or private material.

**Files:**

- Create: `scripts/t4r-metrics.ts`
- Modify: `package.json`
- Create during run: `artifacts/<UTC-date>-t4r-metrics.json`

**Package script:**

```json
"measure:t4r": "tsx scripts/t4r-metrics.ts"
```

**Required measurements:**

1. pure proposal evaluation latency, exactly 5 samples;
2. deterministic repeat equality result with exactly 5 timing samples;
3. accepted consequence completion with exactly 1 sample;
4. duplicate consequence completion with two distinct Restate workflow IDs and exactly 1 sample;
5. stale rejection completion with exactly 1 sample;
6. process-spawn-to-reproduced-proposal duration with exactly 1 sample.

Each numeric class must write `rawMs`, `minMs`, `medianMs`, and `maxMs`. Harness-inclusive timings must say so. Reuse focused verified vectors with opt-in fixed-prefix numeric-only markers; do not reimplement durable semantics in the metrics script. Parse only numeric markers and never persist captured test output. The actor child still receives an empty environment. The script must enforce hard outer timeouts, kill/wait subprocesses, bound stdout/stderr capture, verify cleanup, and avoid final artifact creation after partial failure. `sourceCommit` is the pushed T4R GREEN checkpoint used for measurement.

**Commands:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run measure:t4r
python -c "from pathlib import Path; p=Path('scripts/t4r-metrics.ts'); print(sum(1 for line in p.read_text(encoding='utf-8').splitlines() if line.strip() and not line.strip().startswith('//')))"
if rg -n --fixed-strings -e "payload:test:attachment-001" -e "grant:test:case-001:owner-001" -e "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY" -e "OyMGgOGM7dluoFBHe1yUrEdnYb85_c7bV-sOTJYyGjU" -e "postgres://" -e "CK_RESTATE_DEPLOYMENT_URI" artifacts/<UTC-date>-t4r-metrics.json; then echo T4R_METRICS_FORBIDDEN_VALUE; exit 1; fi
```

The fixed-string scan is supplemental only. Run this strict external schema/string validator as the authoritative artifact boundary check:

```bash
T4R_METRICS=artifacts/<UTC-date>-t4r-metrics.json python - <<'PY'
import json, os, re
from pathlib import Path
p=Path(os.environ['T4R_METRICS']); raw=p.read_text(encoding='utf-8'); d=json.loads(raw)
assert set(d)=={'schemaVersion','experiment','recordedAt','sourceCommit','environment','measurements','privacyScan','cleanup','limitations'}
assert d['schemaVersion']==1 and d['experiment']=='T4R'
assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z',d['recordedAt'])
assert re.fullmatch(r'[0-9a-f]{40}',d['sourceCommit'])
assert set(d['environment'])=={'node','pnpm','restateServer','postgres'}
for value in d['environment'].values(): assert isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9._ -]{1,64}',value)
names={'pureProposalEvaluation','deterministicRepeatEquality','acceptedConsequenceCompletion','duplicateConsequenceCompletion','staleRejectionCompletion','processSpawnToReproducedProposal'}
assert set(d['measurements'])==names
for name,m in d['measurements'].items():
    allowed={'harnessInclusive','rawMs','minMs','medianMs','maxMs'} | ({'equal'} if name=='deterministicRepeatEquality' else set()) | ({'distinctWorkflowIds'} if name=='duplicateConsequenceCompletion' else set())
    assert set(m)==allowed and isinstance(m['rawMs'],list) and m['rawMs']
    assert all(isinstance(x,(int,float)) and not isinstance(x,bool) and x>=0 for x in m['rawMs'])
    assert m['minMs']==min(m['rawMs']) and m['maxMs']==max(m['rawMs'])
    s=sorted(m['rawMs']); n=len(s); median=s[n//2] if n%2 else (s[n//2-1]+s[n//2])/2
    assert m['medianMs']==median and isinstance(m['harnessInclusive'],bool)
assert len(d['measurements']['pureProposalEvaluation']['rawMs'])==5
assert len(d['measurements']['deterministicRepeatEquality']['rawMs'])==5 and d['measurements']['deterministicRepeatEquality']['equal'] is True
for name in names-{'pureProposalEvaluation','deterministicRepeatEquality'}: assert len(d['measurements'][name]['rawMs'])==1
assert d['measurements']['duplicateConsequenceCompletion']['distinctWorkflowIds'] is True
assert set(d['privacyScan'])=={'artifactForbiddenMatches','stdoutCapturedBytesPersisted','stderrCapturedBytesPersisted'} and all(v==0 for v in d['privacyScan'].values())
assert set(d['cleanup'])=={'actorChildren','workers','datasourceBackends','advisoryLocks'} and all(v==0 for v in d['cleanup'].values())
assert d['limitations']==['local synthetic measurements only','not a production SLO']
for token in ['payloadRef','authorizationGrant','namespaceId','caseId','actorId','commandId','requestHash','proposalDigest','postgres://','http://','https://','CK_RESTATE_DEPLOYMENT_URI','rawOutput','password','token']:
    assert token not in raw, token
PY
```

Expected: metrics script succeeds; metrics script count is at or below `320`; both supplemental fixed-string and authoritative strict-schema/string scans pass.

**Checkpoint:** review, commit, push, fetch, and equality.

## Task 6: Run final aggregate verification

**Objective:** Confirm T4R correction, Gate-D regression, static checks, cleanup, allowlist, and privacy before decision.

**Commands:**

```bash
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:t4
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm run test:gate-d
pnpm run measure:t4r
CK_RESTATE_DEPLOYMENT_URI=http://<verified-host-ip>:9080 pnpm exec vitest run tests/deterministic-actor.test.ts tests/restate-actor.test.ts --no-file-parallelism --reporter=json --outputFile="$TEMP/t4r-tests.json"
T4R_TEST_JSON="$TEMP/t4r-tests.json" python - <<'PY'
import json, os
d=json.load(open(os.environ['T4R_TEST_JSON'],encoding='utf-8'))
a=[x for f in d['testResults'] for x in f['assertionResults']]
expected={
'selects the exact deterministic proposal fixture',
'repeats exactly after a real delay without changing canonical identity',
'rejects an unsupported observation schema version with a fixed data-free code',
'rejects an unsupported actor rule version with a fixed data-free code',
'rejects malformed or undeclared representations as schema errors',
'rejects declared actor and grant-actor mismatch as local consistency only',
'rejects a non-open case locally with a fixed data-free code',
'rejects undeclared action and resolution values with distinct fixed codes',
'rejects semantic world time after the commitment deadline',
'submits nothing for every executeObservation V2A local rejection category',
'proves exact trusted observation provenance and independently denies every authority mismatch',
'T4R-V2B preserves exact authoritative authorization rejections in isolated subcases',
'T4R-V3 records one accepted causal trace consistently across every available surface',
'T4R-V4 returns the same stored acceptance for duplicate proposals on distinct workflows',
'T4R-V5 rejects a stale proposal after one exact competing transition',
'T4R-V6 proves zero-inbound process-independent deterministic reproduction only, not restart or reacquisition',
}
actual=[x['title'] for x in a]
assert len(actual)==16 and len(set(actual))==16,(len(actual),actual)
assert set(actual)==expected,{'missing':sorted(expected-set(actual)),'extra':sorted(set(actual)-expected)}
assert all(x['status']=='passed' for x in a)
PY
pnpm run typecheck
pnpm run lint
pnpm run build
docker compose config --quiet
git diff --check
python -c "from pathlib import Path; ps=[Path('src/actor/deterministic.ts'),Path('src/actor/execute.ts')]; print(sum(1 for p in ps for line in p.read_text(encoding='utf-8').splitlines() if line.strip() and not line.strip().startswith('//')))"
python -c "from pathlib import Path; p=Path('scripts/t4r-metrics.ts'); print(sum(1 for line in p.read_text(encoding='utf-8').splitlines() if line.strip() and not line.strip().startswith('//')))"
git diff --name-only <T4R_START_BASE>..HEAD
```

Expected:

- `test:t4`: 16/16;
- `test:gate-d`: 105/105;
- JSON reporter extraction confirms exactly 10 pure and 6 frozen integration titles, all passed;
- typecheck, lint, build, Compose config, and diff check pass;
- production actor line count at or below 140, expected 116;
- metrics script count at or below 320;
- cleanup evidence shows zero actor children, workers, datasource backends, and advisory locks;
- changed files are limited to the approved T4R allowlist;
- no metric artifact or evidence leaks forbidden values.

Changed-file allowlist for implementation phase:

```text
artifacts/<UTC-date>-t4r-start.md
artifacts/<UTC-date>-t4r-red.md
artifacts/<UTC-date>-t4r-metrics.json
artifacts/<UTC-date>-t4r-final.md
package.json
scripts/t4r-metrics.ts
tests/actor-child.ts
tests/actor-child-runner.ts
tests/actor-child-fixture.ts
tests/restate-actor.test.ts
```

If any other file changes, stop and review before proceeding.

## Task 7: Final decision and stop

**Objective:** Record the T4R outcome without opening later gates.

Before creating the final artifact:

1. obtain independent security/spec review of the final code, tests, metrics script, generated metrics artifact, scans, cleanup, and aggregate evidence;
2. repair any blocker and rerun every affected check;
3. obtain independent final review of the resulting final tree and evidence;
4. verify pre-decision local/remote equality;
5. only then create the conditional final decision artifact.

**Files:**

- Create: `artifacts/<UTC-date>-t4r-final.md`

**Final artifact must include:**

- exact start and deadline;
- exact elapsed time;
- baseline and final commits;
- RED evidence summary;
- GREEN evidence summary;
- metric artifact path and schema version;
- exact test counts;
- line counts;
- privacy scan commands and decisive output;
- cleanup evidence;
- independent security/spec review result;
- independent final review result;
- pre-decision local/remote equality proof;
- explicit statement that the decision becomes effective only after the final decision commit is pushed, fetched, and proven equal before the deadline;
- unproven boundaries;
- one decision.

**Allowed decisions:**

```text
T4R_PASSES_CORRECTION
T4R_REVISE
T4R_INCONCLUSIVE
T4R_INCOMPLETE_AT_BOUND
```

Commit, push, fetch, and verify equality before the deadline. Capture post-commit equality in execution evidence and the final report; do not claim inside the uncommitted artifact that its future commit has already been pushed. If any required review, metric, test, scan, cleanup, push, fetch, or equality proof is missing at the deadline, the conditional pass never becomes effective and the recorded outcome is `T4R_INCOMPLETE_AT_BOUND`.

A green test suite cannot override a contract failure. T4R pass does not alter original T4, does not promote the consumer gate, and does not open T5.

## Unresolved design risks

- The corrected fixture proves only one immutable synthetic recomputation path.
- The child imports fixture data from source, so T4R is not an observation service or production privacy proof.
- Metrics are local synthetic timings, not SLOs.
- Review and push/equality work are inside the 10-hour bound and may dominate the schedule.
- Any unexpected production actor change would require a stricter review because the intended correction is harness-only.
