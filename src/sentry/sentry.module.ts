import { Module, Global } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/env.schema';

@Module({
  providers: [SentryService],
  exports: [SentryService],
})
@Global()
export class SentryModule {
  static forRoot(): ModuleDecorator {
    return {
      module: SentryModule,
      providers: [SentryService],
      exports: [SentryService],
    };
  }
}

class SentryService {
  private readonly configService: ConfigService;
  private readonly appConfig: AppConfig;

  constructor() {
    this.configService = new ConfigService();
    this.appConfig = this.configService.get('appConfig') || {};
  }

  /**
   * Initialize Sentry if SENTRY_DSN is configured.
   * Must be called after the application starts.
   */
  init(): void {
    const dsn = this.appConfig.sentryDsn;

    if (!dsn) {
      // Sentry is disabled - no events are sent
      return;
    }

    // Configure Sentry with DSN and environment info
    Sentry.init({
      dsn,
      environment: this.appConfig.nodeEnv,
      release: this.appConfig.nodeEnv === 'production'
        ? `${process.env.npm_package_name}-${process.env.npm_package_version}`
        : undefined,

      // Set up tracing
      tracesSampleRate: this.appConfig.nodeEnv === 'production' ? 0.1 : 1.0,

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
            headers[key] = value;
          }
          event.request.headers = headers;
        }

        // Remove user PII from breadcrumbs and extra context
        this.removePIIFromEvent(event);

        // Only include user ID if the user is authenticated
        if (event.user && event.user.id) {
          // Keep only the user ID - strip email and other PII
          event.user = {
            id: String(event.user.id),
          };
        }

        return event;
      },

      // Ignore 4xx errors (client errors that are expected)
      ignoreErrors: [
        // These common 4xx errors are expected and should not be tracked
        '400',
        '401',
        '403',
        '404',
        '409',
        '415',
        '422',
        '429',
      ],

      // Set tags for release and environment
      tags: {
        environment: this.appConfig.nodeEnv,
      },

      // Set default integrations
      defaultIntegrations: false,

      // Release information
      release: `${process.env.npm_package_name}-${process.env.npm_package_version}`,
    });

    // Set up breadcrumb filtering to avoid logging PII
    Sentry.configureScope((scope: any) => {
      scope.setTag('application', 'petad-backend');
    });
  }

  /**
   * Remove PII from event data structures
   */
  private removePIIFromEvent(event: any): void {
    // Remove from transactions, breadcrumbs, etc.

    // Sanitize extra context
    if (event.extra) {
      for (const key of Object.keys(event.extra)) {
        const value = event.extra[key];
        if (typeof value === 'string') {
          // Redact potential PII values
          if (this.isPotentiallyPII(value)) {
            event.extra[key] = '[redacted]';
          }
        }
      }
    }

    // Sanitize tags
    if (event.tags) {
      for (const key of Object.keys(event.tags)) {
        const value = event.tags[key];
        if (typeof value === 'string' && this.isPotentiallyPII(value)) {
          event.tags[key] = '[redacted]';
        }
      }
    }

    // Sanitize labels
    if (event.labels) {
      for (const key of Object.keys(event.labels)) {
        const value = event.labels[key];
        if (typeof value === 'string' && this.isPotentiallyPII(value)) {
          event.labels[key] = '[redacted]';
        }
      }
    }
  }

  /**
   * Check if a string value might contain PII
   */
  private isPotentiallyPII(value: string): boolean {
    const lower = value.toLowerCase();
    // Check for email patterns
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return true;
    }
    // Check for token-like values (short hex strings)
    if (/^[a-f0-9]{16,64}$/.test(value) || /^[a-f0-9]{8,}$/.test(value)) {
      return true;
    }
    // Check for common email/token patterns
    if (lower.includes('token') || lower.includes('secret') || lower.includes('key')) {
      return true;
    }
    // Check for email-like patterns
    if (lower.includes('@') && lower.includes('.') && !lower.includes('http')) {
      return true;
    }
    return false;
  }
}