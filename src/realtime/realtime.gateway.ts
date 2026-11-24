import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { WsAuthGuard } from './ws-auth.guard';
import type { RealtimeEnvelope, RealtimePublisher } from './realtime.publisher';

/** A socket that has not authenticated by then is dropped (limit is 5 s). */
export const UNAUTHENTICATED_CLOSE_MS = 4_000;

const DEFAULT_MAX_CONNECTIONS_PER_USER = 5;
const INBOUND_WINDOW_MS = 10_000;
const INBOUND_MAX_MESSAGES = 20;

function userRoom(userId: string): string {
  return `user:${userId}`;
}

interface RealTimeSocketData {
  userId?: string;
  inboundTimestamps?: number[];
}

@WebSocketGateway({
  path: '/realtime',
  serveClient: false,
  cors: { origin: true, credentials: false },
  pingInterval: 25_000,
  pingTimeout: 20_000,
})
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy,
    RealtimePublisher
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly connections = new Map<string, Set<string>>();
  private readonly redisClients: Redis[] = [];
  private readonly maxConnectionsPerUser: number;
  private readonly redisUrl?: string;

  constructor(
    private readonly authGuard: WsAuthGuard,
    configService: ConfigService,
  ) {
    const configured = Number(
      configService.get<string>('REALTIME_MAX_CONNECTIONS_PER_USER'),
    );
    this.maxConnectionsPerUser =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_MAX_CONNECTIONS_PER_USER;
    this.redisUrl =
      configService.get<string>('redisUrl') ??
      configService.get<string>('REDIS_URL');
  }

  /**
   * Installs the Redis pub/sub adapter so events reach clients connected to
   * any instance, not just the one that produced them.
   */
  afterInit(server: Server): void {
    if (!this.redisUrl) {
      this.logger.warn(
        'REDIS_URL is not set: realtime events will not cross instances.',
      );
      return;
    }

    const pubClient = new Redis(this.redisUrl, {
      maxRetriesPerRequest: null,
    });
    const subClient = pubClient.duplicate();

    for (const client of [pubClient, subClient]) {
      client.on('error', (error) => {
        this.logger.error(`Realtime Redis adapter error: ${error.message}`);
      });
    }

    server.adapter(
      createAdapter(pubClient, subClient, { requestsTimeout: 5_000 }),
    );
    this.redisClients.push(pubClient, subClient);
  }

  async handleConnection(client: Socket): Promise<void> {
    const data = client.data as RealTimeSocketData;

    const unauthenticatedTimer = setTimeout(() => {
      if (!data.userId && client.connected) {
        client.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Authentication timed out',
        });
        client.disconnect(true);
      }
    }, UNAUTHENTICATED_CLOSE_MS);

    try {
      const { userId } = await this.authGuard.authenticate(client);
      clearTimeout(unauthenticatedTimer);

      const sockets = this.connections.get(userId) ?? new Set<string>();

      if (sockets.size >= this.maxConnectionsPerUser) {
        client.emit('error', {
          code: 'TOO_MANY_CONNECTIONS',
          message: `At most ${this.maxConnectionsPerUser} concurrent connections are allowed`,
        });
        client.disconnect(true);
        return;
      }

      data.userId = userId;
      data.inboundTimestamps = [];
      sockets.add(client.id);
      this.connections.set(userId, sockets);

      await client.join(userRoom(userId));

      this.registerInboundHandlers(client, data);

      client.emit('realtime.ready', { userId });
    } catch (error) {
      clearTimeout(unauthenticatedTimer);
      client.emit('error', {
        code: 'UNAUTHORIZED',
        message:
          error instanceof Error ? error.message : 'Authentication failed',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as RealTimeSocketData;
    if (!data.userId) {
      return;
    }

    const sockets = this.connections.get(data.userId);
    if (!sockets) {
      return;
    }

    sockets.delete(client.id);
    if (sockets.size === 0) {
      this.connections.delete(data.userId);
    }
  }

  /**
   * Emits an envelope to every socket of a user, across instances (through
   * the Redis adapter). Envelope shape matches the REST schema:
   * `{ id, type, data, at }`.
   */
  publishToUser(userId: string, type: string, data: unknown): void {
    if (!this.server) {
      return;
    }

    const envelope: RealtimeEnvelope = {
      id: randomUUID(),
      type,
      data,
      at: new Date().toISOString(),
    };

    this.server.to(userRoom(userId)).emit('event', envelope);
  }

  private registerInboundHandlers(
    client: Socket,
    data: RealTimeSocketData,
  ): void {
    client.on('ping', () => {
      if (!this.consumeInboundBudget(client, data)) {
        return;
      }
      client.emit('pong', { at: new Date().toISOString() });
    });

    // Any other inbound event is counted against the same budget; clients
    // have no reason to push data on this channel yet.
    client.onAny(() => {
      this.consumeInboundBudget(client, data);
    });
  }

  private consumeInboundBudget(
    client: Socket,
    data: RealTimeSocketData,
  ): boolean {
    const now = Date.now();
    const timestamps = (data.inboundTimestamps ?? []).filter(
      (timestamp) => now - timestamp < INBOUND_WINDOW_MS,
    );

    if (timestamps.length >= INBOUND_MAX_MESSAGES) {
      client.emit('error', {
        code: 'RATE_LIMITED',
        message: 'Too many messages, closing connection',
      });
      client.disconnect(true);
      return false;
    }

    timestamps.push(now);
    data.inboundTimestamps = timestamps;
    return true;
  }

  onModuleDestroy(): void {
    for (const client of this.redisClients) {
      client.disconnect();
    }
  }
}
