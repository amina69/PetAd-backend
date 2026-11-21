# Analytics read models

Daily aggregates are stored in `daily_adoptions`, `daily_custody`,
`daily_disputes` and `daily_users`. They are rebuilt from the `event_logs`
ledger. Dashboard queries read these read models (and the ledger for stage
events); they never read transactional tables such as `adoptions`, `custodies`,
`pets`, `users` or `escrows`. Those tables are used only while a projection
runs, to enrich events with dimensions.

## Refresh

- Every successful append through `EventsService.logEvent` or
  `EventLedgerService.appendEvent` refreshes the affected UTC day.
- A five-minute catch-up refresh covers missed or backfilled events.
- `POST /api/v1/analytics/projections/rebuild` rebuilds every day from the
  ledger. `GET /api/v1/analytics/projections` exposes `lastProcessedAt`,
  `lastRunAt`, `rowCount`, `refreshLagSeconds` and the refresh interval.
- Refresh lag is therefore normally under five minutes; it can be larger when
  the projection is disabled or the ledger is backfilled outside the services.

## Adoption success definition

An adoption is successful when `ADOPTION_COMPLETED` was recorded and neither
`PET_RETURNED`, `CUSTODY_RETURNED` nor `ADOPTION_CANCELLED` was recorded for
that pet within 30 days after completion.

## Funnel

The funnel counts distinct adoption aggregates that reached each stage:

`REQUESTED → APPROVED → FUNDED → COMPLETED`

Counts are clamped with SQL `LEAST()` so every stage is monotonically
non-increasing. Drop-offs are `REJECTED`, `CANCELLED` and `EXPIRED` (a request
older than the configured `expiredAfterDays` with no completion). Median time
between stages uses SQL `percentile_cont(0.5)`; it is never computed in memory.
