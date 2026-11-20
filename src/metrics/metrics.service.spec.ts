import { MetricsService } from './metrics.service';
import { httpMetricsMiddleware } from './metrics.middleware';
import { metricsBasicAuth } from './metrics.auth';

describe('Prometheus metrics', () => {
  it('uses a route template rather than a concrete URL or query string', async () => {
    const metrics = new MetricsService();
    const handler = httpMetricsMiddleware(metrics);
    const listeners: Record<string, () => void> = {};
    const req = { path: '/api/v1/pets/pet-123', baseUrl: '/api/v1', method: 'GET' } as any;
    const res = {
      req: { route: { path: '/pets/:id' } },
      statusCode: 200,
      once: (event: string, cb: () => void) => { listeners[event] = cb; },
    } as any;
    handler(req, res, jest.fn());
    listeners.finish();
    const text = await metrics.registry.metrics();
    expect(text).toContain('route="/api/v1/pets/:id"');
    expect(text).not.toContain('pet-123');
  });

  it('groups unknown routes without recording raw paths', async () => {
    const metrics = new MetricsService();
    const listeners: Record<string, () => void> = {};
    httpMetricsMiddleware(metrics)(
      { path: '/private/user-123', method: 'GET', baseUrl: '' } as any,
      { req: {}, statusCode: 404, once: (event: string, cb: () => void) => { listeners[event] = cb; } } as any,
      jest.fn(),
    );
    listeners.finish();
    expect(await metrics.registry.metrics()).toContain('route="unmatched"');
    expect(await metrics.registry.metrics()).not.toContain('user-123');
  });

  it('denies missing and incorrect credentials', () => {
    const auth = metricsBasicAuth('prometheus', 'secret');
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), send: jest.fn(), setHeader: jest.fn() } as any;
    auth({ get: () => undefined } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    auth({ get: () => 'Basic ' + Buffer.from('prometheus:wrong').toString('base64') } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    auth({ get: () => 'Basic ' + Buffer.from('prometheus:secret').toString('base64') } as any, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('fails closed without configured credentials', () => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), send: jest.fn() } as any;
    metricsBasicAuth(undefined, undefined)({ get: () => undefined } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('counts Stellar failures using bounded operation labels', async () => {
    const metrics = new MetricsService();
    await expect(metrics.measureStellar('customer-123', async () => { throw Error('failure'); })).rejects.toThrow();
    const content = await metrics.registry.metrics();
    expect(content).toContain('petad_stellar_call_failures_total{operation="other"} 1');
    expect(content).not.toContain('customer-123');
  });
});
