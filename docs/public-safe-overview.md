# Continuity Kernel — Public-Safe Overview

**Audience:** outsider engineer, maintainer, employer, or collaborator  
**Reading time:** about 10 minutes  
**Data class:** synthetic only  
**Status:** packaging document; does not claim external demand

## What it is

Continuity Kernel is a **research-grade conformance harness**.

It freezes continuity properties that matter when stateful agents or simulations:

- retry after timeouts;
- crash mid-commit;
- race on the same case;
- reuse command IDs;
- separate optional sensitive payloads from durable runtime history.

It then tests whether existing durable infrastructure can satisfy those properties with only a thin deterministic domain layer.

## What problem it attacks

Modern agent/tool systems often fail in boring, expensive ways:

1. a side effect runs twice after retry;
2. an unauthorized actor mutates shared state;
3. two writers fork case state;
4. restart loses or double-applies a commitment;
5. “memory” and runtime logs retain content that should have been erasable.

These are continuity failures. They are software problems, not consciousness problems.

## What we tested

### Incumbent path: DBOS + PostgreSQL

Pinned DBOS TypeScript/PostgreSQL was tested first as a counterexample to “we must build custom persistence immediately.”

Result:

```text
DBOS_REJECTED_PENDING_ALTERNATIVE
```

Named reason class: intrinsic pinned-DBOS limitation around pre-commit recovery boundaries under the frozen V4 recovery guarantee. See `artifacts/2026-07-11-t2-final.md`.

### Alternative path: Restate + PostgreSQL

The same frozen vectors were re-run on Restate with PostgreSQL as semantic authority.

Result:

```text
GATE_D_PASSES_FOUNDATION_V3
```

Custom persistence remained parked because the alternative passed.

### Deterministic actor

A thin rule-based actor path was added to exercise proposal/commit boundaries.

- Original T4 bound closed as `T4_INCOMPLETE_AT_BOUND` for privacy/evidence/process reasons, not by rewriting the research question.
- T4R later passed the privacy correction:

```text
T4R_PASSES_CORRECTION
```

### Consumer gate

An in-repo second caller exists and can exercise the public commit path.

Sealed status:

```text
CONSUMER_GATE_CANDIDATE_ONLY
```

That is useful operability evidence. It is not an external user and not product validation.

## What green tests prove

Under the frozen local topology and fixtures, the surviving Restate/PostgreSQL direction demonstrates technical properties such as:

- authorization denial without canonical mutation;
- command-id + request-hash idempotency;
- expected-version conflict handling;
- crash-boundary recovery for the named commit path;
- deterministic materialization/digests with explicit unsupported-version failure;
- optional-payload separation mechanics in the frozen scan scope;
- T4R privacy constraints for the deterministic actor correction.

## What green tests do not prove

See `docs/non-claims.md`. Especially:

- no consciousness / personhood / subjective continuity;
- no natural-person identity;
- no production SLO or security certification;
- no GDPR compliance certificate;
- no external demand or product-market fit;
- no permission to open memory/LLM/3D product work.

## Why this may still matter without current customers

Even with **external demand not established**, the artifact can still be valuable as:

1. a portfolio proof of correctness engineering;
2. a reproducible vendor/runtime comparison method;
3. a starting point for maintainer critique;
4. a bounded research package for durable agent systems.

Those are not the same as “people are already asking for this product.”

## Current strategic limit

```text
Technical foundation: done enough to stop expanding features by default
External evidence:    missing
Next high-value work: packaging + outsider evaluation
Not next by default:  T5 memory, custom persistence, Agent OS productization
```

“No external need established yet” means:

```text
EXTERNAL_DEMAND_NOT_ESTABLISHED
```

It does **not** automatically mean:

```text
EXTERNAL_DEMAND_ABSENT
```

Absence requires a bounded external contact attempt and honest negative evidence. Packaging prepares for that without pretending demand already exists.

## If you only remember four lines

1. Continuity Kernel tests durable commit/recovery/auth properties for agent-like systems.  
2. DBOS failed one frozen recovery guarantee; Restate/PostgreSQL passed the foundation suite.  
3. T4R passed after an honest T4 incomplete bound.  
4. External demand is unknown; packaging and outsider critique are the next evidence step.
