# Grok 4.5 Worker — Agent Continuity Spike v0

**STATUS: BLOCKED UNTIL CODEX RELEASES AFTER SEALED AUTHORITY + START**

## Worker identity

```text
provider: xai-oauth
model: grok-4.5
role: implementation worker only
```

## Read first after release

- sibling research experiment `PREFLIGHT.md` revision 4;
- sibling research experiment `PLAN.md` revision 4;
- this repo `AGENTS.md`;
- `project-plan/agent-continuity-spike-v0/CODEX-CONTROL.md`;
- `examples/reference-consumer/run.ts`;
- `tests/db-fixture.ts`;
- `tests/restate-worker.ts`;
- `src/alternative/restate/client.ts`.

## Allowed edits only

```text
examples/agent-continuity-spike/README.md
examples/agent-continuity-spike/runtime.ts
examples/agent-continuity-spike/run.ts
tests/agent-continuity-spike.test.ts
package.json
```

Do not edit any other file. Do not commit or push.

## Required TDD sequence

Implement r4 in vertical slices. For each slice:

1. write the minimal test first;
2. run the exact targeted test and record the expected behavioral failure;
3. write only enough implementation to pass;
4. rerun targeted test to GREEN;
5. keep previous tests green.

Targeted command:

```bash
pnpm exec vitest run tests/agent-continuity-spike.test.ts --no-file-parallelism --bail=1
```

## Frozen implementation requirements

- exact `idleTargetMs=1000`, `pollCadenceMs=50`, measured duration `1000..1250`;
- exact observation identity and command-ID derivation from r4;
- exact scripted command body and fixed request hash `jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY`;
- exact working-set and checkpoint schemas, no extras, <=1024 bytes;
- exact local topology only; `CK_RESTATE_DEPLOYMENT_URI` must equal `http://host.docker.internal:9080` before adapter invocation;
- provider-free scripted adapter only; runtime reads no credentials and calls no model;
- first consequence accepted/`ACCEPTED`/version `4`;
- duplicate and orderly reconstructed identical observation produce no extra adapter call or consequence;
- one receipt and one accepted history row for frozen command;
- captured child stdout/stderr only in bounded memory, sentinel scanned, arrays cleared to zero bytes;
- worker/DB connection and temp watched/checkpoint state removed before runner returns success;
- no evidence artifact writing—the Codex control lane owns evidence after verification.

## Forbidden

- no DeepSeek API or OpenCode;
- no provider SDK/import/endpoint/credential read;
- no added dependency;
- no core/migration/existing-test/frozen-artifact changes;
- no raw sentinel output or persistence;
- no abrupt-crash or general exactly-once claim;
- no T5, custom persistence, full Agent OS, UI, camera, microphone, screen capture, messaging, external network, publication, or outreach.

## Worker final report

Return in the model response only:

1. changed files;
2. each RED command and exact expected failure;
3. each GREEN command and result;
4. any blocker or deviation;
5. confirmation that no commit/push occurred.

Do not write a report file.
