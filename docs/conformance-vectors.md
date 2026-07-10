# Frozen Conformance Vectors

**Contract version:** `continuity-kernel-v0-t1`
**Status:** frozen for T2 after static verification on 2026-07-10
**Data:** synthetic only

Expected outcomes in this file must not be changed after the T2 start timestamp to make an incumbent pass.

## Shared fixture

```json
{
  "namespaceId": "ns:test:continuity-kernel-v0",
  "caseId": "case:test:001",
  "ownerAgentId": "agent:test:owner-001",
  "otherAgentId": "agent:test:other-001",
  "authorizationGrantId": "grant:test:case-001:owner-001",
  "authorizationVersion": "7",
  "caseVersion": "3",
  "commitmentDeadline": "2026-07-11T12:00:00Z",
  "worldTime": "2026-07-11T10:00:00Z",
  "payloadRef": "payload:test:attachment-001"
}
```

Version/position values use decimal strings at TypeScript/JSON boundaries.

## Request-hash contract

Algorithm identifier: `rfc8785-sha256-base64url-nopad-v1`

```text
base64url-no-pad(SHA-256(UTF8(RFC8785_JCS(requestHashEnvelopeV1))))
```

`requestHashEnvelopeV1` includes exactly:

- `requestHashSchemaVersion` — JSON number `1`;
- `namespaceId`;
- `caseId`;
- `actorId`;
- `authorizationGrantId`;
- `authorizationVersion` as a decimal string;
- `expectedCaseVersion` as a decimal string;
- `actionType`;
- `actionPayload` conforming to the versioned command schema, with I-JSON values and optional opaque `PayloadRef` only;
- semantic `worldTime`, always present as an RFC 3339 UTC string.

Runtime schema validation rejects `undefined`, undeclared properties, duplicate keys, lone surrogates, and non-I-JSON values before canonicalization. An optional property that is absent according to the command schema is omitted from the normalized envelope; it is never represented as `undefined`.

It excludes command/workflow IDs, transport/correlation metadata, receipt/ingestion time, logs, diagnostics, optional payload bytes, and plaintext-derived payload hashes.

The server computes this hash before invoking DBOS. After DBOS returns a new or existing result, the server compares the returned receipt hash. The canonical transaction independently enforces unique `(namespace_id, command_id)` and stored-hash equality.

### Request fixture A — completed

Input object:

```json
{
  "requestHashSchemaVersion": 1,
  "namespaceId": "ns:test:continuity-kernel-v0",
  "caseId": "case:test:001",
  "actorId": "agent:test:owner-001",
  "authorizationGrantId": "grant:test:case-001:owner-001",
  "authorizationVersion": "7",
  "expectedCaseVersion": "3",
  "actionType": "resolve_case",
  "actionPayload": {
    "commitmentDeadline": "2026-07-11T12:00:00Z",
    "payloadRef": "payload:test:attachment-001",
    "resolution": "completed"
  },
  "worldTime": "2026-07-11T10:00:00Z"
}
```

Canonical UTF-8 text:

```json
{"actionPayload":{"commitmentDeadline":"2026-07-11T12:00:00Z","payloadRef":"payload:test:attachment-001","resolution":"completed"},"actionType":"resolve_case","actorId":"agent:test:owner-001","authorizationGrantId":"grant:test:case-001:owner-001","authorizationVersion":"7","caseId":"case:test:001","expectedCaseVersion":"3","namespaceId":"ns:test:continuity-kernel-v0","requestHashSchemaVersion":1,"worldTime":"2026-07-11T10:00:00Z"}
```

```text
SHA-256 hex: 8e58d7274e99c02bc396c8bbc62afe3d034a16ef8160864596536e2fdc93b876
Base64URL no padding: jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY
```

### Request fixture B — cancelled

Same envelope except `actionPayload.resolution` is `cancelled`.

Canonical UTF-8 text:

```json
{"actionPayload":{"commitmentDeadline":"2026-07-11T12:00:00Z","payloadRef":"payload:test:attachment-001","resolution":"cancelled"},"actionType":"resolve_case","actorId":"agent:test:owner-001","authorizationGrantId":"grant:test:case-001:owner-001","authorizationVersion":"7","caseId":"case:test:001","expectedCaseVersion":"3","namespaceId":"ns:test:continuity-kernel-v0","requestHashSchemaVersion":1,"worldTime":"2026-07-11T10:00:00Z"}
```

```text
SHA-256 hex: 1d2afde2c5f1fe0ace0af6aa33abcc2b30ce25e5eeb3c97ed9f0c1159275daa5
Base64URL no padding: HSr94sXx_grOCvaqM6vMKzDOJeXus8l-2fDBFZJ12qU
```

## V1 — Authorization and ordered revocation races

### V1A Out-of-scope actor

`otherAgentId` attempts `resolve_case`.

Expected:

- typed `AUTHORIZATION_DENIED` receipt/rejection;
- permitted privacy-limited decision audit;
- no accepted canonical transition/history;
- case remains version `3`.

### V1B Revocation-first

A barrier ensures grant version `7` is revoked and version `8` commits before command validation begins.

Expected:

- typed `AUTHORIZATION_REVOKED` or `AUTHORIZATION_VERSION_CONFLICT`;
- no accepted canonical transition/history;
- case remains version `3`.

### V1C Command-first

A barrier lets the valid version-`7` command lock/check the grant and case and commit before revocation linearizes.

Expected:

- exactly one accepted transition to case version `4`;
- revocation subsequently commits as version `8`;
- the accepted command is not retroactively relabelled invalid.

The commit function must lock/recheck grant and case versions in one transaction. Queue serialization is forbidden as proof.

## V2 — Conflict-aware durable command idempotency

Use command ID `cmd:test:resolve-001`.

### V2A Same ID, same hash

Two processes concurrently submit fixture A.

Expected:

- both obtain the same stored receipt/outcome;
- exactly one canonical transition exists;
- exactly one accepted-history record exists.

### V2B Same ID, different hash

Reuse the command ID with fixture B after fixture A owns the receipt.

Expected:

- server returns `IDEMPOTENCY_KEY_REUSED` even if DBOS returns an existing workflow handle;
- canonical transaction independently detects the stored-hash mismatch;
- no second transition/history record exists.

Repeat after process restart, DBOS fork/new workflow ID, and DBOS workflow-history deletion. Domain idempotency must survive all cases.

## V3 — Unqueued expected-version conflict and retry deadline

Two distinct command IDs from separate processes/connections submit fixture A and fixture B against expected case version `3`. A barrier ensures both begin from the same version. Do not use a queue or concurrency-one setting.

Expected:

- exactly one command commits version `4`;
- the other returns typed `EXPECTED_VERSION_CONFLICT`;
- no forked truth or duplicate canonical position;
- retry attempts are counted;
- the parent watchdog enforces the frozen deadline.

If the deadline expires:

1. kill the worker process;
2. durably cancel the workflow from the independent client before restart;
3. read the domain receipt to classify prior state versus an already committed result;
4. restart the pinned application version;
5. observe no new transition after cancellation.

`Promise.race` or a caller-only timeout does not pass.

## V4 — External-kill crash-boundary recovery

Use external process termination, not a thrown exception.

### V4A Before canonical transaction

Kill after workflow start but before the datasource transaction begins.

Expected after restart: prior state/version/digest only.

### V4B Inside transaction before commit

The transaction performs an intermediate canonical write and signals the parent while held before commit; the parent kills the worker.

Expected after restart: transaction rollback, prior state/version/digest, no receipt or accepted-history fragment.

### V4C After commit before workflow/HTTP completion

Kill after the datasource transaction and its completion checkpoint commit but before workflow/HTTP acknowledgement.

Expected after restart: exactly one committed state, receipt, and accepted-history record; retry returns the stored result without a second transition.

Terminal workflow error, durable cancellation, recovery-attempt exhaustion, and application-version mismatch are separate explicit outcomes and must not be called crash recovery.

## V5 — Stable materialization, digest, and version failure

Projection fixture:

```json
{
  "projectionSchemaVersion": 1,
  "namespaceId": "ns:test:continuity-kernel-v0",
  "case": {
    "caseId": "case:test:001",
    "ownerAgentId": "agent:test:owner-001",
    "version": "4",
    "status": "resolved",
    "commitment": {
      "deadline": "2026-07-11T12:00:00Z",
      "status": "completed"
    }
  }
}
```

Canonical UTF-8 text:

```json
{"case":{"caseId":"case:test:001","commitment":{"deadline":"2026-07-11T12:00:00Z","status":"completed"},"ownerAgentId":"agent:test:owner-001","status":"resolved","version":"4"},"namespaceId":"ns:test:continuity-kernel-v0","projectionSchemaVersion":1}
```

```text
Algorithm: rfc8785-sha256-base64url-nopad-v1
SHA-256 hex: 004329709ea92693688385de4cea8dc9b7fa4af5989b20895683de3a2932c14b
Base64URL no padding: AEMpcJ6pJpNog4XeTOqNybf6SvWYmyCJVoPeOikywUs
```

Expected:

- repeated processes/restarts produce the exact digest and canonical position;
- unsupported domain, request-hash, authorization, validator/rule, projection, serializer, or DBOS application versions fail explicitly;
- no operation is called event replay unless an event-sourced candidate is later approved.

Canonicalization assertions include nested key order, array order, composed/decomposed Unicode distinction, non-BMP sorting, lone-surrogate rejection, duplicate-key rejection at ingestion, verified-errata negative-zero rejection, non-finite rejection, and decimal-string handling beyond JavaScript safe integers.

## V6 — Optional-payload erasure without durable leakage

Sentinel:

```text
CK_PRIVATE_PAYLOAD_SENTINEL_20260711_A9F4C2E7
```

The sentinel appears only in the synthetic deletable payload store. Durable code and DBOS receive only `payload:test:attachment-001`.

Expected after erasure:

- required case, receipt, accepted history, deletion fact, projection, and digest remain valid;
- sentinel is absent from logical application tables outside the payload store;
- sentinel is absent from every DBOS system and datasource-completion table;
- sentinel is absent from logs, traces, messages, events/history, streams, errors, attributes, transaction results, and exports in the frozen topology;
- backup/WAL/replica expiration and restore handling are reported as unproven boundaries.

Passing proves separation mechanics only, not legal compliance or anonymisation.

## Mandatory supporting assertions

- mid-transaction rollback is all-or-none;
- direct DML, truncate, and ownership-dependent operations fail for `continuity_app`;
- canonical writes succeed only through the fixed-search-path, public-execution-revoked commit function;
- cross-namespace IDs do not collide;
- request hashes survive DBOS management/fork/history changes;
- malformed and unsupported runtime-schema values fail closed;
- retry/watchdog/cancellation outcomes cannot commit after durable cancellation;
- no fixture contains real personal, biometric, medical, or neural data.
