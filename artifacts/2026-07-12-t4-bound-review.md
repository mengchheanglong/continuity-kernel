# T4 Bound Review — Corrected Decision

**Review recorded:** 2026-07-12T00:35:41Z
**Original start:** 2026-07-11T15:46:31Z
**Original deadline:** 2026-07-11T19:46:31Z
**Elapsed beyond deadline at review:** `04:49:10`
**Clock reset:** no
**Implementation HEAD reviewed:** `6cc51038353f89dc5a6075ca80b3e7348a3d7403`
**Remote baseline:** `cf95b1fc63c5112837dcc433f46163bfc72bb795`

## Corrected decision

```text
T4_INCOMPLETE_AT_BOUND
PRIOR_T4_PASS_SUPERSEDED
CUSTOM_PERSISTENCE_REMAINS_PARKED
T5_AND_LATER_REMAIN_LOCKED
```

This artifact supersedes the decision authority of `2026-07-11-t4-final.md` without deleting or rewriting that historical artifact. The implementation remains useful candidate work, but it did not satisfy the frozen T4 contract before the fixed deadline.

## What remains valid

- The pure selector and adapter pass 10/10 tests and remain 116/140 counted production lines.
- The six integration tests execute against real Restate/PostgreSQL and the aggregate reports 16/16.
- Gate D remains independently valid at 105/105 and `GATE_D_PASSES_FOUNDATION_V3`.
- PostgreSQL remains canonical semantic and authorization authority; Restate remains durable execution/recovery.
- No T5, custom persistence, memory, model, UI, or multi-agent work is authorized.

## Decisive contract failures

1. **Bidirectional IPC privacy violation.** `tests/actor-child.ts` sends `{ type: "observation", observation }` to the child. The complete observation contains `payloadRef`, authorization grant data, and request inputs. The frozen plan required that no child IPC contain request bodies, payload references, authorization grants, or request hashes and froze IPC to `{type, commandId, proposalDigest}`.
2. **Privacy oracle gap.** T4-V6 checks only outbound proposal IPC. It checks stdout/stderr immediately after spawn and does not recheck after proposal evaluation and process termination.
3. **Required measurements omitted.** No `scripts/t4-metrics.ts`, `measure:t4`, or `artifacts/2026-07-11-t4-metrics.json` was produced. The frozen preflight and Task 6 required six bounded local measurements, raw summaries, timeout/cleanup, and privacy scans.
4. **Required static surface absent at decision.** The T4 decision commit did not include `scripts/**/*.ts` in TypeScript/typed ESLint coverage or the frozen `eslint src tests scripts` lint command. Those changes arrived only in the later consumer commit.
5. **Checkpoint/review sequence skipped.** Integration RED, integration GREEN, metrics, and final decision were collapsed. No recorded independent security/spec review or independent final review exists.
6. **No deadline-compliant push/equality proof.** The local repository remained ahead of `origin/main`; final push and `HEAD == origin/main` evidence required by the plan did not occur before the original deadline.

## Live audit evidence

After Docker readiness was restored for review:

```text
pnpm run test:t4       → 16/16 passed
pnpm run test:gate-d   → 105/105 passed
pnpm run typecheck     → PASS
pnpm run lint          → PASS
pnpm run build         → PASS
docker compose config → PASS
pnpm run doctor        → 3/3 passed
pnpm run example:consumer → 5/5 passed
Restate DB backends    → 0
advisory locks         → 0
```

Green tests do not override the frozen IPC, evidence, review, and deadline failures.

## Reopen rule

Any correction must be a separately approved experiment with a new name (for example T4R), new preflight, new immutable clock, test-first bidirectional IPC privacy oracle, required measurements, independent review, and separate Mission Control approval. It must not retroactively change this bounded outcome.
