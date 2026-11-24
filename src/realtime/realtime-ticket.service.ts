import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';

/** Tickets are valid for 30 seconds and for a single connection attempt. */
export const REALTIME_TICKET_TTL_SECONDS = 30;

const TICKET_PREFIX = 'realtime:ticket:';

export interface RealtimeTicket {
  ticket: string;
  expiresAt: Date;
}

/**
 * Issues and consumes the short-lived ticket used to authenticate a socket.
 * The JWT is never put in the WebSocket URL: the client calls
 * `POST /realtime/ticket` with its bearer token, then hands the opaque ticket
 * to socket.io. Consumption is atomic (`GETDEL`), so a ticket can only ever
 * open one connection — including when several instances share Redis.
 */
@Injectable()
export class RealtimeTicketService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeTicketService.name);
  private readonly redis: Redis;
  private readonly redisUrl?: string;

  constructor(private readonly configService: ConfigService) {
    this.redisUrl =
      this.configService.get<string>('redisUrl') ??
      this.configService.get<string>('REDIS_URL');

    this.redis = new Redis(this.redisUrl ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    this.redis.on('error', (error) => {
      this.logger.error(`Realtime ticket Redis error: ${error.message}`);
    });
  }

  async issue(userId: string): Promise<RealtimeTicket> {
    await this.ensureConnected();

    const ticket = randomBytes(32).toString('base64url');
    const stored = await this.redis.set(
      `${TICKET_PREFIX}${ticket}`,
      userId,
      'PX',
      REALTIME_TICKET_TTL_SECONDS * 1000,
      'NX',
    );

    if (stored !== 'OK') {
      throw new ServiceUnavailableException(
        'Could not issue a realtime ticket, please retry',
      );
    }

    return {
      ticket,
      expiresAt: new Date(Date.now() + REALTIME_TICKET_TTL_SECONDS * 1000),
    };
  }

  /** Returns the userId behind the ticket, or null when invalid/expired/used. */
  async consume(ticket: string): Promise<string | null> {
    if (!ticket || ticket.length > 512) {
      return null;
    }

    await this.ensureConnected();

    const userId = await this.redis.getdel(`${TICKET_PREFIX}${ticket}`);
    return userId ?? null;
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'ready' || this.redis.status === 'connect') {
      return;
    }

    try {
      await this.redis.connect();
    } catch (error) {
      throw new ServiceUnavailableException(
        `Realtime ticket store unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
