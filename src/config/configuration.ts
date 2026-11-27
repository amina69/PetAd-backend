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
    metrics: { username: env.METRICS_USERNAME, password: env.METRICS_PASSWORD },
  };
};
