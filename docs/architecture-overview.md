# Continuity Kernel — Architecture Overview

**Status:** packaging diagram for outsiders  
**Not:** a product deployment architecture  
**Not:** an Agent OS design (that remains a separate concept note in research)

## One diagram

```text
                        ┌─────────────────────────┐
                        │  Test parent / consumer │
                        │  (synthetic fixtures)   │
                        └────────────┬────────────┘
                                     │ submitCommand(commandId, request, workflowKey)
                                     ▼
                        ┌─────────────────────────┐
                        │ Restate ingress/worker  │
                        │ operational durability  │
                        └────────────┬────────────┘
                                     │ official transaction path
                                     ▼
                        ┌─────────────────────────┐
                        │ continuity.commit_command│
                        │ SECURITY DEFINER (PG)    │
                        └────────────┬────────────┘
                                     │
               ┌─────────────────────┼─────────────────────┐
               ▼                     ▼                     ▼
      command_receipts        accepted_history           cases
      (idempotency)           (canonical facts)     (versioned state)
               │
               ▼
        decision_audit (privacy-limited accepted/rejected decisions)

Optional payload bytes ──X──▶ durable runtime history
Optional payload ref   ─────▶ may appear as opaque handle only
```

## Trust split

| Layer | Authority | Role |
|---|---|---|
| Agent / actor / LLM | none over truth | may propose only |
| Restate workflow keys | operational | execution durability, not semantic equality |
| PostgreSQL receipts + commit function | semantic | authorization, hash compare, version, accept/reject |
| Test parent | evidence | starts/kills workers, checks outcomes, records artifacts |

## Core rule

```text
Canonical state changes only through deterministic validation and the selected transaction path.
```

## Frozen property map

| Vector family | Question |
|---|---|
| V1 Authz | Can out-of-scope actors mutate canonical state? |
| V2 Idempotency | Do commandId + request hash prevent double-apply / false equivalence? |
| V3 Version conflict | Can stale writers fork case state? |
| V4 Recovery | After external kill, is commitment/recovery behavior defined and equivalent? |
| V5 Digests/versions | Is reconstruction deterministic and fail-closed on unsupported versions? |
| V6 Payload separation | Can optional content be absent/erased without breaking required history? |

## Historical incumbent comparison

```text
DBOS path     → rejected for frozen V4 pre-commit recovery boundary
Restate path  → accepted foundation direction
Custom store  → parked
```

## What is intentionally missing

This diagram does not include:

- public multi-tenant SaaS edge;
- LLM memory product;
- camera/OS event bus;
- identity wallet / DID stack;
- Unity/3D adapters.

Those are either locked, parked, or separate concept work.

## Related sealed artifacts

- Gate D final: `artifacts/2026-07-11-gate-d-final.md`
- T4 bound review: `artifacts/2026-07-12-t4-bound-review.md`
- T4R final: `artifacts/2026-07-12-t4r-final.md`
- Consumer review: `artifacts/2026-07-12-consumer-gate-review.md`
