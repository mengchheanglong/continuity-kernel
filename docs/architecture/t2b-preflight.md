# T2b Alternative-Incumbent Preflight — Restate

**Status:** frozen before T2b implementation
**Recorded:** 2026-07-11T02:13:43Z
**T2 decision baseline:** `6ceb5b134004454cc081335f2838fdef9e82fb3f`
**T2b implementation clock:** `NOT_STARTED`
**Data:** synthetic only

This supplement does not edit or supersede the frozen T1 vectors. It selects one maintained durable-runtime alternative for the intrinsic DBOS V4 failure and freezes the bounded comparison before any alternative dependency, configuration, source, or executable test is added.

## Decision

```text
SELECTED ALTERNATIVE: Restate
CUSTOM PERSISTENCE: NOT AUTHORIZED
T2B CLOCK: NOT STARTED
```

Use Restate Server `1.7.2` with the explicitly compatible TypeScript SDK/client `1.15.1`. Do not use the newer SDK `1.16.1` in this benchmark because the official Server/SDK table currently ends at SDK `1.15`; avoiding an unverified version pairing is more important than using `latest`.

Temporal remains the fallback reference, not a second T2b implementation. If Restate is excluded before implementation by a demonstrated setup or public-API incompatibility, stop and record a matrix amendment before selecting Temporal. Do not silently switch candidates while the clock is running.

## Why Restate

Both candidates are maintained, support TypeScript on Node 24, recover worker crashes, retry external operations, expose clients/status/cancellation, and require application-level idempotency for ambiguous external database completion.

| Criterion | Restate | Temporal | T2b consequence |
|---|---|---|---|
| TypeScript model | regular durable service/workflow handler | deterministic Workflow plus Activity, Worker, and Client | Restate is smaller for a six-hour/150-line comparison |
| Worker crash | server retries/replays journal on another service process | service reschedules Workflow/Activity tasks | both are relevant to V4 |
| PostgreSQL side effect | `ctx.run`; official DB guide requires conditional/idempotency-token handling for ambiguous completion | Activity; official retry guidance requires idempotent Activities | existing canonical receipt remains the authority in either case |
| Invocation identity | workflow key/idempotency key with attach/peek | workflow ID with handle/describe/result | neither replaces semantic request-hash equality |
| Cancellation | CLI/UI/HTTP/programmatic invocation cancellation | client Workflow cancellation/termination and Activity cancellation | both satisfy the management requirement in principle |
| Local topology | one Restate server plus one TypeScript endpoint | Temporal service plus Workflow/Activity Worker and Client | Restate has the lower bounded operational footprint |
| Current explicitly compatible pins | Server 1.7.2 + SDK/client 1.15.1 | SDK packages 1.20.2; server would require a separate matrix | select Restate |

Selection is based on experiment economy, not a claim that Restate is universally superior to Temporal.

## Exact frozen matrix

### Host/tooling

| Item | Frozen value |
|---|---|
| Host | Windows 10 with Git Bash/MSYS shell |
| Node.js | `24.14.0` |
| pnpm | `10.32.1` |
| Git | `2.49.0.windows.1` |
| Docker client/server | `29.6.1` |

### Alternative packages

These packages may be added only after the T2b start artifact is committed.

| Package | Version | Registry integrity |
|---|---:|---|
| `@restatedev/restate-sdk` | `1.15.1` | `sha512-MYIBoggyx806UjHvIpoXr1wi9ivCrlHesOhxE/pW8bTXrvBBV6tN0EwhQR1126DmpkFw5qaVFMSJ4I2rr2Tlkw==` |
| `@restatedev/restate-sdk-clients` | `1.15.1` | `sha512-8VBX2sbbJYGmbpS95Ara14BdRvoQjmR6zg/EYIxuoKbrIP7N+JeSmgk27YRh23jBaZX8xUMaDiDSAO5H/iuzAQ==` |

Both resolve `@restatedev/restate-sdk-core` exactly `1.15.1`.

### Restate server image

```text
Image tag: docker.restate.dev/restatedev/restate:1.7.2
OCI index digest: sha256:235ef77b2d78e6dd6d581fcdef5c02f7d8d1a040ee84d998b193be98c2717baf
Linux/AMD64 manifest: sha256:9c9b8dc71581c02ce1d85dd9928ed2728b92a5a43499880c86a1fa8b01fab86a
Frozen compose reference: docker.restate.dev/restatedev/restate@sha256:9c9b8dc71581c02ce1d85dd9928ed2728b92a5a43499880c86a1fa8b01fab86a
```

Do not use a floating tag. Use a dedicated named data volume so Restate journal state survives service-worker termination. The benchmark may stop/restart the Restate container only in a separately named server-recovery check; V4 kills the application worker, not the durable runtime.

### Topology and identity

| Setting | Frozen value |
|---|---|
| Restate server | one local Linux/AMD64 container |
| Ingress | parent client → `http://localhost:8080` |
| Admin/UI | parent management probes → `http://localhost:9070` |
| TypeScript endpoint | one direct child Node process on port `9080` |
| Container-to-host endpoint | `http://host.docker.internal:9080` |
| Service type/name | workflow `ContinuityCommitT2bV1` |
| Candidate version marker | `continuity-kernel-v0-t2b-restate-v1` |
| Workflow key | namespace-scoped command identity; transport identity only |
| Canonical authority | existing PostgreSQL `continuity.commit_command` path |
| Runtime state | operational journal only; never canonical domain truth |
| Queue/concurrency serialization | forbidden as conflict proof |
| Optional payload | opaque `PayloadRef` only |

The Restate workflow key and idempotency key deduplicate invocation transport. They do not prove request equality. The server boundary compares the returned canonical receipt hash, and PostgreSQL independently enforces `(namespace_id, command_id)` plus stored-hash equality.

## Preserved PostgreSQL contract

T2b must reuse without semantic changes:

- `src/domain/canonical.ts`;
- `migrations/001_continuity.sql`;
- the separate non-login owner and runtime-role grants;
- the fixed-search-path, public-execution-revoked `SECURITY DEFINER` commit function;
- RFC 8785/SHA-256 request and projection fixtures;
- authorization, expected-version, receipt, accepted-history, and audit rules.

Restate does not own or directly mutate canonical tables. Its handler calls the existing canonical transaction inside one `ctx.run` step. Because PostgreSQL may commit before Restate journals the step result, the callback is intentionally retryable and the existing transactional receipt makes the retry idempotent. Do not add Restate-specific canonical columns, a custom journal, two-phase commit, prepared transactions, or a generic event store.

The official Restate database guide explicitly documents the ambiguous window and recommends a conditional version or idempotency token committed atomically with the update. The existing receipt already supplies that mechanism.

## Frozen T2b scope

T2b answers one question:

> Does Restate satisfy the unchanged V4 external-kill safety and recovery guarantee using public APIs, the official server/SDK, and the existing canonical PostgreSQL receipt path?

T2b does not reimplement all six vectors. If Restate passes V4, a later Gate-D slice runs the complete portable suite before foundation promotion.

### V4 observation clarification

The frozen V4A/V4B text requires prior state “after restart,” while a durable runtime may immediately retry pending work. T2b preserves both safety and liveness through a deterministic test-only recovery barrier:

1. restart the same pinned service version;
2. recovered execution signals the parent immediately before it may enter PostgreSQL and waits on process-local IPC;
3. parent asserts prior canonical state/version/digest and no receipt/history fragment;
4. parent releases the barrier;
5. recovery must finish with exactly one canonical transition and stored receipt.

The barrier changes neither durable input nor production semantics. It makes the frozen post-restart safety observation measurable before forward recovery proceeds. A terminal invocation error, cancellation, exhausted retry policy, or version mismatch does not satisfy recovery.

## Frozen external-kill tests

Use direct `child_process.fork` with `execPath: process.execPath`, `execArgv: ["--import", "tsx"]`, native IPC, unique workflow/command IDs, real timers, and sequential Vitest execution. Do not place `pnpm`, `npx`, a shell, or `.cmd` between the parent and worker.

### T2b-V4A — kill before canonical transaction

1. Parent starts the workflow with fixture A and a unique command ID.
2. First worker signals after invocation begins but before `ctx.run`/PostgreSQL starts.
3. Parent confirms no canonical receipt/history/transition, then externally kills the worker.
4. Parent waits for the direct child to exit and for PostgreSQL worker backends to disappear.
5. Parent restarts `continuity-kernel-v0-t2b-restate-v1`.
6. Recovered callback stops at the pre-PostgreSQL recovery barrier.
7. Parent asserts case version `3`, the prior digest, and zero receipt/history fragments.
8. Parent releases recovery.
9. Invocation must complete with one accepted version-`4` transition, one receipt, and one accepted-history row.
10. Attach/retry returns the stored result without another transition.

### T2b-V4B — kill inside transaction before commit

1. Parent starts fixture A with a fresh command ID.
2. The canonical transaction performs the existing intermediate test write and enters the deterministic `pg_sleep` boundary before commit.
3. IPC plus an independent `pg_stat_activity` probe proves PostgreSQL is inside the boundary.
4. Parent externally kills the worker and waits for its database backends to disappear.
5. Before restart, parent asserts rollback: case version `3`, prior digest, zero receipt, zero accepted history.
6. Parent restarts the same version; recovered callback stops at the pre-PostgreSQL recovery barrier.
7. Parent repeats the prior-state assertions after restart.
8. Parent releases recovery.
9. Invocation must complete exactly once at version `4`.

### T2b-V4C — kill after commit before Restate step completion

1. Parent starts fixture A with a fresh command ID.
2. Inside the `ctx.run` callback, the existing canonical transaction commits.
3. Independent PostgreSQL probes confirm exactly one receipt/history/state transition.
4. The callback signals the parent and blocks before returning its result to Restate.
5. Parent externally kills the worker.
6. Parent restarts the same version.
7. Restate may re-execute the ambiguous callback; PostgreSQL must return the stored receipt.
8. Final outcome must contain exactly one state transition, one receipt, one accepted-history row, and the frozen digest.

This boundary specifically tests the duplicate window described by Restate’s database guidance. Passing depends on the domain receipt, not a claim that `ctx.run` makes arbitrary PostgreSQL commits intrinsically exactly once.

## Supporting assertions

The T2b harness must also prove:

- runtime workflow-key reuse with a different semantic request is rejected as `IDEMPOTENCY_KEY_REUSED` at the server boundary;
- a new Restate workflow key cannot bypass the canonical command receipt;
- optional payload bytes and plaintext-derived hashes never enter Restate input, journaled step result, errors, logs, or invocation metadata;
- runtime retries report only vector ID and attempt count over IPC;
- application-role privilege-negative tests remain green;
- no canonical state is read from Restate’s embedded state store;
- no Restate private API, storage table/file, or internal protocol is accessed;
- no test weakens `docs/conformance-vectors.md` or changes frozen request/digest fixtures.

Logical Restate journal/privacy inspection must use supported CLI/Admin/SQL interfaces only. Filesystem/WAL/backup-media erasure remains outside this synthetic T2b claim unless separately exercised.

## Bounds

| Bound | Frozen value |
|---|---:|
| T2b implementation maximum | 6 hours |
| Candidate-specific non-test TypeScript/SQL | 150 nonblank, noncomment lines |
| Worker/service readiness | 30 seconds |
| PostgreSQL backend disappearance | 45 seconds on Windows/Docker Desktop |
| Invocation recovery completion | 30 seconds after barrier release |
| Management/cancellation confirmation | 10 seconds |
| Post-terminal observation | 5 seconds |

The 45-second backend bound records the T2 observation that Windows/Docker socket teardown may exceed 30 seconds. It does not relax any canonical-state or runtime-recovery expectation.

Counted candidate path:

```text
src/alternative/restate/**/*.ts
```

Exclude tests, generated files, package lockfiles, documentation, evidence artifacts, measurement scripts, and pre-existing domain/SQL code. Record both candidate-specific and combined surviving-direction counts in the final artifact.

## Clock/start procedure

The T2b clock starts immediately before the first of:

- adding an alternative package or changing the lockfile;
- adding Restate compose/configuration;
- adding executable Restate source or tests;
- pulling/starting the Restate image;
- registering a Restate deployment;
- running candidate setup or executable probes.

Before that action, create and commit `artifacts/2026-07-11-t2b-start.md` containing:

- UTC start and six-hour deadline;
- clean Git status and baseline commit;
- selected package versions/integrities and server image digests;
- this preflight file’s SHA-256;
- exact counted path and 150-line bound;
- exact V4 test names and timeout bounds;
- statement that frozen T1 outcomes remain unchanged;
- statement that custom persistence remains unauthorized.

Documentation research, registry/image manifest lookup, and this preflight do not start the implementation clock because they do not install, configure, execute, or implement the candidate.

## Stop and decision rules

### Restate passes unchanged V4

```text
RESTATE_PASSES_V4
CUSTOM PERSISTENCE REMAINS PARKED
```

Commit the evidence, then schedule Gate D to port/run all six vectors against the surviving direction. Do not claim foundation promotion from V4 alone.

### Setup, harness, or version/configuration failure

```text
T2B_INCONCLUSIVE
```

Correct it only within the frozen clock. Do not classify setup friction as an intrinsic runtime limitation and do not authorize custom work.

### Repeated intrinsic Restate failure

```text
RESTATE_REJECTED_PENDING_REVIEW
```

Require the same unchanged boundary to fail at least twice with fresh IDs and independent state/status evidence. Record the exact missing capability. A post-T2b review may then consider one narrowly named feasibility spike; a custom workflow engine, journal, event store, or projector is not automatically authorized.

### Deadline or line-bound breach

```text
T2B_INCOMPLETE_AT_BOUND
```

Stop immediately and record incomplete work honestly. Do not restart the clock or exclude required code to fit the line count.

## Source record

Official sources sampled on 2026-07-11:

- Restate TypeScript durable steps: https://docs.restate.dev/develop/ts/durable-steps
- Restate workflow durability, attach, cancellation, and retry behavior: https://docs.restate.dev/tour/workflows
- Restate TypeScript ingress clients: https://docs.restate.dev/services/invocation/clients/typescript-sdk
- Restate service communication and invocation cancellation: https://docs.restate.dev/develop/ts/service-communication
- Restate retry policies: https://docs.restate.dev/guides/error-handling
- Restate database/idempotency guidance: https://docs.restate.dev/guides/databases
- Restate architecture and worker-crash recovery: https://docs.restate.dev/foundations/key-concepts
- Restate installation/topology: https://docs.restate.dev/installation
- Restate SDK compatibility table: https://github.com/restatedev/sdk-typescript
- Restate Server 1.7.2 release: https://github.com/restatedev/restate/releases/tag/v1.7.2
- Restate TypeScript SDK 1.15.1 release: https://github.com/restatedev/sdk-typescript/releases/tag/v1.15.1
- Temporal TypeScript guide: https://docs.temporal.io/develop/typescript
- Temporal worker recovery/deployment: https://docs.temporal.io/develop/typescript/workers/run-worker-process
- Temporal retry policies: https://docs.temporal.io/encyclopedia/retry-policies
- Temporal platform failures: https://docs.temporal.io/encyclopedia/application-failures
- Temporal local TypeScript setup: https://docs.temporal.io/develop/typescript/set-up-your-local-typescript
