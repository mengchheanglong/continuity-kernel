# Frozen Implementation Matrix

**Status:** frozen for T2 after static verification on 2026-07-10
**Recorded:** 2026-07-10T18:34:24Z
**T2 start:** `NOT_STARTED`

Registry and image lookups are research-only. Nothing in this matrix has been installed or configured in this repository.

## Host and package tooling

| Item | Frozen value |
|---|---|
| Host | Windows 10 with Git Bash/MSYS shell |
| Node.js | `24.14.0` |
| npm | `11.11.1` |
| pnpm | `10.32.1` |
| Git | `2.49.0.windows.1` |
| Docker | `29.5.2` |
| Docker Buildx | `0.34.0-desktop.1` |

## Planned exact packages

These exact versions may be added only after the T2 start artifact is recorded.

| Package | Version | Purpose |
|---|---:|---|
| `@dbos-inc/dbos-sdk` | `4.23.6` | workflow/runtime incumbent |
| `@dbos-inc/postgres-datasource` | `4.23.6` | official PostgreSQL datasource transaction |
| `postgres` | `3.4.9` | pin datasource client resolution |
| `canonicalize` | `2.1.0` | RFC 8785 JCS implementation listed by RFC 8785 |
| `zod` | `4.4.3` | runtime schema validation |
| `typescript` | `6.0.2` | compiler/typecheck |
| `tsx` | `4.21.0` | TypeScript execution |
| `vitest` | `4.0.17` | deterministic/concurrency test runner |
| `eslint` | `10.6.0` | lint command |
| `typescript-eslint` | `8.63.0` | TypeScript lint integration |
| `@types/node` | `24.13.3` | Node 24 type surface |

Registry integrity anchors already observed:

```text
@dbos-inc/dbos-sdk@4.23.6
sha512-Hrdm/WM7DUMqb517ib+msv/pIGnUepP/h3Q62T0j8/LYHRXS2PyOSd76emn1wccPDuTwhUhNyzBfbxoTbW0DJQ==

@dbos-inc/postgres-datasource@4.23.6
sha512-OYCz0czVoe2129lY/buXeN1ciZwhhCaI0HdLS2K0Lip2M0g6OggwUVnx0blaZlPhAnpK+hT5kHKnc+4RQpo6sg==

canonicalize@2.1.0
sha512-F705O3xrsUtgt98j7leetNhTWPe+5S72rlL5O4jA1pKqBVQ/dT1O1D6PFxmSXvc0SUOinWS57DKx0I3CHrXJHQ==
```

The eventual `pnpm-lock.yaml` must match the frozen package versions and registry integrities; any resolution difference stops the timer for a recorded matrix decision rather than silently changing the benchmark.

## PostgreSQL image

```text
Image: docker.io/library/postgres:18.4
OCI index digest: sha256:22c89fe0d0f507606260237fd55e51f6137f58b2d5bcf6152242b96d9fe8f9a4
linux/amd64 manifest: sha256:0c49c0c906cb405ea65e70c284570fee91c7750ca9336369afc0edf4fce211db
```

The T2 configuration must use the digest, not a floating tag. Querying the manifest did not pull or start the image.

## DBOS and database topology

| Setting | Frozen value |
|---|---|
| DBOS application name | `continuity-kernel-v0-benchmark` |
| DBOS application version | `continuity-kernel-v0-t2-v1` |
| Conductor | disabled |
| Application workers | one child worker process |
| Test/management process | one independent parent process/client |
| PostgreSQL service | one local Linux container |
| DBOS system database | separate database in the same PostgreSQL container |
| Domain/application database | one database containing the domain schema and datasource `dbos.transaction_completion` |
| Transaction isolation | SDK value `IsolationLevel.Serializable` → SQL `SERIALIZABLE` |
| Queue serialization | forbidden as conflict proof |
| DBOS system serializer | default JSON; no optional payload bytes |
| Datasource result serialization | package-owned SuperJSON; no optional payload bytes |
| Domain canonicalizer | `canonicalize@2.1.0` / RFC 8785 |
| Request/digest algorithm | `rfc8785-sha256-base64url-nopad-v1` |

## Database roles

- `continuity_owner`: non-login owner/migrator for the domain schema, tables, and commit function.
- `continuity_app`: runtime login; no ownership or direct DML/truncate on canonical state, command receipt, or accepted-history tables.
- `continuity_app` may execute only the schema-qualified `SECURITY DEFINER` canonical-commit function for canonical writes.
- `PUBLIC` execution on that function is revoked.
- The function fixes a safe `search_path`, uses no dynamic SQL, and rechecks grant version, expected case version, request hash, and constraints.
- Required DBOS operational/system privileges are granted separately and are not treated as canonical-domain authority.

## Retry, cancellation, and liveness

The published datasource retries SQLSTATE `40001` without an API-level maximum. The benchmark uses:

| Bound | Frozen value |
|---|---:|
| Single command/watchdog deadline | 5 seconds |
| Durable cancellation confirmation | 10 seconds |
| Worker restart readiness | 30 seconds |
| Post-restart no-late-commit observation | 5 seconds |
| Datasource maximum backoff observed in tagged source | 2 seconds |

Procedure on deadline:

1. Parent kills the worker process.
2. Independent management client durably cancels the workflow and confirms cancellation before restart.
3. Parent reads the domain receipt and canonical state to classify prior state versus already committed state.
4. Parent restarts the same application version.
5. Parent observes for five seconds and proves no new canonical position appears after cancellation.

A timeout is `UNKNOWN_RECONCILE_REQUIRED`, not a business rejection. `Promise.race` alone fails.

Retry-count instrumentation increments a process-local counter each time the datasource transaction callback is invoked and reports only vector ID and attempt number to the parent over IPC; it contains no payload bytes and is not canonical state.

## Clock and line bounds

The T2 clock starts immediately before the first package manifest/lockfile, dependency installation, database/DBOS configuration, migration, build script, implementation source, or executable test is added or run.

The start artifact records:

- UTC timestamp;
- clean Git status;
- current commit or explicit unborn-branch state;
- this matrix hash/digest once T2 tooling exists.

Counted implementation paths:

```text
src/domain/**/*.ts
src/incumbent/dbos/**/*.ts
migrations/**/*.sql
```

Count hand-written nonblank, noncomment TypeScript/SQL lines. Exclude tests, generated files, lockfiles, docs, evidence artifacts, and measurement tooling. Record the exact counting command and included files in the T2 evidence report. Limit: 300 lines.

## Planned command interface after T2 starts

```text
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm count:benchmark-lines
```

These commands do not exist yet by design.
