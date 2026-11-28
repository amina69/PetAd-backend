# Chain Reorg & Ledger Close Edge Cases in Blockchain Anchoring

## Overview
This document details the handling of edge cases related to Stellar ledger closes, consensus delays, and chain reorganizations during event anchoring.

## 1. Ledger Close Delays & Timeouts
- Stellar ledgers close approximately every 5 seconds. If transaction submission times out or returns a network timeout error, the transaction status is treated as transient.
- The system performs exponential backoff retries (`2^attempt * 1000ms`) up to 5 times before classifying the failure as terminal and raising an admin alert.

## 2. Sequence Number Conflicts (`tx_bad_seq`)
- When multiple anchoring transactions are dispatched concurrently or ledger state shifts, a `tx_bad_seq` error can occur.
- `tx_bad_seq` is explicitly recognized as a retryable error. The batch fetches the latest account sequence number from Horizon and resubmits.

## 3. Chain Reorganizations (Reorgs)
- In the event of a Stellar network partition or validator set shift resulting in a short-lived fork/reorg:
  - Anchored hashes stored in event ledgers are verified against the canonical ledger history once consensus stabilizes (minimum 3 ledger confirmations).
  - If a previously confirmed transaction hash is orphaned due to a reorg, the anchoring service flags the batch and triggers automatic re-anchoring with a new transaction sequence referencing the orphaned batch lineage.
