import { Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { RealtimeTicketService } from './realtime-ticket.service';

export interface WsUser {
  userId: string;
}

function extractTicket(client: Socket): string | null {
  const auth: unknown = client.handshake.auth;
  const authTicket =
    typeof auth === 'object' && auth !== null
      ? (auth as Record<string, unknown>).ticket
      : undefined;

  if (typeof authTicket === 'string' && authTicket.length > 0) {
    return authTicket;
  }

  const header = client.handshake.headers?.authorization;
  if (
    typeof header === 'string' &&
    header.toLowerCase().startsWith('bearer ')
  ) {
    return header.slice('bearer '.length).trim();
  }

  return null;
}

/**
 * Authenticates a socket at connection time. Deliberately does not accept a
 * JWT: only the single-use ticket from POST /realtime/ticket is valid.
 */
@Injectable()
export class WsAuthGuard {
  constructor(private readonly tickets: RealtimeTicketService) {}

  async authenticate(client: Socket): Promise<WsUser> {
    const ticket = extractTicket(client);

    if (!ticket) {
      throw new WsException('Missing realtime ticket');
    }

    const userId = await this.tickets.consume(ticket);

    if (!userId) {
      throw new WsException('Invalid, expired or already used realtime ticket');
    }

    return { userId };
  }
}
