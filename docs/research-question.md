# Research Question and Stop Rule

**Status:** pre-T2 contract

## Falsifiable question

Can the published DBOS TypeScript/PostgreSQL stack, plus a thin deterministic domain layer, satisfy the six frozen vectors in `conformance-vectors.md` within:

- 12 implementation hours;
- at most 300 counted hand-written, nonblank, noncomment, non-test TypeScript/SQL lines in the domain/incumbent path;
- one PostgreSQL service, one application worker, and one independent test/management parent;
- no DBOS internal modification or bypass;
- no generic custom event store or projector?

## Successful counterexample

Bespoke-kernel-first is falsified and parked when all six vectors and mandatory supporting assertions pass under the frozen matrix and bounds.

The surviving artifact is the engine-independent contract/conformance harness plus a thin domain layer on existing infrastructure.

## Failure classification

Every failure must be classified as one of:

1. harness or fixture defect;
2. specification ambiguity;
3. setup, version, or configuration error;
4. missing domain rule or database constraint;
5. intrinsic DBOS limitation;
6. intrinsic PostgreSQL limitation;
7. time/complexity-bound failure;
8. mission question is not useful or implementable.

Only a repeated unchanged vector failing for category 5 or 6 begins an alternative-incumbent check. It does not authorize custom persistence.

## Alternative rule

- Transaction, idempotency, authorization, history, or privacy gap → simplest bounded PostgreSQL-only design.
- Durable execution, recovery, queue, or workflow-version gap → one maintained relevant runtime such as Temporal or Restate.
- Alternative passes → adopt or compare it; park custom persistence.
- Same intrinsic gap survives → review may approve a feasibility spike for exactly one missing capability.

## Evidence limitations

The operator is the founder/researcher. External users and market demand are not established. Green tests demonstrate only the named technical properties under the frozen matrix; they do not prove novelty, production readiness, legal compliance, natural-person identity, or subjective continuity.
