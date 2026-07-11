# Gate D Final — Restate/PostgreSQL Foundation V3

**Decision recorded:** 2026-07-11T15:02:59Z
**Gate-D start:** 2026-07-11T07:12:49Z
**Hard deadline:** 2026-07-11T15:12:49Z
**Clock reset:** no
**Elapsed:** `07:50:10`
**Gate-D baseline:** `a3862ddc1f83bc93e3235cc0516d3fd64efe42e4`
**Evidence HEAD before this decision artifact:** `cf85da0249d90186abaae0d335ac7def3d92e6cd`
**Final decision commit:** the commit containing this artifact; implementation evidence is fixed at `cf85da0249d90186abaae0d335ac7def3d92e6cd`

## Decision

```text
GATE_D_PASSES_FOUNDATION_V3
CUSTOM PERSISTENCE REMAINS PARKED
```

Stop at foundation V3 review. T4 is not started by this decision.

## Verified foundation

- Restate Server `1.7.2`, pinned image digest `sha256:9c9b8dc71581c02ce1d85dd9928ed2728b92a5a43499880c86a1fa8b01fab86a`.
- Restate TypeScript SDK/client `1.15.1`.
- PostgreSQL `18.3`, pinned image digest `sha256:0c49c0c906cb405ea65e70c284570fee91c7750ca9336369afc0edf4fce211db`.
- Node `24.14.0`, pnpm `10.32.1`, TypeScript `6.0.2`, Vitest `4.0.17`.
- Canonical PostgreSQL receipts remain authoritative; Restate supplies durable invocation/recovery/cancellation, not canonical state.
- Counted production path: `394/400` nonblank, non-comment lines.

## Frozen vector evidence

| Vector | Evidence | Result |
|---|---|---|
| V1 authorization/revocation | Restate end-to-end rejection plus canonical grant/version evidence | PASS |
| V2 idempotency | independent submitters, same/different workflow keys, stored-receipt authority after restart/purge | PASS |
| V3 conflict/cancellation | real concurrent serializable snapshots; one accepted/one expected conflict; public cancel, exact 409 cancellation, reconciliation, five-second no-late-effect window | PASS |
| V4 crash recovery | external pre-transaction, mid-transaction, and post-commit worker kills | PASS |
| V5 version/projection | exact frozen projection digest after restart; public service/deployment/server evidence; explicit unsupported-version failures | PASS |
| V6 privacy/erasure | deletable synthetic payload erased; application columns, supported invocation/journal surfaces, results/errors, worker and Restate logs scanned | PASS |

All ten frozen invariants and mandatory supporting assertions are represented in the aggregate, including authoritative receipts, namespace isolation, deterministic validation, transaction boundaries, durable causation/correlation, clock separation, ownership, privileges, and privacy boundaries.

## Final verification pack

Executed before the hard deadline:

```text
CK_RESTATE_DEPLOYMENT_URI=http://172.23.32.1:9080 pnpm run test:gate-d
  4 files passed
  105 tests passed
  duration 89.14s

pnpm run typecheck                 PASS
pnpm run lint                      PASS
pnpm run build                     PASS
docker compose config --quiet      PASS
git diff --check                   PASS
frozen-file diff                   PASS
production line count              394/400
pinned Restate image/version       PASS — 1.7.2
runtime/log privacy scan           PASS
orphan Restate DB backends         0
advisory locks                     0
```

## Measurements

Raw local synthetic samples and min/median/max are in `artifacts/2026-07-11-gate-d-metrics.json`.

- Endpoint spawn-to-ready: median `717.67 ms` across five samples.
- Canonical commit: median `10.03 ms` across five samples.
- Recovery vector completion: V4A `5874.97 ms`, V4B `51767.19 ms`, V4C `3904.44 ms`.
- Public cancellation request through exact SQL and attachment confirmation: `1121 ms`.
- Post-cancellation no-late-effect observation: `5000 ms`.
- Replay throughput: `NOT_APPLICABLE_NO_EVENT_REPLAY`.

These are local synthetic observations, not production SLOs.

Raw samples:

```text
endpoint spawn-to-ready ms: [717.67, 719.65, 733.97, 629.67, 710.63]
canonical commit ms:        [53.98, 10.47, 10.03, 9.21, 7.81]
V4A/V4B/V4C ms:             [5874.97] / [51767.19] / [3904.44]
cancellation confirmation:  [1121]
post-cancellation window:   [5000]
```

## Exact topology and routing

Single Windows 10 host; one Node endpoint process on port `9080`; one pinned Restate 1.7.2 Linux/AMD64 container with ingress `8080` and Admin `9070`; one PostgreSQL 18.3 container published on localhost `55432`; no queue, Conductor, event store, projector, or custom persistence. Restate reached the host endpoint through the verified WSL/Docker bridge address `172.23.32.1:9080` because `host.docker.internal` did not resolve to the listening interface in this topology. A recreated Restate container resumed its preserved volume with persisted node name `9ae5b4adda05`; no runtime volume was deleted.

## Invariant coverage

| # | Frozen invariant | Authoritative evidence | Result |
|---|---|---|---|
| 1 | scoped stable identifiers | namespace/case/command isolation, cross-namespace same command ID | PASS |
| 2 | one canonical case state | serializable expected-version race and exact final state | PASS |
| 3 | authorization and scope | V1 actor/scope/revocation and grant-version checks | PASS |
| 4 | single canonical commit path | approved security-definer function, direct DML denied | PASS |
| 5 | minimum auditable history | accepted history, rejection audit, payload-erasure continuity | PASS |
| 6 | atomicity, concurrency, and conflict-aware idempotency | V2/V3 duplicate, mismatch, race, rollback, receipt authority | PASS |
| 7 | recovery equivalence | V4 external kills, V5 restart digest, cancellation/exhaustion distinctions | PASS |
| 8 | causal traceability | command/request hash plus namespace/case, actor/grant/version/position/result | PASS |
| 9 | explicit time and external inputs | hashed world time, transaction ingestion sample, prohibited external influence | PASS |
| 10 | versioned authority and adapters | explicit authority/schema/validator/projector/serializer/hash/runtime versions fail closed | PASS |

## Focused RED/GREEN evidence

Recorded focused RED commands and decisive failures:

```text
vitest ... -t 'GateD approved boundary'
  RED — malformed/undeclared approved-boundary inputs were not yet rejected locally
vitest ... -t 'GateD-V2A|GateD-V2B'
  RED — caller workflow-key equality and post-purge PostgreSQL receipt authority were absent
vitest ... -t 'GateD-V3'
  RED — deterministic concurrent-snapshot evidence and durable cancellation terminal proof were absent
vitest ... -t 'GateD-V5|GateD-V6|never journals'
  RED — restart/version and expanded erasure-surface assertions were absent
```

The corresponding decisive GREEN commands were:

```text
vitest ... -t 'GateD-V1|GateD approved boundary'          12 passed
vitest ... -t 'GateD-V2A|GateD-V2B'                       3 passed
vitest ... -t 'GateD-V3'                                  2 passed
vitest ... -t 'GateD-V5|GateD-V6|never journals'          14 passed
vitest database.test.ts -t 'GateD invariant|GateD privileges' 5 passed
pnpm run test:gate-d                                      105 passed
```

The direct database focus returned `5 passed, 32 skipped by focus filter`; the final aggregate skipped none. RED failures were expected pre-implementation evidence, not waived checks. Two fresh-ID V3 cancellation runs exposed pinned Restate signal-consumption semantics and triggered Scope Review 4; the amended exact outcome passed. The first metrics subprocess attempt failed with Windows `spawn EINVAL`; direct Node Vitest execution replaced it and the complete measurement rerun passed. No required final check failed or was skipped.

## Privacy/private-interface checks

Production imports and runtime calls were scanned for private Restate storage/API access: none. V6 scanned synthetic plaintext, SHA-256 hex, Base64URL digest, and hex-encoded UTF-8 forms across logical application text/JSON columns outside the deletable store, supported `sys_invocation` and `sys_journal` surfaces, approved results/errors, worker logs, Restate logs, and exported evidence. Final scans found zero forbidden matches.

## Scope reviews

Dated Scope Reviews 1–4 are part of the evidence chain. They preserve the original start/deadline and outcomes while correcting incomplete mappings, making the concurrent snapshot proof deterministic and externally identifiable, and aligning cancellation sequencing with pinned Restate 1.7.2 signal-consumption semantics. No review weakens a frozen expected outcome.

## Proven boundaries and limitations

Proven here:

- the approved client submits only validated semantic requests and opaque payload references;
- canonical state changes only through deterministic validation and the approved PostgreSQL function;
- runtime identity cannot own or directly read/mutate/truncate canonical tables or escalate to the owner role;
- synthetic optional payload bytes and tested derived forms are absent from logical application storage outside the deletable store, supported Restate invocation/journal surfaces, approved results/errors, and inspected logs after erasure.

Not proven:

- WAL, backups, replicas, private Restate storage, or physical restoration erasure;
- unauthorized direct-ingress payload submission;
- distributed/multi-node operation or production SLOs;
- event replay, LLM behavior, UI, memory portability, natural-person identity, consciousness, or subjective continuity.

## Conclusion

Pinned Restate/PostgreSQL satisfies the complete frozen Gate-D foundation benchmark within the original eight-hour bound and production line cap. The evidence supports foundation V3 promotion only. It does not authorize T4 automatically and does not justify custom persistence.
