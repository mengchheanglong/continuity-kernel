# Continuity Kernel — Agent Routing

## Startup order

1. Read `README.md`.
2. Read `docs/research-question.md` and `docs/non-claims.md`.
3. Read `docs/threat-and-privacy-boundary.md` and `docs/invariants.md`.
4. Read `docs/conformance-vectors.md` and `docs/implementation-matrix.md`.
5. Read `docs/architecture/preflight-decisions.md`.
6. Read `artifacts/2026-07-11-gate-d-final.md` for the foundation decision.
7. Read `artifacts/2026-07-12-t4-bound-review.md` for the corrected actor decision.
8. Read `artifacts/2026-07-12-consumer-gate-review.md` for the corrected consumer status.
9. For mission authority or research evidence, read the sibling files listed in `README.md`.

## Current phase

```text
T0 DOCUMENTATION COMPLETE — 66fe253
T1 CONTRACT/VECTORS/MATRIX FROZEN
T2 COMPLETE — DBOS_REJECTED_PENDING_ALTERNATIVE — 6ceb5b1
T2B COMPLETE — RESTATE_PASSES_V4
GATE D COMPLETE — GATE_D_PASSES_FOUNDATION_V3
T4 INCOMPLETE AT ORIGINAL BOUND — PRIOR PASS SUPERSEDED
CONSUMER GATE CANDIDATE ONLY — PRIOR PASS SUPERSEDED
CUSTOM PERSISTENCE PARKED
T5 AND LATER LOCKED
```

The latest authority is `artifacts/2026-07-12-t4-bound-review.md`. Gate D remains green. T4's code is promising and its tests pass, but its original bound closed without satisfying the frozen bidirectional IPC privacy, metrics, review, and push requirements. The consumer/runbook remains candidate work. Custom persistence remains parked, T5 is locked, and external demand is not claimed.

## Canonical rules

- AI may propose; only deterministic validation and the selected transaction path may change canonical state.
- DBOS workflow IDs deduplicate execution but do not prove request equality.
- Restate workflow keys are operational only; PostgreSQL receipts remain semantic authority.
- Both the server boundary and canonical PostgreSQL transaction compare the frozen `requestHashEnvelopeV1` hash.
- Optional payload bytes and plaintext-derived payload hashes never enter durable runtime inputs, outputs, errors, attributes, messages, events, streams, transaction results, logs, or traces.
- The runtime role cannot own or directly mutate canonical tables; it writes only through the approved canonical-commit function.
- A caller-only timeout is not a retry bound. The frozen watchdog/cancellation/reconciliation procedure applies.
- Actor local checks are representation/declared-scope ergonomics only; they are never authorization.
- Custom persistence is forbidden unless the same intrinsic mission-defining gap survives the approved bounded alternative-incumbent check.

## Scope

Foundation and T4 work is limited to a synthetic customer-case handoff, the ten invariants, six foundation vectors, the T4 actor vectors, exact request/digest fixtures, the Restate/PostgreSQL surviving direction, the historical DBOS counterexample, and evidence artifacts.

Do not add LLM, memory retrieval, frontend, identity portability, multi-agent world, Unity, 3D, robotics, BCI, or real personal data.

## Editing and verification

- Keep specification changes synchronized with Mission Control before implementation.
- Freeze expected outcomes before adapting code to a framework.
- Record commands and decisive output in dated artifacts.
- Never weaken a vector to make an incumbent or actor path pass.
- Do not commit, push, or rewrite history unless the user asks.
