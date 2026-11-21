import * as Joi from 'joi';

/**
 * Flat, env-var-keyed shape produced by validating `process.env`.
 * Keys are the actual environment variable names.
 */
export interface RawEnvConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  API_PREFIX: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRATION: string;
  STELLAR_ENABLED: boolean;
  STELLAR_NETWORK: 'testnet' | 'mainnet' | 'futurenet';
  STELLAR_SECRET_KEY?: string;
  STELLAR_PUBLIC_KEY?: string;
  STELLAR_HORIZON_URL?: string;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM: string;
  MAX_FILE_SIZE: number;
  UPLOAD_DEST: string;
  QUEUE_CONCURRENCY: number;
  JOB_ATTEMPTS: number;
  JOB_BACKOFF_DELAY: number;
  MAX_BODY_SIZE: string;
  CORS_ENABLED: boolean;
  CORS_CREDENTIALS: boolean;
  CORS_ORIGINS: string;
  TRUST_PROXY: boolean;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  SENTRY_DSN?: string;
  PAYMENTS_FEE_RATE_BPS: number;
  PAYMENTS_RECEIPT_DIR: string;
  PAYMENTS_RECEIPT_URL_TTL_SECONDS: number;
  PAYMENTS_RECEIPT_SIGNING_SECRET?: string;
}

/**
 * Fully-typed, nested application configuration consumed through
 * `ConfigService` (e.g. `configService.get<number>('port')`).
 */
export interface AppConfig {
  nodeEnv: RawEnvConfig['NODE_ENV'];
  port: RawEnvConfig['PORT'];
  apiPrefix: RawEnvConfig['API_PREFIX'];
  databaseUrl: RawEnvConfig['DATABASE_URL'];
  redisUrl: RawEnvConfig['REDIS_URL'];
  jwtSecret: RawEnvConfig['JWT_SECRET'];
  jwtExpiration: RawEnvConfig['JWT_EXPIRATION'];
  stellar: {
    enabled: RawEnvConfig['STELLAR_ENABLED'];
    network: RawEnvConfig['STELLAR_NETWORK'];
    secretKey?: RawEnvConfig['STELLAR_SECRET_KEY'];
    publicKey?: RawEnvConfig['STELLAR_PUBLIC_KEY'];
    horizonUrl?: RawEnvConfig['STELLAR_HORIZON_URL'];
  };
  smtp: {
    host?: RawEnvConfig['SMTP_HOST'];
    port: RawEnvConfig['SMTP_PORT'];
    secure: RawEnvConfig['SMTP_SECURE'];
    user?: RawEnvConfig['SMTP_USER'];
    pass?: RawEnvConfig['SMTP_PASS'];
    from: RawEnvConfig['SMTP_FROM'];
  };
  upload: {
    maxFileSize: RawEnvConfig['MAX_FILE_SIZE'];
    dest: RawEnvConfig['UPLOAD_DEST'];
  };
  queue: {
    concurrency: RawEnvConfig['QUEUE_CONCURRENCY'];
    attempts: RawEnvConfig['JOB_ATTEMPTS'];
    backoffDelay: RawEnvConfig['JOB_BACKOFF_DELAY'];
  };
  cors: {
    enabled: RawEnvConfig['CORS_ENABLED'];
    credentials: RawEnvConfig['CORS_CREDENTIALS'];
    allowedOrigins: string[];
  };
  bodyLimit: RawEnvConfig['MAX_BODY_SIZE'];
  trustProxy: RawEnvConfig['TRUST_PROXY'];
  logLevel: RawEnvConfig['LOG_LEVEL'];
  sentryDsn?: RawEnvConfig['SENTRY_DSN'];
  payments: {
    feeRateBps: RawEnvConfig['PAYMENTS_FEE_RATE_BPS'];
    receiptDir: RawEnvConfig['PAYMENTS_RECEIPT_DIR'];
    receiptUrlTtlSeconds: RawEnvConfig['PAYMENTS_RECEIPT_URL_TTL_SECONDS'];
    receiptSigningSecret?: RawEnvConfig['PAYMENTS_RECEIPT_SIGNING_SECRET'];
  };
}

/**
 * Boot-time environment validation schema.
 *
 * Rules:
 * - `abortEarly: false` so every invalid variable is reported at once.
 * - `allowUnknown: true` so platform-injected vars (e.g.
 *   CHOKIDAR_USEPOLLING from Docker Compose) do not fail validation.
 * - Required: DATABASE_URL, REDIS_URL, JWT_SECRET (>= 32 characters).
 * - Enums: NODE_ENV, STELLAR_NETWORK, LOG_LEVEL.
 * - Numeric defaults with bounds: PORT, SMTP_PORT, queue values.
 * - Conditional: when STELLAR_ENABLED=true, the Stellar variables become
 *   required.
 * - Secret values are validated for presence/format but are never included
 *   in error messages - only variable names are reported.
 */
export const envSchema = Joi.object<RawEnvConfig>({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  API_PREFIX: Joi.string().default('api/v1'),

  DATABASE_URL: Joi.string().uri().required().messages({
    'string.uri': '"DATABASE_URL" must be a valid PostgreSQL connection URI',
  }),
  REDIS_URL: Joi.string().uri().required().messages({
    'string.uri': '"REDIS_URL" must be a valid Redis connection URI',
  }),

  JWT_SECRET: Joi.string().min(32).required().messages({
    'string.min': '"JWT_SECRET" must be at least 32 characters long',
  }),
  JWT_EXPIRATION: Joi.string().default('7d'),

  STELLAR_ENABLED: Joi.boolean().default(false),
  STELLAR_NETWORK: Joi.string()
    .valid('testnet', 'mainnet', 'futurenet')
    .when('STELLAR_ENABLED', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  STELLAR_SECRET_KEY: Joi.string().when('STELLAR_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  STELLAR_PUBLIC_KEY: Joi.string().when('STELLAR_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  STELLAR_HORIZON_URL: Joi.string().uri().when('STELLAR_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().integer().min(1).max(65535).default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().default('PetAd <no-reply@petad.local>'),

  MAX_FILE_SIZE: Joi.number().integer().min(1).default(10485760),
  UPLOAD_DEST: Joi.string().default('./uploads'),

  QUEUE_CONCURRENCY: Joi.number().integer().min(1).default(5),
  JOB_ATTEMPTS: Joi.number().integer().min(1).default(3),
  JOB_BACKOFF_DELAY: Joi.number().integer().min(0).default(5000),

  MAX_BODY_SIZE: Joi.string().default('100kb'),

  CORS_ENABLED: Joi.boolean().default(true),
  CORS_CREDENTIALS: Joi.boolean().default(true),
  CORS_ORIGINS: Joi.string().default(''),

  TRUST_PROXY: Joi.boolean().default(false),

  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),

  SENTRY_DSN: Joi.string().uri().optional(),

  PAYMENTS_FEE_RATE_BPS: Joi.number().integer().min(0).max(10000).default(250),
  PAYMENTS_RECEIPT_DIR: Joi.string().default('./storage/receipts'),
  PAYMENTS_RECEIPT_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(30)
    .max(86400)
    .default(300),
  PAYMENTS_RECEIPT_SIGNING_SECRET: Joi.string().min(32).optional(),
}).options({ abortEarly: false, allowUnknown: true });
