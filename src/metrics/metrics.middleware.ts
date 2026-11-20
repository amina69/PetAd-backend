import type { Request, Response, NextFunction } from 'express';
import type { MetricsService } from './metrics.service';

/**
 * Metrics are recorded after Express has matched a route, so concrete URL
 * segments and query strings never enter the registry.
 */
export function httpMetricsMiddleware(metrics: MetricsService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.path === '/metrics') return next();
    const start = process.hrtime.bigint();
    response.once('finish', () => {
      const route = response.req.route as { path?: string | string[] } | undefined;
      const baseUrl = request.baseUrl || '';
      const template = route?.path;
      // Unmatched paths are aggregated, never labelled by the requested URL.
      const path = typeof template === 'string' ? `${baseUrl}${template}` : 'unmatched';
      const status = String(response.statusCode);
      const labels = { method: request.method, route: path || '/', status };
      metrics.httpRequests.inc(labels);
      metrics.httpDuration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
    });
    next();
  };
}
