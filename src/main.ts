import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppLogger } from './common/logger/logger.service';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import express from 'express';
import { config as dotenvConfig } from 'dotenv';
import { ErrorResponseDto } from './common/dto/error-response.dto';
import { ErrorDetailDto } from './common/dto/error-response.dto';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validateEnv } from './config/env.validation';

// Load .env, then fail fast if the environment is invalid. Secret values
// are validated but never surfaced in error messages (see env.validation).
dotenvConfig();
validateEnv();

// API versioning decision: literal prefixing via setGlobalPrefix('api/v1').
// See docs/API_VERSIONING.md for the rationale.
const API_PREFIX = 'api/v1';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use((req: any, res: any, next: () => void) => {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const cookies: Record<string, string> = {};
      cookieHeader.split(';').forEach((cookie: string) => {
        const parts = cookie.split('=');
        if (parts.length === 2) {
          cookies[parts[0].trim()] = decodeURIComponent(parts[1].trim());
        }
      });
      req.cookies = cookies;
    } else {
      req.cookies = {};
    }
    next();
  });
  // TODO(#215): Add server-side TOTP enrollment, challenge, and recovery flows.
  // TODO(#204): Coordinate graceful shutdown of Prisma, Redis, and job workers.

  const configService = app.get(ConfigService);

// Initialize Sentry if SENTRY_DSN is configured, after app bootstrap.
// Sentry is disabled when SENTRY_DSN is absent (no events are sent).
const sentryDsn = configService.get<string>('sentryDsn');
if (sentryDsn) {
  // @ts-expect-error - Sentry Node init may have type differences
  Sentry.init({
    dsn: sentryDsn,
    environment: configService.get<string>('nodeEnv', 'development'),
    release: `${process.env.npm_package_name}-${process.env.npm_package_version}`,

    // beforeSend hook to remove PII and sensitive data
    beforeSend: (event: any) => {
      // Remove request bodies
      if (event.request && event.request.body) {
        event.request.body = '[redacted]';
      }

      // Remove cookies and authorization headers
      if (event.request && event.request.headers) {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(event.request.headers)) {
          const lowerKey = key.toLowerCase();
          if (
            lowerKey === 'authorization' ||
            lowerKey === 'cookie' ||
            lowerKey === 'x-request-id' ||
            lowerKey === 'x-email' ||
            lowerKey === 'x-user-email'
          ) {
            continue;
          }
          headers[key] = value instanceof String ? value.toString() : String(value);
        }
        event.request.headers = headers;
      }

      // Remove user PII from breadcrumbs and extra context
      // We can't access SentryService here, so do basic PII removal
      if (event.request && event.request.query) {
        event.request.query = {};
      }
      if (event.user && event.user.id) {
        event.user = {
          id: String(event.user.id),
        };
      }

      return event;
    },

    // Ignore 4xx errors (client errors that are expected)
    ignoreErrors: [
      '400',
      '401',
      '403',
      '404',
      '409',
      '415',
      '422',
      '429',
    ],

    // Set default integrations
    defaultIntegrations: false,
  });
}

  // All configuration is read through ConfigService (typed via configuration.ts).
  const port = configService.get<number>('port', 3000);
  const nodeEnv = configService.get<string>('nodeEnv', 'development');
  const corsConfig =
    configService.get<{
      enabled?: boolean;
      credentials?: boolean;
      allowedOrigins?: string[];
    }>('cors') || {};
  const bodyLimit = configService.get<string>('bodyLimit', '100kb');
  const trustProxy = configService.get<boolean>('trustProxy', false);

  // 1. Request ID - first middleware so every downstream layer sees it.
  app.use(new RequestIdMiddleware());

  // 2. Helmet security headers (applied globally).
  app.use(helmet());

  // Swagger-specific CSP relaxation: only applied to the /api Swagger mount.
  app.use(
    '/api',
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    }),
  );

  // 3. CORS allowlisting. Wildcard origins are rejected when credentials are enabled.
  if (corsConfig.enabled) {
    const allowedOrigins = corsConfig.allowedOrigins || [];
    if (corsConfig.credentials && allowedOrigins.includes('*')) {
      throw new Error(
        'CORS credentials are enabled but CORS_ORIGINS contains "*". ' +
          'List explicit allowed origins in CORS_ORIGINS, or disable credentials.',
      );
    }
    app.enableCors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: corsConfig.credentials ?? true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    });
  }

  // 4. Request body size limits.
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ limit: bodyLimit, extended: true }));

  // 5. Environment-driven proxy trust.
  if (trustProxy) {
    app.use((req, res, next) => {
      req['trust proxy'] = 1;
      next();
    });
  }

  // 6. Global validation pipe.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 7. Global exception filter (standardized error responses).
  app.useGlobalFilters(app.get(HttpExceptionFilter));

  // 8. Application logger.
  app.useLogger(new AppLogger());

  // 9. Global API prefix. `/health` is excluded so it stays at root level.
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });

  // 10. Swagger at root-level /api, intentionally not under the API prefix.
  const documentConfig = new DocumentBuilder()
    .setTitle('Pet Adoption API')
    .setDescription('API documentation for the Pet Adoption platform')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig, {
    extraModels: [ErrorResponseDto, ErrorDetailDto],
  });

  SwaggerModule.setup('api', app, document, { useGlobalPrefix: false });

  await app.listen(port, '0.0.0.0');

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Environment: ${nodeEnv}`);
  console.log(`API base URL: http://localhost:${port}/${API_PREFIX}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`Swagger UI: http://localhost:${port}/api`);
}

void bootstrap();
