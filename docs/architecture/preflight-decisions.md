# Preflight Architecture Decisions

**Status:** pre-T2 locked decisions

## D1 — Incumbent before bespoke persistence

Test published durable infrastructure first. DBOS/PostgreSQL is a counterexample to the claim that a custom kernel must be built first. Passing the frozen benchmark parks bespoke persistence.

## D2 — Installable datasource package

Use:

```text
@dbos-inc/dbos-sdk@4.23.6
@dbos-inc/postgres-datasource@4.23.6
```

The tagged v4.23 `packages/postgres-datasource` implementation—not the unpublished workspace placeholder under `packages/nodepg-datasource`—is the evidence/code path for the planned benchmark.

## D3 — Domain receipt owns request equality

DBOS workflow IDs suppress duplicate execution but do not establish semantic request equality.

- Server computes `requestHashEnvelopeV1` before DBOS.
- Server compares the returned receipt after a new or existing DBOS result.
- Canonical transaction enforces unique `(namespace_id, command_id)` and stored-hash equality.
- Same hash returns stored outcome; different hash rejects as `IDEMPOTENCY_KEY_REUSED`.

## D4 — Canonical hash/digest scheme

Both request hashes and projection digests use RFC 8785 JCS, SHA-256, and unpadded Base64URL. Projection algorithm identifier:

```text
rfc8785-sha256-base64url-nopad-v1
```

Request envelopes and projections have independent schema versions. SHA-256 demonstrates equality under the declared scheme, not authenticity against a state-rewriting attacker.

## D5 — Database-enforced canonical path

The runtime role does not own or directly mutate canonical tables. One fixed-search-path, public-execution-revoked `SECURITY DEFINER` function performs canonical writes and rechecks authorization, expected version, receipt hash, and constraints in the official datasource transaction.

## D6 — Authorization race is ordered

“Concurrently revoked” is not a predetermined rejection. The vectors separately test:

- revocation commits before command validation → reject;
- valid command linearizes first → one accepted transition, then revocation.

## D7 — Retry timeout must terminate execution

The published datasource retry loop has no API maximum. A caller-only timeout is insufficient. The local single-worker/no-Conductor benchmark uses a parent watchdog, worker kill, durable cancellation before restart, domain-receipt reconciliation, and post-cancellation observation.

This is a benchmark mechanism, not a production SLO or universal deployment architecture. If it cannot prove the frozen property without framework modification, that is an incumbent result.

## D8 — Optional payloads stay outside durable runtime history

Only an opaque `PayloadRef` crosses DBOS boundaries. Optional bytes and plaintext-derived hashes are forbidden from durable requests, results, errors, attributes, messages, events, streams, transaction results, logs, traces, and exports.

## D9 — T0/T1 do not hide setup time

T0–T1 create and freeze documentation only. The T2 timestamp and clean Git status must precede package manifests, dependencies, PostgreSQL/DBOS configuration, migrations, build scripts, source, and executable tests. All such work counts toward 12 hours.

## D10 — Event sourcing is not preselected

Canonical state plus minimum domain history is sufficient for the benchmark. Full replay, snapshots, projectors, and a custom journal remain locked unless an unchanged mission-defining failure later justifies one exact capability through the alternative-incumbent rule.
