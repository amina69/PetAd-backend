import { init, Severity } from '@sentry/node';

/**
 * Creates and configures the Sentry client instance.
 * This is a pure function so it can be called during module registration.
 * Sentry is only initialized when SENTRY_DSN is provided in the environment.
 */
export interface SentryOptions {
  dsn?: string;
  environment: string;
  release?: string;
}

export function createSentryClient(options: SentryOptions) {
  const { dsn, environment, release } = options;

  // Initialize Sentry client
  const sentryClient = init({
    dsn,
    environment,
    release,
    // Capture only errors and above by default
    // 4xx client errors are ignored via beforeSend
    beforeSend: (_event: any, _hint: any) => {
      // Remove request body content
      if (_event.request) {
        _event.request.headers = undefined;
        // Strip potentially sensitive data from request
        if (_event.request.body) {
          _event.request.body = '[Filtered]';
        }
        if (_event.request.headers) {
          // Remove authorization and other sensitive headers
          const filteredHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(_event.request.headers)) {
            const lowerKey = key.toLowerCase();
            if (
              lowerKey === 'authorization' ||
              lowerKey.startsWith('auth') ||
              lowerKey === 'cookie'
            ) {
              filteredHeaders[key] = '[Filtered]';
            } else {
              filteredHeaders[key] = value;
            }
          }
          _event.request.headers = filteredHeaders;
        }
      }

      // Remove user email and other PII from contexts
      if (_event.contexts && _event.contexts.user) {
        const userContext = _event.contexts.user as Record<string, unknown>;
        // Keep only user ID, strip email and other PII
        if (userContext.userId) {
          ;(userContext as any).userId = String(userContext.userId);
        } else {
          delete userContext.userId;
        }
        if (userContext.email) {
          delete userContext.email;
        }
        if (userContext.username) {
          delete userContext.username;
        }
        if (userContext.name) {
          delete userContext.name;
        }
      }

      // Ignore expected 4xx client errors
      if (_event.exceptions && _event.exceptions.length > 0) {
        const lastException = _event.exceptions[_event.exceptions.length - 1];
        if (lastException) {
          const { type, value } = lastException;
          // If it's an HttpException with 4xx status, skip sending
          if (type === 'HttpException') {
            const errMsg = String(value || '');
            // Check for common 4xx error patterns
            if (
              /^400$|^401$|^403$|^404$|^409$/.test(
                errMsg.split(':')[0]
              ) ||
              /Unauthorized|Forbidden|Not found|Bad Request/.test(errMsg)
            ) {
              return null; // Ignore this event
            }
          }
        }
      }

      return _event;
    },
    debug: false,
    attachStacktrace: true,
  });

  return sentryClient;
}