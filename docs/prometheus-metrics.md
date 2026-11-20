# Prometheus metrics (BE-178)

The application exposes Prometheus text format at **GET /metrics** (outside the `/api/v1` prefix).

## Security

The endpoint **fails closed** until both `METRICS_USERNAME` and `METRICS_PASSWORD` are set (password minimum 16 characters). Without them, it returns HTTP 503; invalid or missing Basic credentials return HTTP 401. Do not add an unauthenticated metrics route or expose this endpoint through a public ingress. Configure the production firewall/reverse proxy so only the internal Prometheus server can connect. Use TLS between hosts to avoid transmitting Basic credentials in plaintext.

Example Prometheus scrape configuration:

```yaml
scrape_configs:
  - job_name: petad-backend
    metrics_path: /metrics
    scrape_interval: 30s
    static_configs:
      - targets: ['petad-backend:3000']
    basic_auth:
      username: prometheus
      password_file: /etc/prometheus/secrets/petad_metrics_password
```

## Metric families

- `petad_http_request_duration_seconds`: histogram labeled by HTTP method, **matched route template**, status.
- `petad_http_requests_total`: counter with the same bounded labels.
- `petad_db_connections`: PostgreSQL connections to the application database (database-wide, not the Prisma driver's private local pool).
- `petad_queue_jobs`: BullMQ counts for the fixed `notifications` and `data_export` queues, by waiting/active/delayed/completed/failed state.
- `petad_escrow_states`: Prisma escrow totals by the finite `EscrowStatus` enum.
- `petad_anchoring_lag_seconds`: age of the oldest ledger event with no `txHash`; zero when none exists. This is a proxy for pending anchoring and assumes events without a hash are candidates for anchoring. When a dedicated anchoring pipeline exists, replace with its canonical lag source.
- `petad_stellar_call_duration_seconds` and `petad_stellar_call_failures_total`: instrumentation hooks via `MetricsService.measureStellar(operation, asyncWork)`. The current `src/stellar` module contains no live Stellar SDK calls. These values reflect only operations wrapped by that API; do not interpret missing samples as verified successful calls.
- Node.js default process/runtime metrics are also included via `prom-client`.

The HTTP instrumentation never uses URL parameters, IDs, or query strings as label values. Unmatched requests are grouped as `unmatched`. Unknown Stellar operation names are mapped to `other`.

## Smoke checks

```sh
curl -i http://localhost:3000/metrics  # 401 with configured creds; 503 without
curl -u 'prometheus:YOUR_PASSWORD' http://localhost:3000/metrics
npm test -- --runInBand src/metrics/metrics.service.spec.ts
```
