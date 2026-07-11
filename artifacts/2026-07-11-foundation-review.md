# Continuity Kernel Foundation Review

**Recorded:** 2026-07-11T15:26:27Z
**Reviewed foundation decision:** `GATE_D_PASSES_FOUNDATION_V3`
**Foundation decision commit:** `3bf0f35e9b904325b001bdea534bd8b35fcf6bb1`

## Decision

```text
APPROVE_T4_DETERMINISTIC_ACTOR
CUSTOM PERSISTENCE REMAINS PARKED
T5_AND_LATER_REMAIN_LOCKED
```

This review authorizes only a bounded T4 deterministic-actor experiment. It does not authorize memory, language models, multiple actors, a world simulator, an inspector, portability, rendering, identity claims, or T5.

## Why the mission remains useful

Gate D established that pinned Restate/PostgreSQL can preserve deterministic canonical truth, authorization, idempotency, conflict handling, crash recovery, version failure, and the tested privacy boundary without custom persistence. The next useful falsifiable question is no longer whether the foundation can commit safely. It is whether a minimal actor can use that foundation without bypassing observation, authorization, proposal-validation, causality, or recovery boundaries.

The question is:

> Can one deterministic actor consume a strict permitted-observation representation produced by a trusted synthetic harness, select one fixed rule/goal, produce a typed proposal, pass through the existing authoritative canonical commit path, and yield a complete accepted or rejected consequence under duplication, staleness, process loss, undeclared input, and invalid authorization?

A passing result would establish a deterministic behavioral baseline for later memory or model experiments. A failing result would expose a concrete actor/foundation boundary before probabilistic behavior obscures it.

## Why T4 is the smallest valid next step

- It exercises the foundation rather than adding infrastructure.
- It makes observation and knowledge boundaries executable.
- It measures proposal identity, rejection, causality, duplication, staleness, and interruption.
- It requires no language model, memory store, queue, scheduler, event store, or UI.
- It can reuse the existing canonical request, Restate submission, PostgreSQL receipt, and recovery evidence.

## Approval conditions

T4 must freeze and satisfy all of the following:

1. exactly one deterministic actor and one synthetic case-resolution scenario;
2. a strict, versioned permitted-observation representation plus a test-only trusted fixture that derives it from authoritative synthetic rows;
3. one fixed rule/goal with no wall clock, randomness, model, network lookup, database handle, or hidden mutable state in proposal selection;
4. a deterministic proposal and command identity derived only from the declared observation and actor-rule version;
5. local rejection before submission for malformed, undeclared, or declared-scope-inconsistent observations; local checks are not authoritative authorization;
6. accepted proposals use the existing approved Restate client and canonical PostgreSQL commit function unchanged;
7. the durable PostgreSQL receipt/history remains consequence authority;
8. explicit tests for illegal action, undeclared input, invalid/revoked authoritative grants, stale proposal, duplicate proposal, causal trace completeness, process-loss reproduction, and deterministic repetition;
9. no migration, dependency, canonical schema, runtime protocol, or privilege expansion;
10. a dated T4 evidence report and stop/go review before T5.

## Non-claims

T4 does not prove intelligence, agency in a philosophical sense, autonomy, memory, learning, personal identity, consciousness, subjective continuity, or safe deployment. It tests a deterministic software decision loop under a narrow synthetic contract.

T4 also does not establish a production observation service, general knowledge confinement, autonomous restart, observation reacquisition, or pending-submission recovery. The trusted observation producer exists only in the synthetic integration harness. Arbitrary callers remain untrusted, and PostgreSQL remains the sole authoritative authorization boundary.

## Stop rule

Stop and record `T4_REVISE` if the experiment requires new canonical tables, custom persistence, hidden state, framework bypasses, an LLM, memory, or weakened Gate-D guarantees. Stop and record `T4_INCONCLUSIVE` for harness/setup failure. Record `T4_PASSES_DETERMINISTIC_ACTOR` only when every frozen T4 assertion passes within the preflight bounds.
