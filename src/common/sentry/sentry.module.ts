import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RawEnvConfig, envSchema } from '../../config/env.schema';
import { createSentryClient, SentryOptions } from './sentry.module.utils';

/**
 * Sentry module for NestJS application.
 * Sentry is only initialized when SENTRY_DSN is configured in the environment.
 */
@Module({})
export class SentryModule {
  static forRoot(): DynamicModule {
    return {
      module: SentryModule,
      exports: [], // No providers to export at module level; client is available globally
      global: true,
    };
  }

  static forFeature(): DynamicModule {
    return {
      module: SentryModule,
      exports: [],
      global: true,
    };
  }

  static async registerAsync(): Promise<DynamicModule> {
    return {
      module: SentryModule,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const dsn = configService.get<string>('SENTRY_DSN');

        // If no DSN is configured, return no-op providers
        if (!dsn) {
          return {
            // Provide a no-op client that does nothing
            provide: 'SENTRY_CLIENT',
            useValue: {
              captureException: async () => {},
              captureMessage: async () => {},
              withScope: () => {},
              configureScope: () => {},
              addBreadcrumb: () => {},
              flush: async () => ({ success: true }),
              getClient: () => ({} as any),
            },
            global: true,
          };
        }

        // Validate DSN format using Joi
        const { error } = envSchema.validate(
          { SENTRY_DSN: dsn },
          { abortEarly: false, allowUnknown: true }
        );

        if (error) {
          throw new Error(`Invalid SENTRY_DSN: ${error.message}`);
        }

        // Get configuration values
        const environment = configService.get<string>('NODE_ENV', 'development');
        const release = configService.get<string>('SENTRY_RELEASE');

        // If no explicit release, derive from package.json version
        let finalRelease = release;
        if (!finalRelease) {
          try {
            const pkg = await import('../../package.json');
            finalRelease = pkg.version || undefined;
          } catch {
            // If we can't read package.json, proceed without release
          }
        }

        const options: SentryOptions = {
          dsn,
          environment,
          release: finalRelease,
        };

        const client = createSentryClient(options);

        return {
          provide: 'SENTRY_CLIENT',
          useValue: client,
          global: true,
        };
      },
      inject: [ConfigService],
    };
  }
}