# Grok 4.5 Worker Handoff — Agent Continuity Spike v1

**STATUS: SEALED HANDOFF — DO NOT START UNTIL IMMUTABLE START AND EXPLICIT RELEASE**
**Provider:** `xai-oauth`
**Model:** `grok-4.5`
**Authority revision:** 2

## Task

Implement the exact `PREFLIGHT.md`/`PLAN.md` v1 commit-before-checkpoint interruption vector using strict RED→GREEN TDD.

## Allowed files only

```text
package.json
examples/agent-continuity-spike-v1/README.md
examples/agent-continuity-spike-v1/runtime.ts
examples/agent-continuity-spike-v1/run.ts
tests/agent-continuity-spike-v1.test.ts
```

Do not edit any other file. Do not commit, push, write authority/state/evidence/final decisions, run command 7, call a real model/provider from runtime, read provider credentials, add dependencies, change schema/core/client/worker/v0, or broaden claims.

## TDD contract

For each vertical slice:

1. write the minimal failing test first;
2. run the exact targeted test and capture expected RED reason;
3. write minimal production code;
4. run targeted GREEN;
5. preserve all earlier green tests.

Before production implementation begins, the first v1 targeted run must fail for missing v1 behavior—not syntax, import, or environment error. Report exact RED and final GREEN commands/results.

## Critical semantics

- Phase A agent child invokes scripted adapter once, submits once, receives accepted result, sends `accepted-before-checkpoint` with IPC-send completion, then blocks indefinitely waiting for a `continue-checkpoint` message before checkpoint writer starts.
- Parent receives and validates that barrier, verifies checkpoint absent, never sends `continue-checkpoint`, and only then calls `child.kill("SIGKILL")`. PASS requires Windows parent observation `{exitCode:null, signal:"SIGKILL"}`. Self-termination is forbidden.
- Parent, not phase A, verifies checkpoint absent and canonical/Restate completion present.
- Phase B has a distinct PID and no PostgreSQL access. It derives the same command ID, queries Restate admin exactly once for one completed service/key invocation, attaches exactly once, validates frozen result fields/digest, writes the seven-key checkpoint atomically, and makes zero adapter/submit calls.
- No catch/finally may convert the crash into orderly completion or write a checkpoint in phase A.
- Child envs are minimal allowlists and exclude provider credentials.
- Raw sentinel bytes are temporary-input-only and absent from checkpoint, state, DB-selected rows, logs, and evidence.

If any requirement cannot be implemented inside the five-file allowlist, stop and report the blocker instead of changing scope.
