# Reference consumer

A thin, synthetic second caller of the public Continuity Kernel commit path.

## Purpose

Prove that something **outside** the frozen Vitest suite depends on:

- out-of-scope authorization rejection;
- accepted resolution through Restate → PostgreSQL;
- duplicate command idempotency;
- expected-version conflict;
- an alternate resolution (`cancelled`) on a fresh case.

If those outcomes weaken, this consumer fails.

## Non-goals

- Not a product UI, memory system, LLM, or Identity Vault.
- Not T5.
- Not evidence of external demand or natural-person identity.
- Not a production observation service.

## Run

Prerequisites (see `docs/runbook.md`):

```bash
pnpm run db:up
pnpm run db:setup
docker compose up -d --wait restate
pnpm run doctor
```

Then:

```bash
# Use a host IP that the Restate container can reach for the Node endpoint :9080
export CK_RESTATE_DEPLOYMENT_URI=http://<host-ip>:9080
pnpm run example:consumer
```

On Windows PowerShell:

```powershell
$env:CK_RESTATE_DEPLOYMENT_URI='http://172.23.32.1:9080'
pnpm run example:consumer
```

Expected: five PASS lines and exit code 0.
