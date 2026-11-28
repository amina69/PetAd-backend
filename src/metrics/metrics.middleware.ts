import type { Request, Response, NextFunction } from 'express';
import type { MetricsService } from './metrics.service';

/**
 * Route labels are resolved after Express/Nest completes routing.
 * Never fall back to originalUrl, path parameters or query strings.
 */
export function httpMetricsMiddleware(metrics: MetricsService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.path === '/metrics') return next();
    const started = process.hrtime.bigint();
    response.once('finish', () => {
      const matched = request.route as { path?: string | string[] } | undefined;
      const template = matched?.path;
      // Nest registers controller routes with their complete API prefix.
      const path = typeof template === 'string' ? template : 'unmatched';
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(request.method)
        ? request.method
        : 'OTHER';
      const labels = {
        method,
        route: path || '/',
        status: String(response.statusCode),
      };
      metrics.httpRequests.inc(labels);
      metrics.httpDuration.observe(
        labels,
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    });
    next();
  };
}
