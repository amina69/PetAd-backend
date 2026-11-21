# Trust scoring (BE-142)

`calculateTrustScore` in `src/trust/scoring/calculate-trust-score.ts` is the single,
versioned scoring implementation. It is a pure function of:

- the immutable trust events recorded for a subject,
- the scoring configuration (weights, half-life, minimum volume, diminishing rate),
- an explicit `asOf` timestamp.

No clock, random value, database state, or request data is read inside the function.

## Model

| Component           | Behaviour                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline            | Every profile starts at 50.                                                                                                                                                                       |
| Weights             | Each event kind has a configurable weight. Violations and disputes against a user carry larger negative weights than positive events carry positive weight.                                       |
| Recency decay       | `weight * 0.5^(ageDays / halfLifeDays)`. Events in the future are treated as current.                                                                                                             |
| Diminishing returns | Repeated positive events are multiplied by `1 / (1 + priorPositives * diminishingRate)`.                                                                                                          |
| Minimum volume      | With `n` events the net event contribution is scaled by `n / (n + minimumVolume)`, shrinking low-volume scores toward the baseline.                                                               |
| Bounds              | The final score is always clamped to `[0, 100]`.                                                                                                                                                  |
| Explainability      | The result contains the algorithm version and a sorted factor breakdown with machine keys, human labels, event counts, and numeric contributions. Contributions always sum to the returned score. |
| Versioning          | `algorithmVersion` is stored with every `TrustScore` snapshot and with every public proof bundle.                                                                                                 |

## Configuration

Weights and tuning values come from `trust.scoring` in the application
configuration, which is populated by the optional `TRUST_*` environment variables
documented in `.env.example`. Defaults are defined in
`src/trust/scoring/trust-scoring.config.ts`.

Changing a weight requires a new `TRUST_ALGORITHM_VERSION` and an admin backfill:

```
POST /api/v1/admin/trust/backfill   { "dryRun": true }
POST /api/v1/admin/trust/backfill   { "dryRun": false, "confirm": true }
```

## Replay and idempotency

`TrustProjectionService` consumes adoption, custody, dispute, review, and document
events. It records the source event id in `trust_event_sources` before writing
derived trust events. The primary key on that table makes duplicate delivery a
no-op, and reordering source events cannot change the result because both the
scorer and projector use deterministic ordering.

Nightly verification recomputes every cached score from the derived trust events
and repairs drift. Admin replay uses the same path with `force: true`.

## Privacy

`GET /api/v1/users/:id/trust` returns the band, badges, aggregate counters, and a
proof bundle to every caller. Only the owner receives the numeric score, raw
factor breakdown, and calculation timestamp, so non-owners never learn details of
private disputes. `POST /api/v1/verify/proof` verifies the bundle from event ids
and hashes only; payloads are never accepted or returned.
