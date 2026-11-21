import type { AppConfig, RawEnvConfig } from './env.schema';
import { validateEnv } from './env.validation';

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseWebhookProviders(
  env: RawEnvConfig,
): AppConfig['webhooks']['providers'] {
  const providers: AppConfig['webhooks']['providers'] = {};

  for (const entry of env.WEBHOOK_PROVIDERS.split(',')) {
    const name = entry.trim().toLowerCase();
    if (!name) continue;
    if (!/^[a-z0-9_-]+$/.test(name)) {
      throw new Error(
        `Invalid webhook provider name in WEBHOOK_PROVIDERS: ${name}`,
      );
    }

    const prefix = `WEBHOOK_${name.toUpperCase().replace(/-/g, '_')}`;
    const secret = process.env[`${prefix}_SECRET`];
    if (!secret) {
      throw new Error(
        `Missing required secret for webhook provider "${name}" (${prefix}_SECRET)`,
      );
    }

    providers[name] = {
      secret,
      signatureHeader:
        process.env[`${prefix}_SIGNATURE_HEADER`] ??
        (name === 'stripe' ? 'stripe-signature' : 'x-webhook-signature'),
      eventIdHeader:
        process.env[`${prefix}_EVENT_ID_HEADER`] ?? 'x-webhook-event-id',
    };
  }

  return providers;
}

/**
 * Typed configuration factory consumed by `ConfigModule.forRoot({
 *   load: [configuration]
 * })`.
 *
 * It maps the flat, validated `RawEnvConfig` (produced by `validateEnv()`,
 * the single source of truth in `env.schema.ts`) into the nested `AppConfig`
 * shape used by `ConfigService` throughout the application.
 */
export const configuration = (): AppConfig => {
  const env: RawEnvConfig = validateEnv();

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwtSecret: env.JWT_SECRET,
    jwtExpiration: env.JWT_EXPIRATION,
    stellar: {
      enabled: env.STELLAR_ENABLED,
      network: env.STELLAR_NETWORK,
      secretKey: env.STELLAR_SECRET_KEY,
      publicKey: env.STELLAR_PUBLIC_KEY,
      horizonUrl: env.STELLAR_HORIZON_URL,
    },
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
    },
    upload: {
      maxFileSize: env.MAX_FILE_SIZE,
      dest: env.UPLOAD_DEST,
    },
    queue: {
      concurrency: env.QUEUE_CONCURRENCY,
      attempts: env.JOB_ATTEMPTS,
      backoffDelay: env.JOB_BACKOFF_DELAY,
    },
    cors: {
      enabled: env.CORS_ENABLED,
      credentials: env.CORS_CREDENTIALS,
      allowedOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    },
    bodyLimit: env.MAX_BODY_SIZE,
    trustProxy: env.TRUST_PROXY,
    logLevel: env.LOG_LEVEL,
    sentryDsn: env.SENTRY_DSN,
    webhooks: {
      providers: parseWebhookProviders(env),
      toleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS,
    },
    fees: {
      cacheTtlSeconds: env.FEE_SCHEDULE_CACHE_TTL_SECONDS,
    },
    reports: {
      syncLimitDays: env.REVENUE_REPORT_SYNC_LIMIT_DAYS,
    },
    trustAbuse: {
      minAccountAgeDays: env.TRUST_ABUSE_MIN_ACCOUNT_AGE_DAYS,
      reviewBurstWindowDays: env.TRUST_ABUSE_REVIEW_BURST_WINDOW_DAYS,
      reviewBurstThreshold: env.TRUST_ABUSE_REVIEW_BURST_THRESHOLD,
      agreementThreshold: env.TRUST_ABUSE_AGREEMENT_THRESHOLD,
      flaggedWeight: env.TRUST_ABUSE_FLAGGED_WEIGHT,
      signalSalt: env.TRUST_ABUSE_SIGNAL_SALT,
    },
  };
};
