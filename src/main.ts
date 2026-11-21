import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppLogger } from './common/logger/logger.service';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
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
  // `rawBody` is required for HMAC verification of inbound webhooks. Nest
  // attaches the unmodified bytes before JSON parsing so signatures can be
  // checked against exactly what the provider signed.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const request = req as Request & { cookies: Record<string, string> };
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const cookies: Record<string, string> = {};
      cookieHeader.split(';').forEach((cookie: string) => {
        const parts = cookie.split('=');
        if (parts.length === 2) {
          cookies[parts[0].trim()] = decodeURIComponent(parts[1].trim());
        }
      });
      request.cookies = cookies;
    } else {
      request.cookies = {};
    }
    next();
  });
  // TODO(#215): Add server-side TOTP enrollment, challenge, and recovery flows.
  // TODO(#204): Coordinate graceful shutdown of Prisma, Redis, and job workers.

  const configService = app.get(ConfigService);

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
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as Record<string, unknown>)['trust proxy'] = 1;
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
