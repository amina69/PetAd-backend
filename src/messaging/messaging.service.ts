import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentKind, Prisma, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingGateway } from './messaging.gateway';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto, ListMessagesQueryDto } from './dto/send-message.dto';
import { ReadReceiptDto, ReportConversationDto } from './dto/read-receipt.dto';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const REPORT_SNAPSHOT_MESSAGES = 50;

const USER_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  body: true,
  createdAt: true,
  attachments: {
    select: {
      document: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          size: true,
          kind: true,
        },
      },
    },
  },
} satisfies Prisma.MessageSelect;

type MessageView = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

function buildConversationInclude(userId: string) {
  const participantSelect = {
    ...USER_SUMMARY_SELECT,
    blocksCreated: {
      where: { blockerId: userId },
      select: { blockedId: true },
    },
  } satisfies Prisma.UserSelect;

  return {
    pet: {
      select: {
        id: true,
        name: true,
        species: true,
        imageUrl: true,
      },
    },
    participantOne: { select: participantSelect },
    participantTwo: { select: participantSelect },
    participants: {
      select: {
        userId: true,
        lastReadMessageId: true,
        lastReadAt: true,
      },
    },
    messages: {
      take: 1,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ] as Prisma.MessageOrderByWithRelationInput[],
      select: MESSAGE_SELECT,
    },
  } satisfies Prisma.ConversationInclude;
}

type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: ReturnType<typeof buildConversationInclude>;
}>;

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: MessagingGateway,
  ) {}

  /**
   * Creates (or returns) the single conversation for a pet and two
   * participants. Participant ids are stored in a normalised order, so the
   * unique key makes repeated calls idempotent.
   */
  async createConversation(userId: string, dto: CreateConversationDto) {
    await this.assertEmailVerified(userId);

    if (dto.participantId === userId) {
      throw new BadRequestException(
        'A conversation needs two different participants',
      );
    }

    const [pet, otherUser] = await Promise.all([
      this.prisma.pet.findUnique({
        where: { id: dto.petId },
        select: { id: true },
      }),
      this.prisma.user.findUnique({
        where: { id: dto.participantId },
        select: { id: true, status: true },
      }),
    ]);

    if (!pet) {
      throw new NotFoundException('Pet not found');
    }

    if (!otherUser || otherUser.status === UserStatus.DELETED) {
      throw new NotFoundException('User not found');
    }

    const [participantOneId, participantTwoId] = [
      userId,
      dto.participantId,
    ].sort();

    const existing = await this.prisma.conversation.findUnique({
      where: {
        petId_participantOneId_participantTwoId: {
          petId: dto.petId,
          participantOneId,
          participantTwoId,
        },
      },
      include: buildConversationInclude(userId),
    });

    if (existing) {
      return this.toConversationView(existing, userId);
    }

    try {
      const conversation = await this.prisma.conversation.create({
        data: {
          petId: dto.petId,
          participantOneId,
          participantTwoId,
          participants: {
            create: [
              { userId: participantOneId },
              { userId: participantTwoId },
            ],
          },
        },
        include: buildConversationInclude(userId),
      });

      return this.toConversationView(conversation, userId);
    } catch (error) {
      // Lost a race against a concurrent create: return the winner's row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const conversation = await this.prisma.conversation.findUnique({
          where: {
            petId_participantOneId_participantTwoId: {
              petId: dto.petId,
              participantOneId,
              participantTwoId,
            },
          },
          include: buildConversationInclude(userId),
        });

        if (conversation) {
          return this.toConversationView(conversation, userId);
        }
      }

      throw error;
    }
  }

  async listConversations(userId: string) {
    await this.assertEmailVerified(userId);

    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ participantOneId: userId }, { participantTwoId: userId }],
      },
      orderBy: { updatedAt: 'desc' },
      include: buildConversationInclude(userId),
    });

    return conversations.map((conversation) =>
      this.toConversationView(conversation, userId),
    );
  }

  async getConversation(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ participantOneId: userId }, { participantTwoId: userId }],
      },
      include: buildConversationInclude(userId),
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.toConversationView(conversation, userId);
  }

  /**
   * Cursor-paginated messages, newest first. The cursor is the id of the last
   * message on the previous page.
   */
  async listMessages(
    conversationId: string,
    userId: string,
    query: ListMessagesQueryDto,
  ) {
    await this.assertParticipant(conversationId, userId);

    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );

    if (query.cursor) {
      const cursor = await this.prisma.message.findFirst({
        where: { id: query.cursor, conversationId },
        select: { id: true },
      });

      if (!cursor) {
        throw new BadRequestException('Invalid message cursor');
      }
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: MESSAGE_SELECT,
    });

    const hasMore = messages.length > limit;
    const data = messages.slice(0, limit);

    return {
      data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
      hasMore,
    };
  }

  /**
   * Stores and broadcasts a message. Blocking never reveals itself: when
   * either direction is blocked the call returns the same envelope as a
   * successful send with `delivered: false` and no message is persisted.
   */
  async sendMessage(
    conversationId: string,
    userId: string,
    dto: SendMessageDto,
  ) {
    await this.assertEmailVerified(userId);

    const conversation = await this.assertParticipant(conversationId, userId);

    if (dto.body.trim().length === 0) {
      throw new BadRequestException('Message body must not be empty');
    }

    const attachmentIds = [...new Set(dto.attachmentDocumentIds ?? [])];

    if (attachmentIds.length > 3) {
      throw new BadRequestException('A message can have at most 3 attachments');
    }

    if (attachmentIds.length > 0) {
      const documents = await this.prisma.document.findMany({
        where: {
          id: { in: attachmentIds },
          uploadedById: userId,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (documents.length !== attachmentIds.length) {
        throw new BadRequestException(
          'Attachments must be your own, existing documents',
        );
      }
    }

    const otherUserId =
      conversation.participantOneId === userId
        ? conversation.participantTwoId
        : conversation.participantOneId;

    if (await this.isBlockedBetween(userId, otherUserId)) {
      return {
        message: {
          id: randomUUID(),
          conversationId,
          senderId: userId,
          body: dto.body,
          attachments: [],
          createdAt: new Date(),
        },
        delivered: false,
      };
    }

    let message: MessageView;

    try {
      message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            conversationId,
            senderId: userId,
            body: dto.body,
            attachments: {
              create: attachmentIds.map((documentId) => ({ documentId })),
            },
          },
          select: MESSAGE_SELECT,
        });

        if (attachmentIds.length > 0) {
          // Attachments become part of the message they were sent with, so
          // document authorisation and moderation can follow the link.
          await tx.document.updateMany({
            where: { id: { in: attachmentIds }, uploadedById: userId },
            data: {
              kind: DocumentKind.MESSAGE_ATTACHMENT,
              entityType: 'MESSAGE',
              entityId: created.id,
            },
          });
        }

        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'One of the attachments is already used by another message',
        );
      }
      throw error;
    }

    this.broadcast(() =>
      this.gateway.emitNewMessage(
        conversationId,
        [conversation.participantOneId, conversation.participantTwoId],
        message,
      ),
    );

    return { message, delivered: true };
  }

  /**
   * Moves the read position. When no message id is supplied, everything up to
   * the newest message is marked read.
   */
  async markRead(conversationId: string, userId: string, dto: ReadReceiptDto) {
    await this.assertParticipant(conversationId, userId);

    const messageId = dto.messageId
      ? (
          await this.prisma.message.findFirst({
            where: { id: dto.messageId, conversationId },
            select: { id: true },
          })
        )?.id
      : (
          await this.prisma.message.findFirst({
            where: { conversationId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true },
          })
        )?.id;

    if (dto.messageId && !messageId) {
      throw new NotFoundException('Message not found');
    }

    const readAt = new Date();

    const participant = await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: {
        lastReadMessageId: messageId ?? null,
        lastReadAt: readAt,
      },
      select: {
        userId: true,
        lastReadMessageId: true,
        lastReadAt: true,
      },
    });

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { participantOneId: true, participantTwoId: true },
    });

    if (conversation) {
      const otherUserId =
        conversation.participantOneId === userId
          ? conversation.participantTwoId
          : conversation.participantOneId;

      this.broadcast(() =>
        this.gateway.emitReadReceipt(otherUserId, {
          conversationId,
          userId,
          messageId: participant.lastReadMessageId,
          readAt,
        }),
      );
    }

    return {
      conversationId,
      ...participant,
    };
  }

  /**
   * Captures the last N messages as an immutable moderation snapshot.
   */
  async reportConversation(
    conversationId: string,
    userId: string,
    dto: ReportConversationDto,
  ) {
    await this.assertParticipant(conversationId, userId);

    const recent = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: REPORT_SNAPSHOT_MESSAGES,
      select: MESSAGE_SELECT,
    });

    const capturedAt = new Date();
    const snapshot = {
      conversationId,
      reporterId: userId,
      capturedAt: capturedAt.toISOString(),
      messages: recent
        .slice()
        .reverse()
        .map((message) => ({
          id: message.id,
          senderId: message.senderId,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
          attachments: message.attachments.map(
            (attachment) => attachment.document,
          ),
        })),
    };

    const report = await this.prisma.report.create({
      data: {
        conversationId,
        reporterId: userId,
        reason: dto.reason.trim(),
        details: dto.details?.trim() ?? null,
        snapshot,
      },
      select: {
        id: true,
        conversationId: true,
        reporterId: true,
        reason: true,
        createdAt: true,
      },
    });

    return report;
  }

  /**
   * Blocks another user. The blocked user is never told: sends in either
   * direction are silently accepted-but-undelivered.
   */
  async blockUser(actorId: string, targetUserId: string) {
    if (actorId === targetUserId) {
      throw new BadRequestException('You cannot block yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });

    if (!target || target.status === UserStatus.DELETED) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.block.upsert({
      where: {
        blockerId_blockedId: {
          blockerId: actorId,
          blockedId: targetUserId,
        },
      },
      create: { blockerId: actorId, blockedId: targetUserId },
      update: {},
    });

    return { message: 'User blocked' };
  }

  private async isBlockedBetween(
    firstUserId: string,
    secondUserId: string,
  ): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: firstUserId, blockedId: secondUserId },
          { blockerId: secondUserId, blockedId: firstUserId },
        ],
      },
      select: { id: true },
    });

    return block !== null;
  }

  private async assertEmailVerified(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true, status: true },
    });

    if (!user || user.status === UserStatus.DELETED) {
      throw new NotFoundException('User not found');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address before using messaging',
      });
    }
  }

  private async assertParticipant(
    conversationId: string,
    userId: string,
  ): Promise<{
    id: string;
    participantOneId: string;
    participantTwoId: string;
  }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ participantOneId: userId }, { participantTwoId: userId }],
      },
      select: {
        id: true,
        participantOneId: true,
        participantTwoId: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  private toConversationView(
    conversation: ConversationWithRelations,
    userId: string,
  ) {
    const { participantOne, participantTwo, participants, messages, ...rest } =
      conversation;

    const other =
      participantOne.id === userId ? participantTwo : participantOne;

    const { blocksCreated, ...otherPublic } = other;

    return {
      ...rest,
      participants,
      otherParticipant: otherPublic,
      lastMessage: messages[0] ?? null,
      // Only the blocker learns about the block; the blocked party does not.
      blockedByMe: blocksCreated.length > 0,
    };
  }

  private broadcast(emit: () => void) {
    try {
      emit();
    } catch {
      // Realtime delivery is best-effort; the message is already durable.
    }
  }
}
