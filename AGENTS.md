# Continuity Kernel — Agent Routing

## Startup order

1. Read `README.md`.
2. Read `docs/public-safe-overview.md` and `docs/non-claims.md`.
3. Read `docs/threat-and-privacy-boundary.md` and `docs/invariants.md`.
4. Read `docs/conformance-vectors.md`.
5. Treat `docs/implementation-matrix.md` as **frozen T2 historical evidence**, not current-status prose.
6. Read sealed decisions in this order:
   1. `artifacts/2026-07-11-gate-d-final.md`
   2. `artifacts/2026-07-12-t4-bound-review.md`
   3. `artifacts/2026-07-12-t4r-final.md`
   4. `artifacts/2026-07-12-consumer-gate-review.md`
7. For mission authority or research evidence, read the sibling files listed in `README.md`.

## Current phase

```text
T0 DOCUMENTATION COMPLETE
T1 CONTRACT/VECTORS/MATRIX FROZEN
T2 COMPLETE — DBOS_REJECTED_PENDING_ALTERNATIVE
T2B COMPLETE — RESTATE_PASSES_V4
GATE D COMPLETE — GATE_D_PASSES_FOUNDATION_V3
T4 INCOMPLETE AT ORIGINAL BOUND — PRIOR PASS SUPERSEDED
T4R COMPLETE — T4R_PASSES_CORRECTION
CONSUMER GATE CANDIDATE ONLY — PRIOR PASS SUPERSEDED
CUSTOM PERSISTENCE PARKED
T5 AND LATER LOCKED
EXTERNAL DEMAND NOT ESTABLISHED
```

Latest sealed engineering authority:

```text
artifacts/2026-07-12-t4r-final.md
```

Gate D remains green. Original T4 remains `T4_INCOMPLETE_AT_BOUND`. T4R is the correction that passed privacy/process requirements. Consumer/runbook remain candidate work. Custom persistence remains parked. T5 is locked. External demand is not claimed.

## What agents may do now

Allowed without a new Mission Control expansion decision:

- documentation packaging for outsider understanding;
- runbook/doctor clarity;
- listing publication blockers;
- verifying already-sealed tests when the environment is available.

Forbidden without a new sealed decision:

- T5 memory / LLM multi-agent / inspectors / 3D;
- custom persistence;
- consumer promotion;
- public visibility change without privacy review;
- demand claims;
- weakening frozen vectors;
- rewriting frozen historical artifacts such as the T2 implementation matrix in place.

## Canonical rules

- AI may propose; only deterministic validation and the selected transaction path may change canonical state.
- DBOS workflow IDs deduplicate execution but do not prove request equality.
- Restate workflow keys are operational only; PostgreSQL receipts remain semantic authority.
- Both the server boundary and canonical PostgreSQL transaction compare the frozen request-hash envelope.
- Optional payload bytes and plaintext-derived payload hashes never enter durable runtime inputs, outputs, errors, attributes, messages, events, streams, transaction results, logs, or traces.
- The runtime role cannot own or directly mutate canonical tables; it writes only through the approved canonical-commit function.
- A caller-only timeout is not a retry bound. The frozen watchdog/cancellation/reconciliation procedure applies.
- Actor local checks are representation/declared-scope ergonomics only; they are never authorization.
- Custom persistence is forbidden unless the same intrinsic mission-defining gap survives the approved bounded alternative-incumbent check.

## Scope

Foundation and T4/T4R work is limited to a synthetic customer-case handoff, the ten invariants, six foundation vectors, the T4/T4R actor vectors, exact request/digest fixtures, the Restate/PostgreSQL surviving direction, the historical DBOS counterexample, and evidence artifacts.

Do not add LLM product memory, frontend product, identity portability product, multi-agent world, Unity, 3D, robotics, BCI, or real personal data.

## Editing and verification

- Keep specification changes synchronized with Mission Control before implementation.
- Freeze expected outcomes before adapting code to a framework.
- Record commands and decisive output in dated artifacts.
- Never weaken a vector to make an incumbent or actor path pass.
- Do not commit, push, or rewrite history unless the user asks.
