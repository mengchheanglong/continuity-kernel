# Continuity Kernel — Agent Routing

## Startup order

1. Read `README.md`.
2. Read `docs/research-question.md` and `docs/non-claims.md`.
3. Read `docs/threat-and-privacy-boundary.md` and `docs/invariants.md`.
4. Read `docs/conformance-vectors.md` and `docs/implementation-matrix.md`.
5. Read `docs/architecture/preflight-decisions.md`.
6. For mission authority or research evidence, read the sibling files listed in `README.md`.

## Current phase

```text
T0 DOCUMENTATION CONTENT COMPLETE; BASELINE COMMIT PENDING
T1 CONTRACT/VECTORS/MATRIX FROZEN; BASELINE COMMIT PENDING
T2 CLOCK NOT STARTED
```

Until a dated T2 start artifact records both the UTC timestamp and clean Git status, do not:

- create `package.json`, a lockfile, source, tests, migrations, or build scripts;
- install or update dependencies;
- pull/start/configure PostgreSQL or DBOS for this repository;
- count any implementation as outside the 12-hour benchmark.

Research queries, registry lookups, document edits, and static verification do not start T2.

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
