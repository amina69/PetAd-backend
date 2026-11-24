import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UserStatus } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

interface MessagingSocket extends Socket {
  data: {
    userId?: string;
  };
}

/**
 * Realtime delivery for messaging. Sockets authenticate with the same JWT as
 * the REST API and join their personal room; conversations are delivered to
 * participant user rooms (and the conversation room when a client joins it).
 */
@WebSocketGateway({
  // Authentication is token-based, so no cookie credentials are exchanged.
  cors: { origin: '*', credentials: false },
})
export class MessagingGateway implements OnGatewayConnection {
  private readonly logger = new Logger(MessagingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: MessagingSocket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        throw new Error('Missing token');
      }

      const payload = await this.jwtService.verifyAsync<{ sub?: string }>(
        token,
      );

      if (!payload.sub) {
        throw new Error('Invalid token');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, status: true },
      });

      if (!user || user.status === UserStatus.DELETED) {
        throw new Error('Unknown user');
      }

      client.data.userId = user.id;
      await client.join(this.userRoom(user.id));
    } catch (error) {
      this.logger.debug(
        `Rejected socket connection: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      client.disconnect(true);
    }
  }

  /**
   * Optional conversation room join. Non-participants are refused without
   * revealing whether the conversation exists.
   */
  @SubscribeMessage('conversation:join')
  async handleJoinConversation(
    @ConnectedSocket() client: MessagingSocket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const userId = client.data.userId;
    const conversationId = body?.conversationId;

    if (!userId || !conversationId) {
      return { ok: false };
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ participantOneId: userId }, { participantTwoId: userId }],
      },
      select: { id: true },
    });

    if (!conversation) {
      return { ok: false };
    }

    await client.join(this.conversationRoom(conversationId));
    return { ok: true };
  }

  emitNewMessage(
    conversationId: string,
    participantIds: string[],
    message: unknown,
  ) {
    if (!this.server) return;

    // Socket.IO unions chained rooms, so a socket that joined both the
    // conversation room and its personal room still receives one event.
    let target = this.server.to(this.conversationRoom(conversationId));
    for (const participantId of new Set(participantIds)) {
      target = target.to(this.userRoom(participantId));
    }

    target.emit('message.new', message);
  }

  emitReadReceipt(
    participantId: string,
    payload: {
      conversationId: string;
      userId: string;
      messageId: string | null;
      readAt: Date;
    },
  ) {
    if (!this.server) return;
    this.server.to(this.userRoom(participantId)).emit('message.read', payload);
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  private conversationRoom(conversationId: string): string {
    return `conversation:${conversationId}`;
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) {
      return authToken.replace(/^Bearer\s+/i, '');
    }

    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.length > 0) {
      return header.replace(/^Bearer\s+/i, '');
    }

    const queryToken = client.handshake.query.token;
    return typeof queryToken === 'string' ? queryToken : undefined;
  }
}
