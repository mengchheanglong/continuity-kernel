# Continuity Kernel — Agent Routing

## Startup order

1. Read `README.md`.
2. Read `docs/research-question.md` and `docs/non-claims.md`.
3. Read `docs/threat-and-privacy-boundary.md` and `docs/invariants.md`.
4. Read `docs/conformance-vectors.md` and `docs/implementation-matrix.md`.
5. Read `docs/architecture/preflight-decisions.md`.
6. Read `artifacts/2026-07-11-t2-final.md` and `docs/architecture/t2b-preflight.md`.
7. For mission authority or research evidence, read the sibling files listed in `README.md`.

## Current phase

```text
T0 DOCUMENTATION COMPLETE — 66fe253
T1 CONTRACT/VECTORS/MATRIX FROZEN
T2 COMPLETE — DBOS_REJECTED_PENDING_ALTERNATIVE — 6ceb5b1
T2B COMPLETE — RESTATE_PASSES_V4
CUSTOM PERSISTENCE PARKED
```

The T2 decision is `artifacts/2026-07-11-t2-final.md`. The T2b preflight is `docs/architecture/t2b-preflight.md`; the completed evidence and decision are `artifacts/2026-07-11-t2b-final.md`. Restate/PostgreSQL advances to Gate D, where all six frozen vectors must run before foundation promotion. Do not alter frozen expected outcomes to make any incumbent pass.

## Canonical rules

- AI may propose; only deterministic validation and the selected transaction path may change canonical state.
- DBOS workflow IDs deduplicate execution but do not prove request equality.
- Both the server boundary and canonical PostgreSQL transaction compare the frozen `requestHashEnvelopeV1` hash.
- Optional payload bytes and plaintext-derived payload hashes never enter durable DBOS inputs, outputs, errors, attributes, messages, events, streams, transaction results, logs, or traces.
- The runtime role cannot own or directly mutate canonical tables; it writes only through the approved canonical-commit function.
- A caller-only timeout is not a retry bound. The frozen watchdog/cancellation/reconciliation procedure applies.
- Custom persistence is forbidden unless the same intrinsic mission-defining gap survives the approved bounded alternative-incumbent check.

## Scope

Foundation work is limited to a synthetic customer-case handoff, the ten invariants, six vectors, exact request/digest fixtures, the DBOS/PostgreSQL incumbent, and evidence artifacts.

Do not add LLM, memory retrieval, frontend, identity portability, multi-agent world, Unity, 3D, robotics, BCI, or real personal data.

## Editing and verification

- Keep specification changes synchronized with Mission Control before implementation.
- Freeze expected outcomes before adapting code to a framework.
- Record commands and decisive output in dated artifacts.
- Never weaken a vector to make the incumbent pass.
- Do not commit, push, or rewrite history unless the user asks.
