# PRV1 spikes (G2/G3)

Local synthetic, provider-free throwaway spikes for Continuity Kernel production-readiness validation (PRV1).

## Scope

- **G2** (`tests/prv1-g2-*.ts`): lost-acknowledgement reconciliation against a **parent-owned fake broker** with distinct forked children and parent kill barriers.
- **G3** (`tests/prv1-g3-*.ts`): append-only **DecisionArtifact** model kept separate from **CanonicalExecutionReceipt**, including refusal, confirmation binding, auth principal modes, delegation provenance, and fail-closed checks.

## Non-claims

- Local synthetic only.
- No real provider, payment, or external broker integration.
- No production service implementation.
- No security, compliance, or certification claim.
- No arbitrary external exactly-once guarantee.
- G3 provenance link hashes prove **structural chain integrity** for synthetic verification only. They are **not** authenticity against an attacker who can rewrite and recompute the entire chain (no external signature or trust anchor in this spike).
- No T5 / memory product / Agent OS / custom-persistence unlock.
- No demand, deploy, or build authorization by itself.

## Run

```bash
pnpm exec vitest run tests/prv1-g2-lost-ack.test.ts tests/prv1-g3-decision-artifact.test.ts --no-file-parallelism --bail=1
pnpm run typecheck
pnpm exec eslint tests/prv1-g2-lost-ack.test.ts tests/prv1-g2-child.ts tests/prv1-g2-model.ts tests/prv1-g3-decision-artifact.test.ts tests/prv1-g3-model.ts
```

## Layout

| Path | Role |
| --- | --- |
| `tests/prv1-g2-model.ts` | Fake broker, claim store, reconciliation agent |
| `tests/prv1-g2-child.ts` | Forked IPC child (no finally checkpoint) |
| `tests/prv1-g2-lost-ack.test.ts` | G2 cases + unsafe TTL-reclaim negative control |
| `tests/prv1-g3-model.ts` | Decision artifact ledger + execution receipt store |
| `tests/prv1-g3-decision-artifact.test.ts` | G3 decision-semantics cases |
| `spikes/prv1/README.md` | This note |

## Authority

Mission Control experiment: `production-readiness-validation-prv1` (PRV1). Hermes verifies; Codex controls; worker implements throwaway tests only.
