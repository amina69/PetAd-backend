# Event Anchoring on Stellar

The event ledger is append-only inside PostgreSQL. Anchoring commits batches
of ledger events to Stellar so a third party can later prove that a given
event existed at a given point in time and has not been altered since.

The chain stores **no event payloads**. It stores a single 32-byte Merkle root
per batch, in the transaction memo hash.

## Flow

```
append event ──► open batch ──► seal (Merkle root)
                                   │
                                   ▼
                          submit to Stellar
                        (memo hash = root)
                                   │
                                   ▼
                     confirmation processor
                ┌──────────────────┴──────────────────┐
                │                                     │
      root matches Horizon                   root differs
                │                                     │
       batch CONFIRMED                        batch DISPUTED
       events get txHash/blockHeight          critical alert
       EVENTS_ANCHORED appended
                │
                ▼
        proof + public verification
        POST /api/v1/verify/proof
```

## Data model

| Table                 | Purpose                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `anchor_batches`      | One anchoring attempt: root, status, txHash, block height                           |
| `anchor_batch_leaves` | One row per event in a batch: event ID, hash, leaf index                            |
| `event_logs`          | Ledger events; `tx_hash`, `block_height`, `anchor_batch_id` are set on confirmation |

Batch statuses: `OPEN`, `SUBMITTED`, `CONFIRMED`, `DISPUTED`, `FAILED`.
A batch with a mismatching on-chain root is `DISPUTED`; a submission failure
is `FAILED`. A missing transaction is retried (`PENDING`).

## Proof format

Anchoring uses a binary Merkle tree over the event hashes.

### 1. Event hash

`eventHash = sha256(canonicalEventJson)`, hex encoded (32 bytes).

The canonical event JSON contains exactly these fields, with object keys
sorted recursively and no whitespace:

```json
{
  "actorId": "user-id-or-null",
  "createdAt": "2026-11-24T10:00:00.000Z",
  "entityId": "aggregate-id",
  "entityType": "PET",
  "eventType": "PET_REGISTERED",
  "id": "event-id",
  "payload": { "...": "event facts" }
}
```

`createdAt` is the stored timestamp in ISO-8601 UTC with milliseconds.
Two implementations that follow these rules produce the same hash. See
`hashLedgerEvent()` in `src/anchoring/merkle.ts` and the examples below.

### 2. Leaf and pair hashing

- Leaf hash = event hash (no additional hashing).
- Pair hash = `sha256(leftBytes || rightBytes)` where each operand is the
  32 raw bytes of the child hash.
- If a layer has an odd number of nodes, the last node is duplicated.
- The root is the only node of the top layer.

### 3. Inclusion proof

```json
{
  "eventHash": "64-char hex",
  "batchId": "cuid",
  "merkleRoot": "64-char hex",
  "txHash": "64-char hex",
  "blockHeight": 123456,
  "proof": [
    { "position": "right", "hash": "64-char hex" },
    { "position": "left", "hash": "64-char hex" }
  ]
}
```

`position` describes where the sibling is relative to the current node:

```
node = eventHash
for each step:
  if position == "left":  node = sha256(step.hash || node)
  if position == "right": node = sha256(node || step.hash)
valid = node == merkleRoot == on-chain memo hash
```

### 4. On-chain commitment

The Merkle root is stored in the Stellar transaction's memo hash:

- Horizon `GET /transactions/{txHash}` returns `memo_type: "hash"`.
- `memo` is base64 of the 32-byte root.
- `ledger` is the block height; `created_at` is the anchoring time.

## Public verification API

`POST /api/v1/verify/proof` is unauthenticated and rate limited (20 requests
per minute per client). It accepts only hashes and proof steps:

```http
POST /api/v1/verify/proof
Content-Type: application/json

{
  "eventHash": "ab12...",
  "proof": [
    { "position": "right", "hash": "cd34..." },
    { "position": "left",  "hash": "ef56..." }
  ],
  "merkleRoot": "0123...",
  "txHash": "4567..."
}
```

`merkleRoot` and `txHash` are optional; when omitted they are looked up by
event hash. The endpoint fetches the transaction from Horizon, recomputes the
root from the proof and compares it with the memo hash:

```json
{
  "valid": true,
  "anchoredAt": "2026-11-24T10:00:00.000Z",
  "txHash": "4567...",
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/4567..."
}
```

A tampered or unrelated proof returns `valid: false`. Event payloads are
never accepted by the endpoint and never returned. Results are cached for
60 seconds.

## Standalone verification

`scripts/verify-anchor.mjs` verifies a proof with Node.js 20+ and no project
dependencies. It needs only the transaction hash, event hash and proof JSON:

```bash
node scripts/verify-anchor.mjs \
  4567... \
  ab12... \
  ./proof.json \
  https://horizon-testnet.stellar.org
```

`proof.json` is either the `proof` array or an object containing it. The
script prints `{ valid, eventHash, computedRoot, onChainRoot, anchoredAt,
txHash, explorerUrl }` and exits non-zero when the proof is invalid. It reads
only public chain data, so it can be run by anyone.

To reproduce the event hash independently, build the canonical JSON from the
event row and run `sha256` as described above. Payload data is only needed by
the verifier to recompute the hash; it is never sent to PetAd.

## Threat model

Anchoring **proves**:

- The exact event bytes described by `eventHash` existed no later than the
  anchoring time (chain transaction timestamp/ledger).
- The event hash is part of the batch committed in that transaction.
- A ledger event has not been silently altered since anchoring: changing any
  hashed field changes the event hash and invalidates the proof.
- Confirmation only after the stored root matches the on-chain memo hash; a
  mismatch is surfaced as `DISPUTED` and a critical alert.

Anchoring **does not prove**:

- **Truthfulness.** An anchor proves that a record existed and is intact, not
  that its claims are true. A shelter could anchor a false adoption record;
  the chain only says the record existed at that time.
- **Completeness.** The operator decides which events enter a batch. Events
  that were never anchored, or batches never submitted, leave no on-chain
  evidence. Absence of a proof is not proof of absence.
- **Data privacy.** Only hashes are on chain. Anyone who can guess a whole
  event (including low-entropy payloads) could confirm that guess by hashing
  it. Do not anchor secrets; credentials and tokens are excluded from event
  payloads by policy.
- **Key custody.** The backend signing key can submit new roots. Compromise
  does not allow rewriting already-confirmed transactions, but it does allow
  anchoring arbitrary new roots. Keep `STELLAR_SECRET_KEY` in a secrets
  manager and rotate it if exposed.
- **Availability.** A third party needs Horizon access to fetch the memo. If
  Horizon is unavailable or pruned, verification fails even for valid proofs.

Operational note: the fake gateway used by tests and local development
commits roots to memory only. A proof produced against it is **not** publicly
verifiable; production and the nightly testnet suite must run with
`STELLAR_ENABLED=true` and a funded backend account.

## Configuration

| Variable              | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `STELLAR_ENABLED`     | Selects the Horizon gateway; `false` uses the fake gateway |
| `STELLAR_NETWORK`     | `testnet`, `mainnet` or `futurenet` (explorer URL/network) |
| `STELLAR_SECRET_KEY`  | Signs anchor transactions                                  |
| `STELLAR_PUBLIC_KEY`  | Backend account that submits the 1-stroop self-payment     |
| `STELLAR_HORIZON_URL` | Horizon endpoint used for submission and verification      |

## Testing

- Unit: `src/anchoring/*.spec.ts` (Merkle proofs, verification cache/leakage,
  confirmation and dispute handling, single-statement event stamping).
- End-to-end: `test/e2e/anchoring.e2e-spec.ts` runs append → batch → submit →
  confirm → proof → verify against the fake gateway, including a tampered
  proof and a root mismatch. The nightly suite (issue 70) runs the same flow
  on Stellar testnet.

```bash
npm test -- src/anchoring
npm run test:e2e -- test/e2e/anchoring.e2e-spec.ts
```
