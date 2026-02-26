import { Test, TestingModule } from '@nestjs/testing';
import { CustodyService } from './custody.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CustodyStatus, EventEntityType, EventType } from '@prisma/client';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('CustodyService', () => {
  let service: CustodyService;
  let prismaService: PrismaService;
  let eventsService: EventsService;

  const mockCustody = {
    id: 'custody-1',
    status: CustodyStatus.ACTIVE,
    type: 'TEMPORARY',
    depositAmount: 100,
    startDate: new Date(),
    endDate: null,
    petId: 'pet-1',
    holderId: 'user-1',
    escrowId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    holder: {
      id: 'user-1',
      email: 'holder@example.com',
      firstName: 'John',
      lastName: 'Doe',
      trustScore: 50,
    },
    pet: {
      id: 'pet-1',
      name: 'Buddy',
      species: 'DOG',
    },
  };

  const mockPrismaService = {
    custody: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockEventsService = {
    logEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustodyService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
      ],
    }).compile();

    service = module.get<CustodyService>(CustodyService);
    prismaService = module.get<PrismaService>(PrismaService);
    eventsService = module.get<EventsService>(EventsService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateStatus', () => {
    describe('Valid Transitions', () => {
      it('should update status from ACTIVE to RETURNED', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);
        mockPrismaService.custody.update.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.RETURNED,
          endDate: new Date(),
        });

        const result = await service.updateStatus(
          'custody-1',
          CustodyStatus.RETURNED,
          'actor-1',
        );

        expect(result.status).toBe(CustodyStatus.RETURNED);
        expect(mockPrismaService.custody.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'custody-1' },
            data: expect.objectContaining({
              status: CustodyStatus.RETURNED,
              endDate: expect.any(Date),
            }),
          }),
        );
        expect(mockEventsService.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            entityType: EventEntityType.CUSTODY,
            entityId: 'custody-1',
            eventType: EventType.CUSTODY_RETURNED,
            actorId: 'actor-1',
          }),
        );
      });

      it('should update status from ACTIVE to CANCELLED', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);
        mockPrismaService.custody.update.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.CANCELLED,
          endDate: new Date(),
        });

        const result = await service.updateStatus(
          'custody-1',
          CustodyStatus.CANCELLED,
        );

        expect(result.status).toBe(CustodyStatus.CANCELLED);
        expect(mockPrismaService.custody.update).toHaveBeenCalled();
        expect(mockEventsService.logEvent).toHaveBeenCalled();
      });

      it('should update status from ACTIVE to VIOLATION', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);
        mockPrismaService.custody.update.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.VIOLATION,
          endDate: new Date(),
        });
        mockPrismaService.user.findUnique.mockResolvedValue({
          id: 'user-1',
          trustScore: 50,
        });
        mockPrismaService.user.update.mockResolvedValue({
          id: 'user-1',
          trustScore: 40,
        });

        const result = await service.updateStatus(
          'custody-1',
          CustodyStatus.VIOLATION,
          'actor-1',
        );

        expect(result.status).toBe(CustodyStatus.VIOLATION);
        expect(mockPrismaService.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'user-1' },
            data: { trustScore: 40 },
          }),
        );
        expect(mockEventsService.logEvent).toHaveBeenCalledTimes(2); // Custody event + Trust score event
      });
    });

    describe('Invalid Transitions', () => {
      it('should throw error when transitioning from terminal state RETURNED', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.RETURNED,
        });

        await expect(
          service.updateStatus('custody-1', CustodyStatus.ACTIVE),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw error when transitioning from terminal state CANCELLED', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.CANCELLED,
        });

        await expect(
          service.updateStatus('custody-1', CustodyStatus.ACTIVE),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw error when transitioning from terminal state VIOLATION', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.VIOLATION,
        });

        await expect(
          service.updateStatus('custody-1', CustodyStatus.ACTIVE),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw error for no-op transition', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);

        await expect(
          service.updateStatus('custody-1', CustodyStatus.ACTIVE),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('Error Handling', () => {
      it('should throw NotFoundException when custody does not exist', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue(null);

        await expect(
          service.updateStatus('invalid-id', CustodyStatus.RETURNED),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('Trust Score Updates', () => {
      it('should reduce trust score by 10 on VIOLATION', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);
        mockPrismaService.custody.update.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.VIOLATION,
        });
        mockPrismaService.user.findUnique.mockResolvedValue({
          id: 'user-1',
          trustScore: 50,
        });
        mockPrismaService.user.update.mockResolvedValue({
          id: 'user-1',
          trustScore: 40,
        });

        await service.updateStatus('custody-1', CustodyStatus.VIOLATION);

        expect(mockPrismaService.user.update).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          data: { trustScore: 40 },
        });
      });

      it('should not reduce trust score below 0', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);
        mockPrismaService.custody.update.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.VIOLATION,
        });
        mockPrismaService.user.findUnique.mockResolvedValue({
          id: 'user-1',
          trustScore: 5,
        });
        mockPrismaService.user.update.mockResolvedValue({
          id: 'user-1',
          trustScore: 0,
        });

        await service.updateStatus('custody-1', CustodyStatus.VIOLATION);

        expect(mockPrismaService.user.update).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          data: { trustScore: 0 },
        });
      });

      it('should log trust score update event on VIOLATION', async () => {
        mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);
        mockPrismaService.custody.update.mockResolvedValue({
          ...mockCustody,
          status: CustodyStatus.VIOLATION,
        });
        mockPrismaService.user.findUnique.mockResolvedValue({
          id: 'user-1',
          trustScore: 50,
        });
        mockPrismaService.user.update.mockResolvedValue({
          id: 'user-1',
          trustScore: 40,
        });

        await service.updateStatus('custody-1', CustodyStatus.VIOLATION);

        expect(mockEventsService.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            entityType: EventEntityType.USER,
            entityId: 'user-1',
            eventType: EventType.TRUST_SCORE_UPDATED,
            payload: expect.objectContaining({
              reason: 'CUSTODY_VIOLATION',
              penalty: 10,
            }),
          }),
        );
      });
    });
  });

  describe('findOne', () => {
    it('should return custody by ID', async () => {
      mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);

      const result = await service.findOne('custody-1');

      expect(result).toEqual(mockCustody);
      expect(mockPrismaService.custody.findUnique).toHaveBeenCalledWith({
        where: { id: 'custody-1' },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException when custody does not exist', async () => {
      mockPrismaService.custody.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAllowedTransitions', () => {
    it('should return allowed transitions for ACTIVE status', async () => {
      mockPrismaService.custody.findUnique.mockResolvedValue(mockCustody);

      const result = await service.getAllowedTransitions('custody-1');

      expect(result.currentStatus).toBe(CustodyStatus.ACTIVE);
      expect(result.allowedTransitions).toContain(CustodyStatus.RETURNED);
      expect(result.allowedTransitions).toContain(CustodyStatus.CANCELLED);
      expect(result.allowedTransitions).toContain(CustodyStatus.VIOLATION);
      expect(result.isTerminal).toBe(false);
    });

    it('should return empty transitions for terminal state', async () => {
      mockPrismaService.custody.findUnique.mockResolvedValue({
        ...mockCustody,
        status: CustodyStatus.RETURNED,
      });

      const result = await service.getAllowedTransitions('custody-1');

      expect(result.currentStatus).toBe(CustodyStatus.RETURNED);
      expect(result.allowedTransitions).toEqual([]);
      expect(result.isTerminal).toBe(true);
    });
  });
});
