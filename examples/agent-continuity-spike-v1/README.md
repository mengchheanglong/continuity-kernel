# Agent Continuity Spike v1

Provider-free scripted-adapter child experiment under `continuity-kernel-v0`.

## Purpose

After a provider-free agent process receives one accepted canonical commit result but is force-terminated before any local checkpoint write, a distinct replacement process derives the same deterministic command identity, recovers the completed Restate invocation, verifies it against PostgreSQL canonical truth (parent-only), writes the privacy-safe checkpoint, and suppresses both a second adapter invocation and a second canonical consequence.

## Non-goals

- Not machine reboot, PostgreSQL/Restate crash, or interruption before/during commit.
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
pnpm exec vitest run tests/agent-continuity-spike-v1.test.ts --no-file-parallelism --bail=1
```

Aggregate example (Codex control lane permits this once after prior gates):

```bash
pnpm run example:agent-continuity-spike-v1
```

## Ownership

Grok worker may edit only this example, its test, and the package script entry. Evidence artifacts and authority files are owned by the Codex control lane / Hermes verification.
