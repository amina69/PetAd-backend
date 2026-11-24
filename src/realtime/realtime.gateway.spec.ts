import { RealtimeGateway, UNAUTHENTICATED_CLOSE_MS } from './realtime.gateway';

function createGateway(authenticate: jest.Mock) {
  const config = { get: jest.fn(() => undefined) };
  const gateway = new RealtimeGateway(
    { authenticate } as never,
    config as never,
  );
  return gateway;
}

function createSocket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'socket-1',
    connected: true,
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    on: jest.fn(),
    onAny: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  };
}

describe('RealtimeGateway', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes an unauthenticated socket within 5 seconds', () => {
    jest.useFakeTimers();
    const gateway = createGateway(jest.fn(() => new Promise(() => {})));
    const socket = createSocket();

    void gateway.handleConnection(socket as never);

    jest.advanceTimersByTime(UNAUTHENTICATED_CLOSE_MS);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(UNAUTHENTICATED_CLOSE_MS).toBeLessThanOrEqual(5_000);
  });

  it('closes the socket when the ticket is invalid', async () => {
    const gateway = createGateway(
      jest.fn().mockRejectedValue(new Error('invalid ticket')),
    );
    const socket = createSocket();

    await gateway.handleConnection(socket as never);

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('joins the per-user room on success', async () => {
    const gateway = createGateway(
      jest.fn().mockResolvedValue({ userId: 'u1' }),
    );
    const socket = createSocket();

    await gateway.handleConnection(socket as never);

    expect(socket.join).toHaveBeenCalledWith('user:u1');
    expect(socket.emit).toHaveBeenCalledWith('realtime.ready', {
      userId: 'u1',
    });
  });

  it('publishes the shared { id, type, data, at } envelope to the user room', () => {
    const gateway = createGateway(jest.fn());
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as never;

    gateway.publishToUser('u1', 'notification.created', {
      id: 'n1',
      isRead: false,
    });

    expect(to).toHaveBeenCalledWith('user:u1');
    expect(emit).toHaveBeenCalledWith('event', {
      id: expect.any(String) as unknown,
      type: 'notification.created',
      data: { id: 'n1', isRead: false },
      at: expect.any(String) as unknown,
    });
  });

  it('enforces the per-user connection cap', async () => {
    const authenticate = jest.fn().mockResolvedValue({ userId: 'u1' });
    const gateway = createGateway(authenticate);

    for (let index = 0; index < 5; index += 1) {
      await gateway.handleConnection(
        createSocket({ id: `socket-${index}` }) as never,
      );
    }

    const extra = createSocket({ id: 'socket-extra' });
    await gateway.handleConnection(extra as never);

    expect(extra.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ code: 'TOO_MANY_CONNECTIONS' }),
    );
    expect(extra.disconnect).toHaveBeenCalledWith(true);
  });
});
