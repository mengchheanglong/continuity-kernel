# Agent Continuity Spike v0

Provider-free scripted-adapter child experiment under `continuity-kernel-v0`.

## Purpose

After one orderly accepted canonical commit and one completed privacy-safe checkpoint, reconstruct a provider-free runtime, re-observe the identical synthetic file state, and suppress a second adapter invocation and canonical consequence.

## Non-goals

- Not abrupt crash recovery or interruption-window testing.
- Not a real LLM, provider SDK, or credentialed model call.
- Not general exactly-once execution claims.
- Not T5, custom persistence, full Agent OS, UI, capture devices, messaging, publication, or outreach.
- Not evidence of external demand.

## Frozen local topology only

```text
PostgreSQL       127.0.0.1:55432
Restate admin    127.0.0.1:9070
Restate ingress  127.0.0.1:8080
Worker callback  http://host.docker.internal:9080
```

`CK_RESTATE_DEPLOYMENT_URI` must equal exactly `http://host.docker.internal:9080`.

## Run

Prerequisites (see `docs/runbook.md` / `pnpm run doctor`):

```bash
pnpm run db:up
pnpm run db:setup
docker compose up -d --wait restate
export CK_RESTATE_DEPLOYMENT_URI=http://host.docker.internal:9080
pnpm run doctor
```

Targeted tests (TDD):

```bash
pnpm exec vitest run tests/agent-continuity-spike.test.ts --no-file-parallelism --bail=1
```

Aggregate example (Codex control lane permits this once after prior gates):

```bash
pnpm run example:agent-continuity-spike
```

## Ownership

Grok worker may edit only this example, its test, and the package script entry. Evidence artifacts and authority files are owned by the Codex control lane / Hermes verification.
