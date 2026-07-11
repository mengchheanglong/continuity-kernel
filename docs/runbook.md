# Continuity Kernel — Runnable Harness Runbook

**Audience:** a second engineer (or future you) on a clean machine.  
**Data:** synthetic only.  
**Scope:** contract verification and the thin reference consumer. Not a product deploy guide.

## What this repository is

A research-grade conformance harness for continuity properties (authorization, idempotency, recovery, digests, optional-payload separation) plus one deterministic actor baseline on Restate/PostgreSQL.

Public positioning:

> A research-grade conformance harness for testing continuity properties across stateful agent and simulation runtimes.

## Pins

| Component | Value |
|---|---|
| Node | `>=24.14.0` |
| pnpm | `10.32.1` |
| Restate Server | `1.7.2` (compose image digest) |
| Restate TS SDK/client | `1.15.1` |
| PostgreSQL | compose image digest on port `55432` |

## One-time setup

```bash
pnpm install
pnpm run db:up
pnpm run db:setup
docker compose up -d --wait restate
pnpm run doctor
```

`pnpm run doctor` must report Postgres + Restate Admin + Restate ingress ready. It also prints candidate `CK_RESTATE_DEPLOYMENT_URI` values.

### Windows / Docker Desktop note

Restate runs in Linux containers and must reach the host Node endpoint on port `9080`. If `host.docker.internal` does not resolve to a listening interface, set:

```text
CK_RESTATE_DEPLOYMENT_URI=http://<non-loopback-host-ip>:9080
```

Gate D and T4 evidence on this host used `http://172.23.32.1:9080`.

## Verification packs

Foundation (105 tests):

```bash
export CK_RESTATE_DEPLOYMENT_URI=http://<host-ip>:9080
pnpm run test:gate-d
```

Deterministic actor (16 tests):

```bash
pnpm run test:t4
```

Static:

```bash
pnpm run typecheck
pnpm run lint
pnpm run build
```

## Reference consumer (consumer gate)

```bash
pnpm run example:consumer
```

See `examples/reference-consumer/README.md`. This is the in-repo **second consumer** of the public commit path. It does not open T5.

## Read order for humans

1. `README.md`
2. `docs/non-claims.md`
3. `docs/invariants.md`
4. `docs/conformance-vectors.md`
5. `artifacts/2026-07-11-gate-d-final.md`
6. `artifacts/2026-07-11-t4-final.md`
7. This runbook

## Explicitly out of scope here

LLM, memory product, multi-agent world, Unity/3D, real personal data, custom persistence, consciousness claims.
