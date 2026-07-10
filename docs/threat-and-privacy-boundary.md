# Threat and Privacy Boundary

**Foundation data classification:** synthetic only.

## Protected properties

The benchmark tests:

- authorization and case-scope enforcement;
- one canonical transaction path;
- command-ID/request-hash conflict detection;
- expected-version concurrency control;
- recovery equivalence under pinned versions;
- optional-payload separation and erasure mechanics;
- minimum privacy-limited decision evidence;
- database privilege inability to bypass canonical writes.

## Roles

- **Domain owner/migrator:** non-login role owning the domain schema, canonical tables, and canonical-commit function.
- **Runtime `continuity_app`:** no ownership or direct DML on canonical state, command receipt, or accepted-history tables; minimum schema usage and execution of the approved commit function only.
- **DBOS operational role privileges:** separate and limited to required DBOS schemas/tables.
- **Independent test/management parent:** starts/kills the worker, performs durable cancellation, checks receipts/state, and records evidence.

The `SECURITY DEFINER` commit function must use schema-qualified objects, a fixed safe `search_path`, no dynamic SQL, revoked `PUBLIC` execution, and database rechecks for authorization version, expected case version, request hash, and constraints.

## Request boundary

`requestHashEnvelopeV1` contains semantic request fields only. It excludes command/workflow IDs, transport/correlation metadata, wall-clock receipt/ingestion fields, logs, and diagnostics.

The semantic payload may contain an opaque `PayloadRef`; it must not contain optional payload bytes or a plaintext-derived payload hash.

## Optional payload rule

Optional payload bytes must never enter durable DBOS:

- workflow requests or inputs;
- workflow/step/transaction outputs;
- errors or exception text;
- attributes, messages, events, event history, or streams;
- transaction-completion records;
- logs, traces, or exports.

Only an opaque governed `PayloadRef` may cross a durable runtime boundary.

## Erasure evidence

The V6 sentinel scan covers logical application tables, all DBOS system/completion tables, logs, traces, and exports in the frozen local topology. Passing proves separation mechanics only.

It does not prove deletion from expired/non-local backups, WAL archives, replicas, external telemetry, or future restore media. Those remain documented operational boundaries.

Retained deletion facts, IDs, metadata, request hashes, and digests may still be personal data in a real deployment and need their own purpose, access, retention, and lawful-basis analysis.

## Explicitly out of scope

- real personal, biometric, medical, or neural data;
- authentication-system production hardening;
- internet exposure or multi-tenant deployment;
- key destruction as automatic proof of erasure/anonymisation;
- legal-compliance certification;
- adversaries with operating-system, database-owner, or supply-chain control.
