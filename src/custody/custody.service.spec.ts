import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { CustodyStateMachine } from './custody-state-machine.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowService } from '../escrow/escrow.service';
import { UsersService } from '../users/users.service';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';
import { NotificationQueueService } from '../jobs/services/notification-queue.service';
import { CustodyStatus } from '@prisma/client';
import { CreateCustodyDto } from './dto/create-custody.dto';
import { PetStatus } from '../common/enums/pet-status.enum';

describe('CustodyService', () => {
  let service: CustodyService;
  let stateMachine: CustodyStateMachine;

  const mockPrismaService = {
    pet: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    custody: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    adoption: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockEventsService = { logEvent: jest.fn() };
  const mockEscrowService = {
    createEscrow: jest.fn(),
    releaseEscrow: jest.fn(),
    refundEscrow: jest.fn(),
  };
  const mockUsersService = { updateTrustScore: jest.fn() };
  const mockPetAvailabilityService = {
    resolve: jest.fn().mockResolvedValue(PetStatus.AVAILABLE),
  };
  const mockNotificationQueueService = {
    enqueueSendTransactionalEmail: jest.fn(),
  };

  // Real state machine — we test that the service actually enforces transitions
  const realStateMachine = new CustodyStateMachine();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustodyService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: EscrowService, useValue: mockEscrowService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: PetAvailabilityService, useValue: mockPetAvailabilityService },
        { provide: CustodyStateMachine, useValue: realStateMachine },
        { provide: NotificationQueueService, useValue: mockNotificationQueueService },
      ],
    }).compile();

    service = module.get<CustodyService>(CustodyService);
    stateMachine = module.get<CustodyStateMachine>(CustodyStateMachine);
    jest.clearAllMocks();
    mockPetAvailabilityService.resolve.mockResolvedValue(PetStatus.AVAILABLE);
    mockEventsService.logEvent.mockResolvedValue({});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── createCustody ────────────────────────────────────────────────────────

  describe('createCustody', () => {
    const userId = 'user-123';
    const createCustodyDto: CreateCustodyDto = {
      petId: 'pet-123',
      startDate: '2024-12-25T00:00:00.000Z',
      durationDays: 14,
      depositAmount: 100,
    };

    it('throws NotFoundException when pet does not exist', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue(null);
      await expect(service.createCustody(userId, createCustodyDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when pet is already adopted', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue({ id: 'pet-123' });
      mockPrismaService.adoption.findFirst.mockResolvedValueOnce({ id: 'a1', status: 'COMPLETED' });
      await expect(service.createCustody(userId, createCustodyDto)).rejects.toThrow(
        'Pet is already adopted',
      );
    });

    it('throws BadRequestException when pet has active adoption in progress', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue({ id: 'pet-123' });
      mockPrismaService.adoption.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'a1', status: 'PENDING' });
      await expect(service.createCustody(userId, createCustodyDto)).rejects.toThrow(
        'Pet has an active adoption in progress',
      );
    });

    it('throws BadRequestException when pet has active custody', async () => {
      mockPrismaService.pet.findUnique.mockResolvedValue({ id: 'pet-123' });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue({ id: 'c1', status: 'ACTIVE' });
      await expect(service.createCustody(userId, createCustodyDto)).rejects.toThrow(
        'Pet already has an active custody agreement',
      );
    });

    it('throws BadRequestException when startDate is in the past', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      mockPrismaService.pet.findUnique.mockResolvedValue({ id: 'pet-123' });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      await expect(
        service.createCustody(userId, { ...createCustodyDto, startDate: pastDate.toISOString() }),
      ).rejects.toThrow('Start date cannot be in the past');
    });

    it('throws BadRequestException when durationDays < 1', async () => {
      const future = new Date(); future.setDate(future.getDate() + 7);
      mockPrismaService.pet.findUnique.mockResolvedValue({ id: 'pet-123' });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      await expect(
        service.createCustody(userId, { ...createCustodyDto, startDate: future.toISOString(), durationDays: 0 }),
      ).rejects.toThrow('Duration must be between 1 and 90 days');
    });

    it('throws BadRequestException when durationDays > 90', async () => {
      const future = new Date(); future.setDate(future.getDate() + 7);
      mockPrismaService.pet.findUnique.mockResolvedValue({ id: 'pet-123' });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      await expect(
        service.createCustody(userId, { ...createCustodyDto, startDate: future.toISOString(), durationDays: 91 }),
      ).rejects.toThrow('Duration must be between 1 and 90 days');
    });

    it('creates custody successfully and logs CUSTODY_STARTED event', async () => {
      const future = new Date(); future.setDate(future.getDate() + 7);
      const mockCustody = {
        id: 'custody-123', status: 'PENDING', type: 'TEMPORARY',
        holderId: userId, petId: 'pet-123',
        startDate: new Date(future), endDate: new Date(),
        depositAmount: 100, escrowId: 'escrow-123',
        createdAt: new Date(), updatedAt: new Date(), pet: { id: 'pet-123' },
      };

      mockPrismaService.pet.findUnique.mockResolvedValue({ id: 'pet-123' });
      mockPrismaService.adoption.findFirst.mockResolvedValue(null);
      mockPrismaService.custody.findFirst.mockResolvedValue(null);
      mockEscrowService.createEscrow.mockResolvedValue({ id: 'escrow-123' });
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { create: jest.fn().mockResolvedValue(mockCustody) } }),
      );

      const result = await service.createCustody(userId, {
        ...createCustodyDto, startDate: future.toISOString(),
      });

      expect(result.status).toBe('PENDING');
      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'CUSTODY_STARTED', entityId: 'custody-123' }),
      );
    });
  });

  // ─── State machine enforcement ────────────────────────────────────────────

  describe('returnCustody — state machine enforcement', () => {
    const makeCustody = (status: CustodyStatus) => ({
      id: 'custody-1', status, holderId: 'holder-1', petId: 'pet-1',
      escrowId: null, holder: {}, pet: {},
    });

    it('succeeds for ACTIVE → RETURNED', async () => {
      const custody = makeCustody(CustodyStatus.ACTIVE);
      const updated = { ...custody, status: CustodyStatus.RETURNED };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );
      mockUsersService.updateTrustScore.mockResolvedValue({});

      const result = await service.returnCustody('custody-1');
      expect(result.status).toBe(CustodyStatus.RETURNED);
    });

    it('blocks PENDING → RETURNED via state machine', async () => {
      const custody = makeCustody(CustodyStatus.PENDING);
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(custody) } }),
      );
      await expect(service.returnCustody('custody-1')).rejects.toThrow(BadRequestException);
    });

    it('blocks RETURNED → RETURNED (terminal state)', async () => {
      const custody = makeCustody(CustodyStatus.RETURNED);
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(custody) } }),
      );
      await expect(service.returnCustody('custody-1')).rejects.toThrow(/terminal/i);
    });
  });

  describe('violationCustody — state machine enforcement', () => {
    const makeCustody = (status: CustodyStatus) => ({
      id: 'custody-1', status, holderId: 'holder-1', petId: 'pet-1',
      escrowId: null, holder: {}, pet: {},
    });

    it('succeeds for ACTIVE → VIOLATION', async () => {
      const custody = makeCustody(CustodyStatus.ACTIVE);
      const updated = { ...custody, status: CustodyStatus.VIOLATION };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );
      mockUsersService.updateTrustScore.mockResolvedValue({});

      const result = await service.violationCustody('custody-1');
      expect(result.status).toBe(CustodyStatus.VIOLATION);
    });

    it('blocks RETURNED → VIOLATION (terminal state)', async () => {
      const custody = makeCustody(CustodyStatus.RETURNED);
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(custody) } }),
      );
      await expect(service.violationCustody('custody-1')).rejects.toThrow(BadRequestException);
    });

    it('blocks VIOLATION → VIOLATION (terminal state)', async () => {
      const custody = makeCustody(CustodyStatus.VIOLATION);
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(custody) } }),
      );
      await expect(service.violationCustody('custody-1')).rejects.toThrow(/terminal/i);
    });

    it('updates trust score by -15 on violation', async () => {
      const custody = makeCustody(CustodyStatus.ACTIVE);
      const updated = { ...custody, status: CustodyStatus.VIOLATION };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );
      mockUsersService.updateTrustScore.mockResolvedValue({});

      await service.violationCustody('custody-1');
      expect(mockUsersService.updateTrustScore).toHaveBeenCalledWith('holder-1', -15);
    });
  });

  describe('cancelCustody — state machine enforcement', () => {
    const makeCustody = (status: CustodyStatus) => ({
      id: 'custody-1', status, holderId: 'holder-1', petId: 'pet-1',
      escrowId: null, holder: {}, pet: {},
    });

    it('succeeds for PENDING → CANCELLED', async () => {
      const custody = makeCustody(CustodyStatus.PENDING);
      const updated = { ...custody, status: CustodyStatus.CANCELLED };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );

      const result = await service.cancelCustody('custody-1', 'actor-1');
      expect(result.status).toBe(CustodyStatus.CANCELLED);
    });

    it('succeeds for ACTIVE → CANCELLED', async () => {
      const custody = makeCustody(CustodyStatus.ACTIVE);
      const updated = { ...custody, status: CustodyStatus.CANCELLED };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );

      const result = await service.cancelCustody('custody-1', 'actor-1');
      expect(result.status).toBe(CustodyStatus.CANCELLED);
    });

    it('blocks RETURNED → CANCELLED (terminal state)', async () => {
      const custody = makeCustody(CustodyStatus.RETURNED);
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(custody) } }),
      );
      await expect(service.cancelCustody('custody-1', 'actor-1')).rejects.toThrow(
        /terminal/i,
      );
    });

    it('blocks CANCELLED → CANCELLED (terminal state)', async () => {
      const custody = makeCustody(CustodyStatus.CANCELLED);
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(custody) } }),
      );
      await expect(service.cancelCustody('custody-1', 'actor-1')).rejects.toThrow(
        /terminal/i,
      );
    });

    it('logs CUSTODY_CANCELLED event', async () => {
      const custody = makeCustody(CustodyStatus.ACTIVE);
      const updated = { ...custody, status: CustodyStatus.CANCELLED };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );

      await service.cancelCustody('custody-1', 'actor-1');
      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'CUSTODY_CANCELLED' }),
      );
    });
  });

  describe('activateCustody — state machine enforcement', () => {
    const makeCustody = (status: CustodyStatus) => ({
      id: 'custody-1', status, holderId: 'holder-1', petId: 'pet-1',
      escrowId: null, holder: {}, pet: {},
    });

    it('succeeds for PENDING → ACTIVE', async () => {
      const custody = makeCustody(CustodyStatus.PENDING);
      const updated = { ...custody, status: CustodyStatus.ACTIVE };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );

      const result = await service.activateCustody('custody-1', 'admin-1');
      expect(result.status).toBe(CustodyStatus.ACTIVE);
    });

    it('blocks ACTIVE → ACTIVE (self-transition not allowed)', async () => {
      const custody = makeCustody(CustodyStatus.ACTIVE);
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(custody) } }),
      );
      await expect(service.activateCustody('custody-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('blocks RETURNED → ACTIVE (terminal state)', async () => {
      const custody = makeCustody(CustodyStatus.RETURNED);
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(custody) } }),
      );
      await expect(service.activateCustody('custody-1', 'admin-1')).rejects.toThrow(
        /terminal/i,
      );
    });

    it('logs CUSTODY_ACTIVATED event', async () => {
      const custody = makeCustody(CustodyStatus.PENDING);
      const updated = { ...custody, status: CustodyStatus.ACTIVE };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );

      await service.activateCustody('custody-1', 'admin-1');
      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'CUSTODY_ACTIVATED' }),
      );
    });
  });

  describe('returnCustody — trust score', () => {
    it('updates trust score by +5 on return', async () => {
      const custody = {
        id: 'custody-1', status: CustodyStatus.ACTIVE,
        holderId: 'holder-1', petId: 'pet-1', escrowId: null, holder: {}, pet: {},
      };
      const updated = { ...custody, status: CustodyStatus.RETURNED };
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          custody: {
            findUnique: jest.fn().mockResolvedValue(custody),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      );
      mockUsersService.updateTrustScore.mockResolvedValue({});

      await service.returnCustody('custody-1');
      expect(mockUsersService.updateTrustScore).toHaveBeenCalledWith('holder-1', 5);
    });
  });

  describe('NotFoundException', () => {
    it('returnCustody throws NotFoundException when custody not found', async () => {
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(null) } }),
      );
      await expect(service.returnCustody('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('cancelCustody throws NotFoundException when custody not found', async () => {
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(null) } }),
      );
      await expect(service.cancelCustody('bad-id', 'actor')).rejects.toThrow(NotFoundException);
    });

    it('violationCustody throws NotFoundException when custody not found', async () => {
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({ custody: { findUnique: jest.fn().mockResolvedValue(null) } }),
      );
      await expect(service.violationCustody('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
