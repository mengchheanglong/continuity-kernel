# Continuity Kernel — Runnable Harness Runbook

**Audience:** a second engineer (or future you) on a clean machine.  
**Data:** synthetic only.  
**Scope:** contract verification and the thin reference consumer. Not a product deploy guide.  
**Current sealed status:** Gate D passed; original T4 incomplete at bound; T4R correction passed; consumer candidate only.

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

## One-time setup (~target: 30 minutes on a prepared machine)

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

Gate D and T4/T4R evidence on the founder host used `http://172.23.32.1:9080`.

If Docker Desktop is stopped, doctor will fail with connection refused. That is an environment prerequisite failure, not a continuity-vector failure.

## Verification packs

Foundation (105 tests):

```bash
export CK_RESTATE_DEPLOYMENT_URI=http://<host-ip>:9080
pnpm run test:gate-d
```

Deterministic actor / T4R suite (16 tests):

```bash
pnpm run test:t4
```

Static:

```bash
pnpm run typecheck
pnpm run lint
pnpm run build
```

## Reference consumer (candidate only)

```bash
pnpm run example:consumer
```

See `examples/reference-consumer/README.md`. This is the in-repo **second consumer** of the public commit path. Sealed status remains `CONSUMER_GATE_CANDIDATE_ONLY`. It does not open T5 and does not prove an external consumer.

Known candidate gaps (do not hide them):

- imports test fixture/worker helpers;
- duplicate evidence currently uses a namespace-wide receipt count;
- worker cleanup may time out silently;
- doctor does not yet verify endpoint `:9080`, deployment registration, or container-to-host identity.

## Read order for humans

1. `README.md`
2. `docs/public-safe-overview.md`
3. `docs/architecture-overview.md`
4. `docs/non-claims.md`
5. `docs/invariants.md`
6. `docs/conformance-vectors.md`
7. `artifacts/2026-07-11-gate-d-final.md`
8. `artifacts/2026-07-12-t4-bound-review.md`
9. `artifacts/2026-07-12-t4r-final.md`
10. `artifacts/2026-07-12-consumer-gate-review.md`
11. This runbook
12. `docs/publication-blockers.md`

`artifacts/2026-07-11-t4-final.md` is historical process evidence and is superseded for actor outcome authority by the T4 bound review + T4R final.

`docs/implementation-matrix.md` is frozen T2 historical evidence. Do not treat its “NOT_STARTED” scaffolding language as current project status.

## Explicitly out of scope here

LLM product, memory product, multi-agent world, Unity/3D, real personal data, custom persistence, consciousness claims, demand claims.
