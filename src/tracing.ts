/**
 * Tracing integration notes for the PetAd API, outbox, and queue workers.
 *
 * Keep OpenTelemetry opt-in: never initialize an SDK or exporter when
 * OTEL_EXPORTER_OTLP_ENDPOINT is unset. A configured collector alone should
 * not result in authorization headers, job payloads, or user identifiers
 * being added to span attributes.
 *
 * Future instrumentation should initialize before NestJS, Prisma, and
 * BullMQ are imported, propagate W3C traceparent/tracestate through the
 * outbox and job payloads, and restore context when a worker consumes a job.
 * Verify request -> outbox -> worker -> Stellar spans under one trace ID
 * before enabling this in production.
 *
 * This file is intentionally documentation-only; the tracing SDK and
 * auto-instrumentation are not wired up here.
 */
export const isTracingConfigured = (
  endpoint: string | undefined = process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
): boolean => Boolean(endpoint?.trim());
