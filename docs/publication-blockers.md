# Publication and External-Evidence Blockers

**Date:** 2026-07-14  
**Purpose:** honest list of why Continuity Kernel is not yet a finished external package  
**Does not authorize:** making the repo public, outreach, T5, or demand claims

## Current visibility

```text
GitHub: PRIVATE
External demand: NOT ESTABLISHED
Consumer: CANDIDATE ONLY
```

## Blockers before public visibility

1. **Entry docs were stale relative to T4R**  
   Being repaired by packaging docs (`README`, `AGENTS`, `runbook`, overview). Re-check after commit.

2. **Reference consumer is not an independent public consumer**  
   It imports test fixtures/helpers and remains candidate-only per sealed review.

3. **Doctor is incomplete for stranger operability**  
   Checks Postgres + Restate admin/ingress, but not:
   - endpoint listen on `:9080`;
   - deployment registration success;
   - proven container-to-host route identity.

4. **Clean-checkout stranger run is not yet independently witnessed**  
   Founder verification is not the same as outsider reproduction.

5. **Test failpoints live inside `continuity.commit_command`**  
   Acceptable for synthetic harness; must be labeled/gated before any “production-ready” framing.

6. **Duplicate-key rejection is library-level, not proven raw-ingress policy**  
   `parseCanonicalJson()` exists/tests, but ordinary Restate path receives already-parsed objects. Public claims must stay narrow.

7. **Privacy/publication review not completed**  
   Confirm no secrets, private host assumptions, or over-specific personal paths in public-facing docs/artifacts.

8. **No Tier-A external case or maintainer critique on file**  
   Packaging enables contact; it does not replace it.

## Non-blockers (do not overstate)

These are **not** reasons the project is invalid:

- T5 is locked;
- no paying customer yet;
- Agent OS concept is not built;
- original T4 was incomplete at bound (T4R later corrected the privacy process gap);
- repository is private.

## External-evidence definitions

Use careful labels:

| Label | Meaning |
|---|---|
| `EXTERNAL_DEMAND_NOT_ESTABLISHED` | current truthful default |
| `NO_SIGNAL_IN_SAMPLE` | after a bounded contact attempt with little/no useful response |
| `RECRUITMENT_INCONCLUSIVE` | contact process could not produce enough qualified conversations |
| `EXTERNAL_DEMAND_ABSENT` | strong claim; requires broader honest evidence, not a tiny sample |
| Tier-A case / independent run / maintainer critique | positive external evidence classes |

## Minimum package for outsider evaluation

Before asking anyone serious to look:

1. public-safe overview readable in ~10 minutes;
2. architecture diagram;
3. non-claims;
4. runbook with pins and Windows/Docker notes;
5. sealed Gate D + T4R + consumer-candidate status visible from README;
6. publication-blocker honesty;
7. no demand or consciousness claims.

## Explicitly deferred

- public GitHub flip
- Restate/DBOS maintainer outreach
- marketing site
- product pricing
- T5 implementation
- Agent OS implementation
