# Evidence Artifacts

Sealed phase decisions live here. Prefer the newest dated final for the active phase; earlier artifacts remain historical evidence.

## Current authority

| Phase | Decision | Artifact |
|---|---|---|
| T2 | `DBOS_REJECTED_PENDING_ALTERNATIVE` | `2026-07-11-t2-final.md` |
| T2b | `RESTATE_PASSES_V4` | `2026-07-11-t2b-final.md` |
| Gate D | `GATE_D_PASSES_FOUNDATION_V3` | `2026-07-11-gate-d-final.md` |
| Foundation review | `APPROVE_T4_DETERMINISTIC_ACTOR` | `2026-07-11-foundation-review.md` |
| T4 | `T4_INCOMPLETE_AT_BOUND` | `2026-07-12-t4-bound-review.md` |
| Consumer gate | `CONSUMER_GATE_CANDIDATE_ONLY` | `2026-07-12-consumer-gate-review.md` |

The 2026-07-12 reviews supersede the decision authority of the earlier T4 and consumer pass artifacts without deleting historical evidence.

## Artifact rules

Each evidence artifact must contain:

- version/commit under review;
- commands executed;
- decisive output;
- failed or skipped checks;
- invariant/vector coverage;
- implementation hours and line count where bounded;
- scope audit;
- one frozen decision string.

Do not place secrets, credentials, payload bytes, or personal data in artifacts.
