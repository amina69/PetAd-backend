import { RealtimeTicketService } from './realtime-ticket.service';

function createService() {
  const config = {
    get: jest.fn((key: string) =>
      key === 'redisUrl' ? 'redis://localhost:6379' : undefined,
    ),
  };

  const service = new RealtimeTicketService(config as never);
  const store = new Map<string, string>();

  const fakeRedis = {
    status: 'ready',
    set: jest.fn((...args: unknown[]) => {
      const [key, value] = args as [string, string];
      if (store.has(key)) {
        return Promise.resolve(null);
      }
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    getdel: jest.fn((key: string) => {
      const value = store.get(key);
      store.delete(key);
      return Promise.resolve(value ?? null);
    }),
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
  };

  (service as unknown as { redis: typeof fakeRedis }).redis = fakeRedis;

  return { service, fakeRedis, store };
}

describe('RealtimeTicketService', () => {
  it('issues a 30 second ticket', async () => {
    const { service, fakeRedis } = createService();

    const { ticket, expiresAt } = await service.issue('u1');

    expect(ticket).toEqual(expect.any(String));
    expect(ticket.length).toBeGreaterThan(20);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(fakeRedis.set).toHaveBeenCalledWith(
      `realtime:ticket:${ticket}`,
      'u1',
      'PX',
      30_000,
      'NX',
    );
  });

  it('works exactly once', async () => {
    const { service } = createService();

    const { ticket } = await service.issue('u1');

    await expect(service.consume(ticket)).resolves.toBe('u1');
    await expect(service.consume(ticket)).resolves.toBeNull();
  });

  it('rejects an unknown ticket', async () => {
    const { service } = createService();

    await expect(service.consume('unknown-ticket')).resolves.toBeNull();
  });

  it('issues a distinct ticket per connection', async () => {
    const { service } = createService();

    const first = await service.issue('u1');
    const second = await service.issue('u1');

    expect(first.ticket).not.toBe(second.ticket);
  });
});
