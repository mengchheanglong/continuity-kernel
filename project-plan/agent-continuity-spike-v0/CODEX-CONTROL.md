# Codex Control — Agent Continuity Spike v0

**Status:** implementation blocked until revision-4 sealed authority and immutable start are remote-equal.

## Role

Codex OAuth is orchestrator, task manager, reviewer, and DevOps/test/ship controller. Grok 4.5 via xAI OAuth (`xai-oauth`, `grok-4.5`) implements. Hermes independently verifies.

## Read first

- research experiment `PREFLIGHT.md` r4, `PLAN.md` r4, `AUTHORITY-DECISION.md`, `START.md`;
- Kernel `AGENTS.md`;
- `examples/reference-consumer/run.ts`;
- `tests/db-fixture.ts`;
- `tests/restate-worker.ts`;
- `src/alternative/restate/client.ts`.

## Control duties

1. Verify authority/start commits are remote-equal and immutable clock is live.
2. Verify both repos have no unrelated dirty paths.
3. Release `GROK-WORKER.md` only to provider `xai-oauth`, model `grok-4.5`.
4. Reject any Grok edit outside its five-file allowlist.
5. Require actual RED before implementation for each TDD slice.
6. Enforce exact topology:
   - `127.0.0.1:55432`;
   - `127.0.0.1:9070`;
   - `127.0.0.1:8080`;
   - `http://host.docker.internal:9080`.
7. Enforce exact command body and request hash from r4.
8. Run static provider/dependency/network proof.
9. Direct the first six exact commands in order.
10. After Hermes verifies scope/diff/evidence, commit and push the exact implementation source; fetch and remote equality plus a clean worktree must pass.
11. Record that checked-out 40-character implementation commit as `sourceCommit`; permit no source edit before the sole seventh/final aggregate command.
12. Permit the seventh/final aggregate command exactly once only after all prior gates pass.
13. Verify worker/log/temp/DB cleanup and zero captured-buffer bytes.
14. Write and schema-validate final JSON only after cleanup and all seven commands.
15. Classify without weakening PASS/FAIL/INCONCLUSIVE.

## Static proof

Mechanically fail if the Grok diff adds:

- provider imports/SDK/endpoints or credential reads;
- any hostname/IP/URL outside r4 topology;
- any package dependency;
- any file outside worker allowlist;
- raw sentinel persistence/logging;
- core, migration, existing-test, or frozen-artifact edits.

## Forbidden

- no DeepSeek API, OpenCode, substitute worker, or direct provider inside spike runtime;
- no T5, custom persistence, full Agent OS, publication, outreach, or demand claim;
- no authority changes by Grok;
- no commit/push by Grok;
- no automatic follow-on.
