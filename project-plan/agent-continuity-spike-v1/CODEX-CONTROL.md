# Codex Control — Agent Continuity Spike v1

**STATUS: SEALED CONTROL — WORKER RELEASE REQUIRES IMMUTABLE START**
**Authority revision:** 2

Codex OAuth is control/review/DevOps-test-ship. Hermes retains final authority and evidence verification. Grok 4.5 implements only after sealed remote-equal authority and immutable start.

## Exact worker allowlist

```text
package.json
examples/agent-continuity-spike-v1/README.md
examples/agent-continuity-spike-v1/runtime.ts
examples/agent-continuity-spike-v1/run.ts
tests/agent-continuity-spike-v1.test.ts
```

Reject any other implementation change. Existing v0 files, core, migrations, Restate client/worker, fixtures, authority, evidence, and state are control-owned or frozen.

## Required controls

- Enforce test-first RED→GREEN vertical slices with exact worker transcript evidence.
- Verify exact v1 bytes/digests/IDs/request hash.
- Verify phase A receives accepted result, reports it, and blocks in an unbounded pre-checkpoint barrier. The parent must verify checkpoint absence and then issue `child.kill("SIGKILL")`; require parent-observed `{exitCode:null, signal:"SIGKILL"}`. Self-termination is forbidden.
- Verify phase B is a distinct PID and performs one completed-invocation query, one attach, zero adapter calls, zero submit calls.
- PostgreSQL is control-plane evidence only; phase B cannot open it.
- Verify exact topology, no new dependency/provider/credential read/URL, minimal child environments.
- Verify byte-level sentinel scans and cleanup ordering.
- Run exact commands 1–6; require independent source `APPROVE`.
- Commit/push/fetch exact implementation, record 40-hex source, require clean remote equality.
- Permit command 7 exactly once before immutable deadline; never retry it.
- Compose all-only JSON only from real outputs after cleanup.

## Final gates

Any source mutation after source review requires commands 1–6 and review again. Any authority mutation after authority review requires a new numbered authority revision and review again. A command-7 failure is final for the attempt and is not rerun.
