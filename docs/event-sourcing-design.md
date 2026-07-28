# Event-Sourcing Design: Append-Only Event Ledger

**Status:** Proposed — review and approval required before #P3-2 (schema migration)

**Scope:** Phase 3 event ledger for adoption, custody, pet, and user aggregates.

## 1. Purpose

The event ledger is the authoritative, append-only history of domain facts. It records every accepted state-changing action in a deterministic order so that aggregate state can be rebuilt, audit history can be inspected, and batches of events can be anchored to Stellar.

This document is a design specification only. It intentionally contains no database migration or application implementation. The schema migration must not begin until this design has been reviewed and approved.

## 2. Ledger versus the existing `events` table

The existing event log is an operational audit/logging facility. It may contain application-generated records, optional metadata, transaction information, and events that are useful for diagnostics. It is not currently designed to be the authoritative history of an aggregate.

The Phase 3 ledger is different in the following ways:

| Property | Existing events table | Event ledger |
| --- | --- | --- |
| Authority | Operational log | Authoritative domain history |
| Mutability | Existing update/delete behavior must not be relied upon | Append-only and immutable after insertion |
| Ordering | No aggregate sequence guarantee | Strict sequence per aggregate, starting at 1 |
| Integrity | Database row identity and timestamps | Previous-event linkage plus content hash |
| Anchoring | Optional transaction/block fields | Explicit Stellar anchor records for ledger batches |
| Replay | Not guaranteed to reconstruct state | Designed for deterministic aggregate replay |
| Event contract | Existing event enum/payload conventions | Versioned, documented payload contract per event type |

The existing table must not be retroactively treated as the ledger. A future migration may define a separate ledger table and, if needed, a one-time migration/import policy. Existing operational events that cannot satisfy the ledger invariants remain operational history and are not silently presented as ledger events.

## 3. Design principles

1. **Facts, not commands:** A ledger event states that something happened; it does not represent a request to perform an action.
2. **Append-only:** Existing ledger rows are never updated or deleted through the application or normal database credentials.
3. **Per-aggregate order:** Events for one aggregate have a contiguous, unique sequence.
4. **Deterministic replay:** Payloads contain the facts needed to rebuild the aggregate without depending on mutable external records.
5. **Versioned contracts:** Every payload has an explicit schema version. New incompatible payloads require a new event version or event type.
6. **Privacy by minimization:** Payloads contain stable identifiers and domain facts, not passwords, tokens, payment secrets, or unnecessary personal data.
7. **Anchored integrity:** Ledger event hashes can be committed to Stellar through a Merkle-root batch anchor.

## 4. Ledger event envelope

Each ledger row has the following logical envelope. Physical column types and indexes are deferred to #P3-2.

```json
{
  "id": "uuid",
  "aggregateType": "ADOPTION",
  "aggregateId": "uuid",
  "sequence": 1,
  "eventType": "ADOPTION_REQUESTED",
  "eventVersion": 1,
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "recordedAt": "2026-07-28T12:00:00.010Z",
  "actorId": "uuid",
  "correlationId": "uuid",
  "causationId": "uuid",
  "payload": {},
  "metadata": {},
  "previousEventHash": null,
  "eventHash": "sha256-hex",
  "anchorBatchId": null
}
```

Field requirements:

- `id`: Globally unique immutable event identifier.
- `aggregateType`: One of `ADOPTION`, `CUSTODY`, `PET`, or `USER`.
- `aggregateId`: Identifier of the aggregate whose history this event belongs to.
- `sequence`: One-based integer sequence within `(aggregateType, aggregateId)`.
- `eventType`: Event name from the catalog below.
- `eventVersion`: Positive integer version of the payload contract.
- `occurredAt`: Time the domain fact occurred.
- `recordedAt`: Time the ledger accepted the event.
- `actorId`: User or system actor responsible for the fact; nullable for system events where no user actor exists.
- `correlationId`: Identifier shared by all events produced by one business workflow/request.
- `causationId`: Identifier of the event or command that directly caused this event; nullable for the first event in a workflow.
- `payload`: Event-specific JSON object, validated before insertion.
- `metadata`: Non-domain context such as request ID, source service, or client version. It is not used to rebuild state.
- `previousEventHash`: Hash of the immediately preceding event for the same aggregate, or `null` for sequence 1.
- `eventHash`: Canonical hash of the immutable event contents, including the previous hash.
- `anchorBatchId`: Nullable until the event is included in a Stellar anchor batch. Setting it is an anchoring operation, not a change to the event's domain contents.

`actorId`, `correlationId`, and `causationId` are references only; replay must not require those referenced rows to remain mutable or present.

## 5. Aggregate types and event catalog

### 5.1 ADOPTION

The adoption aggregate represents one adoption request and its lifecycle.
# Event Sourcing Design

## Overview

PetAd uses `EventLedger` as the canonical store for new aggregate events. The existing `events`/`eventLog` table remains available for backward compatibility with existing consumers and historical records. New code must write ledger-compatible events and must not require existing rows to be rewritten before deployment.

## Canonical Event Types

Event types are grouped by aggregate and are defined in `src/events/types/event.types.ts`.

### Adoption

- `ADOPTION_REQUESTED`
- `ADOPTION_APPROVED`
- `ADOPTION_REJECTED`
- `ADOPTION_CANCELLED`
- `ADOPTION_ESCROW_FUNDED`
- `ADOPTION_COMPLETED`

### 5.2 CUSTODY

The custody aggregate represents one temporary custody agreement and its lifecycle.

- `CUSTODY_REQUESTED`
- `CUSTODY_APPROVED`
- `CUSTODY_REJECTED`
- `CUSTODY_STARTED`
- `CUSTODY_EXTENDED`
- `CUSTODY_COMPLETED`
- `CUSTODY_CANCELLED`
- `CUSTODY_VIOLATION_REPORTED`

### 5.3 PET

The pet aggregate represents a pet profile and its availability/status lifecycle.

- `PET_REGISTERED`
- `PET_UPDATED`
- `PET_STATUS_CHANGED`
- `PET_ASSIGNED_TO_OWNER`
- `PET_TRANSFERRED`
- `PET_DELETED`

`PET_DELETED` represents a domain deletion/retirement fact. It does not authorize deletion of ledger history.

### 5.4 USER

The user aggregate represents a platform user and account lifecycle.

- `USER_REGISTERED`
- `USER_PROFILE_UPDATED`
- `USER_ROLE_CHANGED`
- `USER_VERIFIED`
- `USER_SUSPENDED`
- `USER_REACTIVATED`
- `USER_DELETED`

## 6. Payload contracts

All payloads are JSON objects. UUID fields are strings in canonical UUID format. Date-time fields are ISO 8601 UTC strings. Monetary amounts are decimal strings, never binary floating-point numbers. Fields marked `nullable` may explicitly contain `null`; fields marked optional may be omitted.

### 6.1 Adoption payloads

#### `ADOPTION_REQUESTED` v1

```json
{
  "adoptionId": "uuid",
  "petId": "uuid",
  "adopterId": "uuid",
  "ownerId": "uuid",
  "notes": "string|null",
  "requestedAt": "datetime"
}
```

Required: `adoptionId`, `petId`, `adopterId`, `ownerId`, `requestedAt`. `notes` is nullable and limited to the existing domain maximum.

#### `ADOPTION_APPROVED` v1

```json
{
  "adoptionId": "uuid",
  "approvedBy": "uuid",
  "approvedAt": "datetime",
  "petId": "uuid",
  "adopterId": "uuid"
}
```

Required: all fields.

#### `ADOPTION_REJECTED` v1

```json
{
  "adoptionId": "uuid",
  "rejectedBy": "uuid",
  "rejectedAt": "datetime",
  "reason": "string|null",
  "petId": "uuid",
  "adopterId": "uuid"
}
```

Required: `adoptionId`, `rejectedBy`, `rejectedAt`, `petId`, `adopterId`. `reason` is nullable.

#### `ADOPTION_CANCELLED` v1

```json
{
  "adoptionId": "uuid",
  "cancelledBy": "uuid",
  "cancelledAt": "datetime",
  "reason": "string|null"
}
```

Required: `adoptionId`, `cancelledBy`, `cancelledAt`. `reason` is nullable.

#### `ADOPTION_ESCROW_FUNDED` v1

```json
{
  "adoptionId": "uuid",
  "fundedAt": "datetime",
  "amount": "decimal-string",
  "assetCode": "string",
  "assetIssuer": "string|null",
  "stellarTransactionHash": "string",
  "stellarNetwork": "string"
}
```

Required: all fields except nullable `assetIssuer`.

#### `ADOPTION_COMPLETED` v1

```json
{
  "adoptionId": "uuid",
  "completedBy": "uuid|null",
  "completedAt": "datetime",
  "petId": "uuid",
  "adopterId": "uuid"
}
```

Required: `adoptionId`, `completedAt`, `petId`, `adopterId`. `completedBy` is nullable for an automated completion.

### 6.2 Custody payloads

#### `CUSTODY_REQUESTED` v1

```json
{
  "custodyId": "uuid",
  "petId": "uuid",
  "requesterId": "uuid",
  "ownerId": "uuid",
  "startDate": "datetime",
  "durationDays": 1,
  "depositAmount": "decimal-string|null",
  "requestedAt": "datetime"
}
```

Required: `custodyId`, `petId`, `requesterId`, `ownerId`, `startDate`, `durationDays`, `requestedAt`. `depositAmount` is nullable.

#### `CUSTODY_APPROVED` v1

```json
{
  "custodyId": "uuid",
  "approvedBy": "uuid",
  "approvedAt": "datetime",
  "petId": "uuid",
  "requesterId": "uuid"
}
```

Required: all fields.

#### `CUSTODY_REJECTED` v1

```json
{
  "custodyId": "uuid",
  "rejectedBy": "uuid",
  "rejectedAt": "datetime",
  "reason": "string|null"
}
```

Required: `custodyId`, `rejectedBy`, `rejectedAt`. `reason` is nullable.

#### `CUSTODY_STARTED` v1

```json
{
  "custodyId": "uuid",
  "petId": "uuid",
  "requesterId": "uuid",
  "startedAt": "datetime",
  "expectedEndAt": "datetime"
}
```

Required: all fields.

#### `CUSTODY_EXTENDED` v1

```json
{
  "custodyId": "uuid",
  "extendedBy": "uuid",
  "extendedAt": "datetime",
  "previousEndAt": "datetime",
  "newEndAt": "datetime",
  "additionalDays": 1,
  "reason": "string|null"
}
```

Required: all fields except nullable `reason`.

#### `CUSTODY_COMPLETED` v1

```json
{
  "custodyId": "uuid",
  "completedBy": "uuid|null",
  "completedAt": "datetime",
  "petId": "uuid",
  "returned": true
}
```

Required: `custodyId`, `completedAt`, `petId`, `returned`. `completedBy` is nullable for automated completion.

#### `CUSTODY_CANCELLED` v1

```json
{
  "custodyId": "uuid",
  "cancelledBy": "uuid",
  "cancelledAt": "datetime",
  "reason": "string|null"
}
```

Required: `custodyId`, `cancelledBy`, `cancelledAt`. `reason` is nullable.

#### `CUSTODY_VIOLATION_REPORTED` v1

```json
{
  "custodyId": "uuid",
  "reportedBy": "uuid",
  "reportedAt": "datetime",
  "violationType": "string",
  "description": "string",
  "evidenceReference": "string|null"
}
```

Required: `custodyId`, `reportedBy`, `reportedAt`, `violationType`, `description`. `evidenceReference` is nullable and must reference stored evidence rather than embedding files or secrets.

### 6.3 Pet payloads

#### `PET_REGISTERED` v1

```json
{
  "petId": "uuid",
  "ownerId": "uuid",
  "name": "string",
  "species": "string",
  "breed": "string|null",
  "gender": "string|null",
  "size": "string|null",
  "birthDate": "date|null",
  "status": "AVAILABLE",
  "registeredAt": "datetime"
}
```

Required: `petId`, `ownerId`, `name`, `species`, `status`, `registeredAt`. Other profile fields are nullable.

#### `PET_UPDATED` v1

```json
{
  "petId": "uuid",
  "updatedBy": "uuid",
  "updatedAt": "datetime",
  "changes": {
    "fieldName": {
      "old": "json|null",
      "new": "json|null"
    }
  }
}
```

Required: `petId`, `updatedBy`, `updatedAt`, and a non-empty `changes` object. Only approved pet profile fields may appear in `changes`; status and ownership changes use their dedicated events.

#### `PET_STATUS_CHANGED` v1

```json
{
  "petId": "uuid",
  "changedBy": "uuid|null",
  "changedAt": "datetime",
  "fromStatus": "string",
  "toStatus": "string",
  "reason": "string|null",
  "relatedAggregateType": "ADOPTION|CUSTODY|null",
  "relatedAggregateId": "uuid|null"
}
```

Required: `petId`, `changedAt`, `fromStatus`, `toStatus`. Actor, reason, and related aggregate fields are nullable for system transitions.

#### `PET_ASSIGNED_TO_OWNER` v1

```json
{
  "petId": "uuid",
  "previousOwnerId": "uuid|null",
  "newOwnerId": "uuid",
  "assignedBy": "uuid|null",
  "assignedAt": "datetime",
  "reason": "string|null"
}
```

Required: `petId`, `newOwnerId`, `assignedAt`. `previousOwnerId`, `assignedBy`, and `reason` are nullable.

#### `PET_TRANSFERRED` v1

```json
{
  "petId": "uuid",
  "fromOwnerId": "uuid",
  "toOwnerId": "uuid",
  "transferredBy": "uuid|null",
  "transferredAt": "datetime",
  "relatedAdoptionId": "uuid|null",
  "reason": "string|null"
}
```

Required: `petId`, `fromOwnerId`, `toOwnerId`, `transferredAt`. Other fields are nullable.

#### `PET_DELETED` v1

```json
{
  "petId": "uuid",
  "deletedBy": "uuid",
  "deletedAt": "datetime",
  "reason": "string|null"
}
```

Required: `petId`, `deletedBy`, `deletedAt`. `reason` is nullable.

### 6.4 User payloads

#### `USER_REGISTERED` v1

```json
{
  "userId": "uuid",
  "email": "string",
  "role": "string",
  "registeredAt": "datetime"
}
```

Required: all fields. Email is recorded for historical identification and must follow the platform's normalization rules; passwords are never recorded.

#### `USER_PROFILE_UPDATED` v1

```json
{
  "userId": "uuid",
  "updatedBy": "uuid|null",
  "updatedAt": "datetime",
  "changes": {
    "fieldName": {
      "old": "json|null",
      "new": "json|null"
    }
  }
}
```

Required: `userId`, `updatedAt`, and a non-empty `changes` object. `updatedBy` is nullable for system updates. Passwords, password hashes, tokens, and security answers are prohibited.

#### `USER_ROLE_CHANGED` v1

```json
{
  "userId": "uuid",
  "changedBy": "uuid|null",
  "changedAt": "datetime",
  "fromRole": "string",
  "toRole": "string",
  "reason": "string|null"
}
```

Required: `userId`, `changedAt`, `fromRole`, `toRole`. `changedBy` and `reason` are nullable for automated changes.

#### `USER_VERIFIED` v1

```json
{
  "userId": "uuid",
  "verifiedAt": "datetime",
  "verificationMethod": "string"
}
```

Required: all fields. Verification tokens or documents are not embedded; only a method/reference may be recorded.

#### `USER_SUSPENDED` v1

```json
{
  "userId": "uuid",
  "suspendedBy": "uuid|null",
  "suspendedAt": "datetime",
  "reason": "string"
}
```

Required: `userId`, `suspendedAt`, and `reason`. `suspendedBy` is nullable for automated enforcement.

#### `USER_REACTIVATED` v1

```json
{
  "userId": "uuid",
  "reactivatedBy": "uuid|null",
  "reactivatedAt": "datetime",
  "reason": "string|null"
}
```

Required: `userId`, `reactivatedAt`. `reactivatedBy` and `reason` are nullable.

#### `USER_DELETED` v1

```json
{
  "userId": "uuid",
  "deletedBy": "uuid|null",
  "deletedAt": "datetime",
  "reason": "string|null"
}
```

Required: `userId`, `deletedAt`. `deletedBy` and `reason` are nullable. Personal data retention and redaction rules must be applied without modifying ledger rows; where required, sensitive values should be represented by stable references or encrypted values before insertion.

## 7. Sequence number strategy

Sequences are scoped to an aggregate, not global to the entire ledger. The uniqueness rule is:

```text
UNIQUE(aggregateType, aggregateId, sequence)
```

For each aggregate:

- The first event has `sequence = 1`.
- Each later event has the previous sequence plus one.
- No gaps are permitted in a committed aggregate stream.
- Sequence allocation and event insertion occur in one database transaction.
- Concurrent writers serialize on the aggregate stream. The writer locks the aggregate's current stream/sequence, calculates the next sequence, inserts the event, and commits atomically.
- A uniqueness constraint is the final race-condition guard. A conflict must cause the transaction to retry or fail; it must never overwrite an existing event.
- Sequence values are never reused. A rolled-back transaction does not create a committed sequence and a committed event is never removed to make a number available.
- Cross-aggregate ordering is intentionally not defined. `recordedAt` is informational and must not be used as a replay order across aggregates.

The aggregate type is part of the stream key so that identical IDs in different aggregate namespaces cannot collide.

## 8. Immutability strategy

Immutability is enforced in layers:

1. **Database constraints:** Ledger identity, aggregate key, sequence, event hash, and required fields are constrained. The ledger table must not expose update/delete application APIs.
2. **Database permissions:** The application database role receives `INSERT` and `SELECT` access for the ledger and does not receive `UPDATE` or `DELETE` privileges. A separate, tightly controlled administrative role may be used for disaster recovery only, with audited access.
3. **Application guard:** The ledger repository exposes append and read operations only. No update, delete, or generic save operation is provided. Incoming events are validated against the event catalog and payload version before insertion.
4. **Hash chaining:** `previousEventHash` must match the prior event in the same aggregate stream. `eventHash` is calculated from a canonical serialization of immutable envelope fields, payload, and the previous hash.
5. **Operational monitoring:** Attempts to update/delete ledger rows, sequence conflicts, hash mismatches, and invalid payloads are logged and alerted.

The database constraint/permission layer is authoritative. The application guard improves safety and developer ergonomics but is not sufficient by itself.

Adding an anchor reference after anchoring is allowed only through a dedicated anchoring operation, and only the nullable `anchorBatchId` (or equivalent anchoring association) may be written. Event payload, event type, sequence, timestamps, actor, and hashes remain immutable. If strict row immutability is required by the final migration, anchoring must instead use a separate relation table so no ledger row is updated.

## 9. Event hash and canonicalization

The event hash is a SHA-256 digest over a canonical JSON representation containing:

- `id`
- `aggregateType`
- `aggregateId`
- `sequence`
- `eventType`
- `eventVersion`
- `occurredAt`
- `recordedAt`
- `actorId`
- `correlationId`
- `causationId`
- `payload`
- `metadata`
- `previousEventHash`

Canonicalization must use stable object-key ordering, UTF-8 encoding, no insignificant whitespace, and an explicit representation for null values. The exact canonicalization library/algorithm must be selected and locked before implementation; changing it creates a new ledger/hash version and is not a silent behavior change.

## 10. Relationship to Stellar anchor hashes

The ledger remains the local source of truth for the complete event stream. Stellar is an external integrity witness, not the event store and not a replacement for payload storage.

Anchoring process:

1. Select a contiguous, committed range of ledger events that is not already anchored.
2. Compute each event's `eventHash` using the canonical algorithm.
3. Build a deterministic Merkle tree from the event hashes, with documented ordering and odd-node handling.
4. Publish the Merkle root and identifying batch data in a Stellar transaction/memo or the agreed PetAd Stellar anchoring mechanism.
5. Store an anchor record containing the batch ID, first and last ledger event IDs/sequences, Merkle root, Stellar transaction hash, network, ledger number, and confirmation time.
6. Associate each included event with that anchor batch through an immutable association or a dedicated anchoring relation.

A Stellar transaction hash is not the same thing as an event hash. The transaction hash identifies the on-chain transaction; the Merkle root commits to the selected set of local ledger event hashes. Payloads are not placed on-chain.

An event may be considered **anchored** only after the Stellar transaction is confirmed according to the platform's confirmation policy. Anchor failures do not modify or remove local events; the batch remains pending or failed and may be retried with a new transaction. A later anchor may cover the same events only under an explicit retry/idempotency policy.

Verification uses the event payload and envelope, recomputes the event hash, verifies the previous-event chain, verifies the Merkle proof against the stored root, and compares that root with the confirmed Stellar anchor transaction.

## 11. Transaction and failure semantics

A domain state change and its corresponding ledger event must be committed in the same database transaction. If either operation fails, neither is committed. External Stellar publication must occur after local commit because a database transaction cannot atomically include a Stellar transaction.

Consumers must process events idempotently using the immutable event ID and aggregate sequence. A duplicate delivery is ignored after the event has already been applied. Consumers must reject an unexpected sequence and stop rather than silently applying events out of order.

## 12. Compatibility with the existing event log

The existing `events` module and `eventLog` table remain operational logging infrastructure until a later implementation issue explicitly changes them. The ledger design does not require renaming, modifying, or backfilling that table.

When a domain operation is migrated to the ledger, the implementation must define whether it also emits the existing operational event. If both are emitted, the ledger event is authoritative and the operational log contains a reference to the ledger event ID. No consumer may infer ledger sequence or anchor state from the existing event log.

## 13. Review gate before #P3-2

Before any schema migration is written, reviewers must approve:

- The four aggregate types and the complete event catalog.
- The payload fields, nullability, and versioning rules.
- Per-aggregate sequence allocation and concurrency behavior.
- Database permission and application-guard immutability layers.
- Hash canonicalization and chain rules.
- Stellar batching, Merkle-root, confirmation, and retry behavior.
- Privacy, retention, and compatibility treatment for existing events.

Approval must be recorded in the pull request or issue discussion. Any change to this document after approval reopens the review gate and must be approved again before #P3-2 starts.

## 14. Explicit non-goals for this issue

- No Prisma model or SQL migration is defined here.
- No event writer, projector, replay worker, or Stellar anchoring service is implemented here.
- No existing event-log row is reclassified automatically.
- No on-chain payload storage is proposed.
- `ADOPTION_ESCROW_CREATED`
- `ADOPTION_ESCROW_FUNDED`
- `ADOPTION_COMPLETED`

### Custody

- `CUSTODY_CREATED`
- `CUSTODY_STARTED`
- `CUSTODY_COMPLETED`
- `CUSTODY_CANCELLED`
- `CUSTODY_EXTENDED`

### Pet

- `PET_LISTED`
- `PET_UPDATED`
- `PET_ADOPTED`
- `PET_CUSTODY_STARTED`
- `PET_RETURNED`
- `PET_REMOVED`

### User

- `USER_REGISTERED`
- `USER_VERIFIED`
- `USER_TRUST_UPDATED`
- `USER_BADGE_AWARDED`
- `USER_DISPUTE_OPENED`

The `EVENT_AGGREGATE_MAP` constant provides the authoritative aggregate association for every canonical event type.

## Legacy Event Mapping

The legacy table stores an entity type and event type separately. Existing values are retained as-is and are not renamed in place.

| Legacy event type | Legacy entity type | EventLedger event type | Aggregate |
|---|---|---|---|
| `USER_REGISTERED` | `USER` | `USER_REGISTERED` | `USER` |
| `PET_REGISTERED` | `PET` | `PET_LISTED` | `PET` |
| `PET_LISTED` | `PET` | `PET_LISTED` | `PET` |
| `ADOPTION_REQUESTED` | `ADOPTION` | `ADOPTION_REQUESTED` | `ADOPTION` |
| `ADOPTION_APPROVED` | `ADOPTION` | `ADOPTION_APPROVED` | `ADOPTION` |
| `ADOPTION_REJECTED` | `ADOPTION` | `ADOPTION_REJECTED` | `ADOPTION` |
| `ADOPTION_COMPLETED` | `ADOPTION` | `ADOPTION_COMPLETED` | `ADOPTION` |
| `CUSTODY_CREATED` | `CUSTODY` | `CUSTODY_CREATED` | `CUSTODY` |
| `CUSTODY_STARTED` | `CUSTODY` | `CUSTODY_STARTED` | `CUSTODY` |
| `CUSTODY_COMPLETED` | `CUSTODY` | `CUSTODY_COMPLETED` | `CUSTODY` |
| `CUSTODY_CANCELLED` | `CUSTODY` | `CUSTODY_CANCELLED` | `CUSTODY` |
| `CUSTODY_EXTENDED` | `CUSTODY` | `CUSTODY_EXTENDED` | `CUSTODY` |
| `ESCROW_CREATED` | `ESCROW` | `ADOPTION_ESCROW_CREATED` | `ADOPTION` |
| `ESCROW_FUNDED` | `ESCROW` | `ADOPTION_ESCROW_FUNDED` | `ADOPTION` |

`PET_REGISTERED` is treated as the historical name for listing a pet. Legacy escrow events require the owning workflow to identify whether the escrow belongs to an adoption or another aggregate before being projected into the ledger. The canonical event types intentionally scope escrow events to the adoption aggregate.

Legacy values not represented by the canonical event set remain readable from the old table and are not fabricated as new ledger events.

## Migration Path

Migration is incremental and does not require a destructive database migration:

1. **Deploy the canonical type definitions.** The aggregate-scoped values and their aggregate mapping are added in `src/events/types/event.types.ts`.
2. **Keep legacy reads intact.** Existing services may continue reading the old `events`/`eventLog` table. Existing Prisma enum values and rows must not be renamed or removed.
3. **Write new events to `EventLedger`.** New aggregate workflows should emit one canonical event with the aggregate type and aggregate identifier. The event payload should preserve the business data needed to rebuild the aggregate or produce projections.
4. **Backfill only when required.** Historical legacy rows may be copied to `EventLedger` with the mapping above. Backfill jobs must be idempotent and retain the original event identifier or an equivalent deduplication key.
5. **Validate projections.** Compare rebuilt aggregate state and read-model projections against the existing application state before switching reads to ledger-backed projections.
6. **Switch reads gradually.** Move individual consumers to `EventLedger` after validation. Retain the old table as a compatibility source until all consumers and operational reports have migrated.
7. **Retire legacy storage only in a later migration.** Removing the old table or its enum values is explicitly outside this change and requires a separate compatibility and data-retention decision.

## Compatibility Rules

- Do not rename or delete legacy enum values.
- Do not assume that a legacy `ESCROW` event is adoption-scoped without resolving its owning workflow.
- Use the aggregate identifier, not the legacy entity label alone, when creating ledger records.
- A legacy row should be copied at most once during backfill.
- New code should use the canonical event types and the aggregate mapping rather than introducing additional unscoped event names.
