# Ten Foundation Invariants

Each invariant maps to at least one frozen headline vector in `conformance-vectors.md`.

1. **Scoped stable identifiers**

   Every canonical entity has an immutable ID within an explicit namespace. Display names, credentials, controllers, and profiles are mutable and separate. No kernel identifier proves natural-person identity.

   Evidence: V2, V5; cross-namespace supporting assertion.

2. **Single canonical case state**

   One case and commitment cannot occupy conflicting canonical statuses or owners at the same domain time.

   Evidence: V3, V4, V5.

3. **Authorization and scope**

   An agent cannot read, resolve, reassign, erase, or otherwise modify a case or payload outside its current grant and case scope. Race outcomes follow an explicit transaction linearization order.

   Evidence: V1; runtime-role negative privilege assertion.

4. **Single canonical commit path**

   Every accepted change passes deterministic validation and one atomic canonical transaction. The runtime role has no direct canonical-table DML or ownership and writes only through the approved commit function inside the official DBOS datasource transaction.

   Evidence: V1, V3, V4; runtime-role negative privilege assertion.

5. **Minimum auditable history**

   Accepted changes and rejected decisions are traceable without embedding unnecessary personal content. Retention is purpose-limited; append-only treatment applies only where continued retention is necessary and lawful. Required history remains valid when an optional payload is absent or erased.

   Evidence: V1, V4, V6.

6. **Atomicity, concurrency, and conflict-aware idempotency**

   Invalid actions change nothing. Partial transitions, duplicate execution, command-ID/request-hash mismatches, and silent sequence forks are prevented. DBOS workflow-ID reuse is not request-equivalence proof.

   Evidence: V2, V3, V4.

7. **Recovery equivalence**

   Under the frozen topology and supported versions, documented recovery produces the same canonical state digest and position. Terminal error, cancellation, recovery exhaustion, and version mismatch are distinct outcomes.

   Evidence: V4, V5; watchdog supporting assertion.

8. **Causal traceability**

   Every accepted change identifies actor, command/proposal, authorization and validator versions, causation, correlation, and resulting canonical record. A rejection has machine-readable reasons but no accepted state-changing record.

   Evidence: V1, V2, V4.

9. **Explicit time and external inputs**

   Semantic world time, ingestion time, and wall-clock time are distinct. Randomness, model outputs, and external observations that can influence canonical state are captured or prohibited. Request hashes include only declared semantic time.

   Evidence: V2, V5; canonical-JSON supporting assertions.

10. **Versioned authority and adapters**

    Material authorization, consent, schema, validator, projector, serializer, request-hash, or compatibility changes are explicit and auditable. Unsupported versions fail closed; no adapter silently redefines canonical truth.

    Evidence: V1, V2, V5.

## Promotion rule

All ten invariants must pass against the surviving direction before the foundation can be promoted. Passing only the six headlines does not waive mandatory supporting assertions.
