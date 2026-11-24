/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MessagingService } from './messaging.service';

const USER_ID = 'user-1';
const OTHER_ID = 'user-2';

function conversationFixture(id = 'conversation-1') {
  return {
    id,
    petId: 'pet-1',
    participantOneId: USER_ID,
    participantTwoId: OTHER_ID,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    pet: { id: 'pet-1', name: 'Rex', species: 'DOG', imageUrl: null },
    participantOne: {
      id: USER_ID,
      firstName: 'A',
      lastName: 'B',
      avatarUrl: null,
      blocksCreated: [],
    },
    participantTwo: {
      id: OTHER_ID,
      firstName: 'C',
      lastName: 'D',
      avatarUrl: null,
      blocksCreated: [],
    },
    participants: [],
    messages: [],
  };
}

describe('MessagingService', () => {
  let service: MessagingService;
  let prisma: any;
  let gateway: any;
  let tx: any;

  beforeEach(() => {
    tx = {
      message: { create: jest.fn() },
      document: { updateMany: jest.fn() },
      conversation: { update: jest.fn() },
    };

    prisma = {
      user: { findUnique: jest.fn() },
      pet: { findUnique: jest.fn() },
      conversation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      message: { findFirst: jest.fn(), findMany: jest.fn() },
      document: { findMany: jest.fn() },
      block: { findFirst: jest.fn(), upsert: jest.fn() },
      report: { create: jest.fn() },
      conversationParticipant: { update: jest.fn() },
      $transaction: jest.fn((callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };

    gateway = {
      emitNewMessage: jest.fn(),
      emitReadReceipt: jest.fn(),
    };

    service = new MessagingService(prisma, gateway);
  });

  it('returns the existing conversation id when created twice', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ emailVerified: true, status: 'ACTIVE' })
      .mockResolvedValueOnce({ id: OTHER_ID, status: 'ACTIVE' });
    prisma.pet.findUnique.mockResolvedValue({ id: 'pet-1' });
    prisma.conversation.findUnique.mockResolvedValue(conversationFixture());

    const result = await service.createConversation(USER_ID, {
      petId: 'pet-1',
      participantId: OTHER_ID,
    });

    expect(result.id).toBe('conversation-1');
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('rejects messaging for accounts with an unverified email', async () => {
    prisma.user.findUnique.mockResolvedValue({
      emailVerified: false,
      status: 'ACTIVE',
    });

    await expect(
      service.createConversation(USER_ID, {
        petId: 'pet-1',
        participantId: OTHER_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hides conversations from non-participants with a 404', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.listMessages('conversation-1', USER_ID, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stores the message body as plain text without interpreting HTML', async () => {
    const body = '<script>alert("x")</script>';
    prisma.user.findUnique.mockResolvedValue({
      emailVerified: true,
      status: 'ACTIVE',
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      participantOneId: USER_ID,
      participantTwoId: OTHER_ID,
    });
    prisma.block.findFirst.mockResolvedValue(null);
    prisma.document.findMany.mockResolvedValue([]);
    tx.message.create.mockResolvedValue({
      id: 'message-1',
      conversationId: 'conversation-1',
      senderId: USER_ID,
      body,
      createdAt: new Date(),
      attachments: [],
    });

    const result = await service.sendMessage('conversation-1', USER_ID, {
      body,
    });

    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body }),
      }),
    );
    expect(result.delivered).toBe(true);
    expect(gateway.emitNewMessage).toHaveBeenCalled();
  });

  it('accepts but does not deliver messages when either party blocked the other', async () => {
    prisma.user.findUnique.mockResolvedValue({
      emailVerified: true,
      status: 'ACTIVE',
    });
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      participantOneId: USER_ID,
      participantTwoId: OTHER_ID,
    });
    prisma.block.findFirst.mockResolvedValue({ id: 'block-1' });

    const result = await service.sendMessage('conversation-1', USER_ID, {
      body: 'hello',
    });

    expect(result.delivered).toBe(false);
    expect(result).toHaveProperty('message');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(gateway.emitNewMessage).not.toHaveBeenCalled();
  });
});
