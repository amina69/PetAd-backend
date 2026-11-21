import type { AppConfig, RawEnvConfig } from './env.schema';
import { validateEnv } from './env.validation';

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
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
    trust: {
      scoring: {
        version: env.TRUST_ALGORITHM_VERSION,
        baseScore: env.TRUST_BASE_SCORE,
        halfLifeDays: env.TRUST_HALF_LIFE_DAYS,
        minimumVolume: env.TRUST_MINIMUM_VOLUME,
        diminishingRate: env.TRUST_DIMINISHING_RATE,
        weights: {
          AGREEMENT_COMPLETED: env.TRUST_WEIGHT_COMPLETION,
          POSITIVE_REVIEW: env.TRUST_WEIGHT_POSITIVE_REVIEW,
          NEUTRAL_REVIEW: env.TRUST_WEIGHT_NEUTRAL_REVIEW,
          NEGATIVE_REVIEW: env.TRUST_WEIGHT_NEGATIVE_REVIEW,
          DISPUTE_OPENED: env.TRUST_WEIGHT_DISPUTE_OPENED,
          DISPUTE_RESOLVED_IN_FAVOUR: env.TRUST_WEIGHT_DISPUTE_FAVOUR,
          DISPUTE_RESOLVED_AGAINST: env.TRUST_WEIGHT_DISPUTE_AGAINST,
          VIOLATION: env.TRUST_WEIGHT_VIOLATION,
          DOCUMENT_VERIFIED: env.TRUST_WEIGHT_DOCUMENT_VERIFIED,
        },
      },
    },
  };
};
