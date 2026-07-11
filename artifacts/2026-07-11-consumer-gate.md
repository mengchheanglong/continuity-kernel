# Consumer Gate — Thin Reference Consumer + Runnable Harness

**Decision recorded:** 2026-07-11T18:51:23Z  
**Baseline after T4:** `a3ff8063e16dea9dc7ba764bacc2a43991a28fc4`  
**Authority:** post-T4 improvement path from Mission Control `.active/NEXT.md`

## Decision

```text
CONSUMER_GATE_INTERNAL_PASS
T5_REMAINS_LOCKED
CUSTOM_PERSISTENCE_REMAINS_PARKED
EXTERNAL_DEMAND_NOT_CLAIMED
```

This gate proves an **in-repo second consumer** and **runnable packaging**, not external product demand. T5 is not opened.

## Why this gate exists

After foundation V3 and T4, the next risk was harness maximalism without dependents. The bounded improvement was:

1. external case study, **or**
2. thin second consumer of the public commit path, **or**
3. public runnable harness packaging

This artifact records options **2 + 3**. Option 1 (external interviews) remains open future work and is **not** claimed here.

## Deliverables

| Deliverable | Path |
|---|---|
| Topology doctor | `scripts/doctor.ts` (`pnpm run doctor`) |
| Reference consumer | `examples/reference-consumer/run.ts` (`pnpm run example:consumer`) |
| Consumer README | `examples/reference-consumer/README.md` |
| Stranger runbook | `docs/runbook.md` |
| Lint/type surface | `scripts/**`, `examples/**` included in `tsconfig` / eslint |

## Consumer steps proven

All synthetic; public `submitCommand` only for commits:

| Step | Continuity property exercised | Result |
|---|---|---|
| unauthorized-reject | Authorization (V1-class) | PASS |
| accepted-resolve | Canonical accept + receipt hash | PASS |
| duplicate-idempotent | Conflict-aware idempotency (V2-class) | PASS |
| stale-version-conflict | Expected-version conflict (V3-class) | PASS |
| cancelled-resolution | Second action shape on fresh case | PASS |

**5/5 steps passed.** Weakening authz, receipt authority, or expected-version conflict would fail this consumer.

## Verification pack

```text
CK_RESTATE_DEPLOYMENT_URI=http://172.23.32.1:9080

pnpm run typecheck                 PASS
pnpm run lint                      PASS
pnpm run build                     PASS
pnpm run doctor                    3/3 PASS
pnpm run example:consumer          5/5 PASS
```

## Non-claims

- No external users, interviews, or market demand.
- No T5 memory, model adapter, multi-agent world, or UI.
- No custom persistence.
- No natural-person identity or consciousness claim.
- Doctor/consumer are local synthetic tools, not production SLOs.

## Next

1. Optional: external continuity-failure case studies (option 1).
2. Keep T5 locked unless a sealed consumer need for provenance/retention/deletion appears **and** Mission Control approves.
3. Do not revive parked products for spectacle.
