import { Test, TestingModule } from '@nestjs/testing';
import { EscrowService } from './escrow.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotFoundException } from '@nestjs/common';
import { AdoptionStateMachine } from '../adoption/services/adoption-state-machine.service';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';
import { PetStatus } from '../common/enums/pet-status.enum';
import {
  EscrowStatus,
  AdoptionStatus,
  EventType,
  EventEntityType,
} from '@prisma/client';
import { FeeCalculationService } from '../payments/fees/fee-calculation.service';
import { FeeScheduleService } from '../payments/fees/fee-schedule.service';
import { PaymentLedgerService } from '../payments/ledger/payment-ledger.service';

type MockMethod = jest.Mock<Promise<unknown>, unknown[]>;

interface MockPrisma {
  escrow: { create: MockMethod; findUnique: MockMethod; update: MockMethod };
  adoption: { update: MockMethod };
  pet: { update: MockMethod };
  $transaction: jest.Mock<
    Promise<unknown>,
    [(tx: MockPrisma) => Promise<unknown>]
  >;
}

describe('EscrowService', () => {
  let service: EscrowService;

  const mockPrismaService: MockPrisma = {
    escrow: {
      create: jest.fn<Promise<unknown>, unknown[]>(),
      findUnique: jest.fn<Promise<unknown>, unknown[]>(),
      update: jest.fn<Promise<unknown>, unknown[]>(),
    },
    adoption: {
      update: jest.fn<Promise<unknown>, unknown[]>(),
    },
    pet: {
      update: jest.fn<Promise<unknown>, unknown[]>(),
    },
    $transaction: jest.fn(
      async (callback: (tx: MockPrisma) => Promise<unknown>) =>
        callback(mockPrismaService),
    ),
  };

  const mockEventsService = {
    logEvent: jest.fn(),
  };

  const mockAdoptionStateMachine = {
    assertValidTransition: jest.fn(),
    canTransition: jest.fn(),
  };

  const mockPetAvailabilityService = {
    transition: jest.fn().mockResolvedValue(PetStatus.ADOPTED),
  };

  const mockFeeCalculation = {
    resolveForAgreement: jest.fn().mockResolvedValue({
      id: 'schedule-1',
      version: 1,
    }),
    calculate: jest.fn().mockReturnValue({
      total: 5,
      currency: 'XLM',
      platformFee: 5,
      scheduleVersion: 1,
    }),
  };

  const mockFeeSchedules = {
    findEffective: jest.fn().mockResolvedValue({ id: 'schedule-1' }),
  };

  const mockLedger = {
    recordFee: jest.fn(),
    recordRefund: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFeeCalculation.resolveForAgreement.mockResolvedValue({
      id: 'schedule-1',
      version: 1,
    });
    mockFeeCalculation.calculate.mockReturnValue({
      total: 5,
      currency: 'XLM',
      platformFee: 5,
      scheduleVersion: 1,
    });
    mockFeeSchedules.findEffective.mockResolvedValue({ id: 'schedule-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: AdoptionStateMachine, useValue: mockAdoptionStateMachine },
        {
          provide: PetAvailabilityService,
          useValue: mockPetAvailabilityService,
        },
        { provide: FeeCalculationService, useValue: mockFeeCalculation },
        { provide: FeeScheduleService, useValue: mockFeeSchedules },
        { provide: PaymentLedgerService, useValue: mockLedger },
      ],
    }).compile();

    service = module.get<EscrowService>(EscrowService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('releaseEscrow', () => {
    const escrowId = 'escrow-123';
    const txHash = 'tx-hash-abc';

    it('should throw NotFoundException if escrow does not exist', async () => {
      mockPrismaService.escrow.findUnique.mockResolvedValueOnce(null);

      await expect(service.releaseEscrow(escrowId, txHash)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should release escrow and not update adoption if no adoption is attached', async () => {
      const mockEscrow = {
        id: escrowId,
        amount: 100,
        status: EscrowStatus.CREATED,
      };

      mockPrismaService.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
      mockPrismaService.escrow.update.mockResolvedValueOnce({
        ...mockEscrow,
        status: EscrowStatus.RELEASED,
      });

      const result = await service.releaseEscrow(escrowId, txHash);

      expect(mockPrismaService.escrow.update).toHaveBeenCalledWith({
        where: { id: escrowId },
        data: { status: EscrowStatus.RELEASED, releaseTxHash: txHash },
      });

      expect(mockEventsService.logEvent).toHaveBeenCalledWith({
        entityType: EventEntityType.ESCROW,
        entityId: escrowId,
        eventType: EventType.ESCROW_RELEASED,
        txHash,
        payload: { amount: 100 },
      });

      expect(mockPrismaService.adoption.update).not.toHaveBeenCalled();
      expect(mockLedger.recordFee).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5,
          currency: 'XLM',
          escrowId,
        }),
        mockPrismaService,
      );
      expect(result.status).toBe(EscrowStatus.RELEASED);
    });

    it('should release escrow and update adoption and pet if adoption is attached', async () => {
      const mockAdoption = {
        id: 'adoption-123',
        petId: 'pet-123',
        adopterId: 'adopter-123',
        status: AdoptionStatus.ESCROW_FUNDED,
      };

      const mockEscrow = {
        id: escrowId,
        amount: 100,
        status: EscrowStatus.CREATED,
        adoption: mockAdoption,
      };

      mockPrismaService.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
      mockPrismaService.escrow.update.mockResolvedValueOnce({
        ...mockEscrow,
        status: EscrowStatus.RELEASED,
      });

      const result = await service.releaseEscrow(escrowId, txHash);

      expect(
        mockAdoptionStateMachine.assertValidTransition,
      ).toHaveBeenCalledWith(
        AdoptionStatus.ESCROW_FUNDED,
        AdoptionStatus.COMPLETED,
      );

      expect(mockPetAvailabilityService.transition).toHaveBeenCalledWith(
        mockAdoption.petId,
        PetStatus.ADOPTED,
        mockPrismaService,
      );

      expect(mockPrismaService.adoption.update).toHaveBeenCalledWith({
        where: { id: mockAdoption.id },
        data: { status: AdoptionStatus.COMPLETED },
      });

      expect(mockPrismaService.pet.update).toHaveBeenCalledWith({
        where: { id: mockAdoption.petId },
        data: { currentOwnerId: mockAdoption.adopterId },
      });

      expect(mockEventsService.logEvent).toHaveBeenCalledWith({
        entityType: EventEntityType.ADOPTION,
        entityId: mockAdoption.id,
        eventType: EventType.ADOPTION_COMPLETED,
        payload: { escrowId, petId: mockAdoption.petId },
      });

      expect(result.status).toBe(EscrowStatus.RELEASED);
    });
  });
});
