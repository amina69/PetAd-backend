import { Test, TestingModule } from '@nestjs/testing';
import { EscrowService } from './escrow.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdoptionStateMachine } from '../adoption/services/adoption-state-machine.service';
import { PetAvailabilityService } from '../pets/services/pet-availability.service';
import { PetStatus } from '../common/enums/pet-status.enum';
import {
  SigningPolicyService,
  EscrowAction,
  SigningAuthorisation,
} from './signing-policy.service';
import {
  EscrowStatus,
  AdoptionStatus,
  EventType,
  EventEntityType,
} from '@prisma/client';

describe('EscrowService', () => {
  let service: EscrowService;
  let prismaService: PrismaService;
  let eventsService: EventsService;

  const mockPrismaService = {
    escrow: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    adoption: {
      update: jest.fn(),
    },
    pet: {
      update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
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

  const releaseAuthorisation: SigningAuthorisation = {
    approved: true,
    approvalIds: ['approval-1', 'approval-2'],
    action: EscrowAction.RELEASE,
  };

  const refundAuthorisation: SigningAuthorisation = {
    approved: true,
    approvalIds: ['approval-3', 'approval-4'],
    action: EscrowAction.REFUND,
  };

  const mockSigningPolicyService = {
    authoriseAndSign: jest.fn(),
    buildSigningMetadata: jest.fn().mockReturnValue({
      action: EscrowAction.RELEASE,
      authorisedByApprovalIds: ['approval-1', 'approval-2'],
      signedAt: new Date().toISOString(),
      policy: 'mock policy',
    }),
    getPolicy: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
        {
          provide: SigningPolicyService,
          useValue: mockSigningPolicyService,
        },
      ],
    }).compile();

    service = module.get<EscrowService>(EscrowService);
    prismaService = module.get<PrismaService>(PrismaService);
    eventsService = module.get<EventsService>(EventsService);
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

    it('should refuse a release without the required approval record', async () => {
      mockSigningPolicyService.authoriseAndSign.mockRejectedValueOnce(
        new ForbiddenException('missing approval records'),
      );

      await expect(service.releaseEscrow(escrowId, txHash)).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockSigningPolicyService.authoriseAndSign).toHaveBeenCalledWith(
        escrowId,
        EscrowAction.RELEASE,
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if escrow does not exist after approval check', async () => {
      mockSigningPolicyService.authoriseAndSign.mockResolvedValueOnce(
        releaseAuthorisation,
      );
      mockPrismaService.escrow.findUnique.mockResolvedValueOnce(null);

      await expect(service.releaseEscrow(escrowId, txHash)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should release escrow and not update adoption if no adoption is attached', async () => {
      mockSigningPolicyService.authoriseAndSign.mockResolvedValueOnce(
        releaseAuthorisation,
      );

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

      expect(mockSigningPolicyService.authoriseAndSign).toHaveBeenCalledWith(
        escrowId,
        EscrowAction.RELEASE,
      );

      expect(mockPrismaService.escrow.update).toHaveBeenCalledWith({
        where: { id: escrowId },
        data: { status: EscrowStatus.RELEASED, releaseTxHash: txHash },
      });

      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.ESCROW,
          entityId: escrowId,
          eventType: EventType.ESCROW_RELEASED,
          txHash,
          payload: expect.objectContaining({
            amount: 100,
            authorisedByApprovalIds: releaseAuthorisation.approvalIds,
          }),
        }),
      );

      expect(mockPrismaService.adoption.update).not.toHaveBeenCalled();
      expect(result.status).toBe(EscrowStatus.RELEASED);
    });

    it('should release escrow and update adoption and pet if adoption is attached', async () => {
      mockSigningPolicyService.authoriseAndSign.mockResolvedValueOnce(
        releaseAuthorisation,
      );
      mockSigningPolicyService.buildSigningMetadata.mockReturnValueOnce({
        action: EscrowAction.RELEASE,
        authorisedByApprovalIds: releaseAuthorisation.approvalIds,
        signedAt: new Date().toISOString(),
        policy: 'mock policy',
      });

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

      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.ADOPTION,
          entityId: mockAdoption.id,
          eventType: EventType.ADOPTION_COMPLETED,
          payload: expect.objectContaining({
            escrowId,
            petId: mockAdoption.petId,
            authorisedByApprovalIds: releaseAuthorisation.approvalIds,
          }),
        }),
      );

      expect(result.status).toBe(EscrowStatus.RELEASED);
    });

    it('every submitted transaction links to the approval ids that authorised it', async () => {
      mockSigningPolicyService.authoriseAndSign.mockResolvedValueOnce(
        releaseAuthorisation,
      );
      mockSigningPolicyService.buildSigningMetadata.mockReturnValueOnce({
        action: EscrowAction.RELEASE,
        authorisedByApprovalIds: releaseAuthorisation.approvalIds,
        signedAt: new Date().toISOString(),
        policy: 'mock policy',
      });

      const mockEscrow = {
        id: escrowId,
        amount: 200,
        status: EscrowStatus.CREATED,
      };
      mockPrismaService.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
      mockPrismaService.escrow.update.mockResolvedValueOnce({
        ...mockEscrow,
        status: EscrowStatus.RELEASED,
      });

      await service.releaseEscrow(escrowId, txHash);

      const escrowEventCall = mockEventsService.logEvent.mock.calls.find(
        (call) => call[0].eventType === EventType.ESCROW_RELEASED,
      );
      expect(escrowEventCall).toBeDefined();
      expect(
        escrowEventCall[0].payload.authorisedByApprovalIds,
      ).toEqual(releaseAuthorisation.approvalIds);
    });
  });

  describe('refundEscrow', () => {
    const escrowId = 'escrow-456';
    const txHash = 'tx-hash-refund';

    it('should refuse a refund without the required approval record', async () => {
      mockSigningPolicyService.authoriseAndSign.mockRejectedValueOnce(
        new ForbiddenException('missing approval records'),
      );

      await expect(service.refundEscrow(escrowId, txHash)).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockSigningPolicyService.authoriseAndSign).toHaveBeenCalledWith(
        escrowId,
        EscrowAction.REFUND,
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if escrow does not exist after approval check', async () => {
      mockSigningPolicyService.authoriseAndSign.mockResolvedValueOnce(
        refundAuthorisation,
      );
      mockPrismaService.escrow.findUnique.mockResolvedValueOnce(null);

      await expect(service.refundEscrow(escrowId, txHash)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should refund escrow and log the approval ids', async () => {
      mockSigningPolicyService.authoriseAndSign.mockResolvedValueOnce(
        refundAuthorisation,
      );
      mockSigningPolicyService.buildSigningMetadata.mockReturnValueOnce({
        action: EscrowAction.REFUND,
        authorisedByApprovalIds: refundAuthorisation.approvalIds,
        signedAt: new Date().toISOString(),
        policy: 'mock policy',
      });

      const mockEscrow = {
        id: escrowId,
        amount: 150,
        status: EscrowStatus.CREATED,
      };
      mockPrismaService.escrow.findUnique.mockResolvedValueOnce(mockEscrow);
      mockPrismaService.escrow.update.mockResolvedValueOnce({
        ...mockEscrow,
        status: EscrowStatus.REFUNDED,
      });

      const result = await service.refundEscrow(escrowId, txHash);

      expect(mockPrismaService.escrow.update).toHaveBeenCalledWith({
        where: { id: escrowId },
        data: { status: EscrowStatus.REFUNDED, refundTxHash: txHash },
      });

      expect(mockEventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: EventEntityType.ESCROW,
          entityId: escrowId,
          eventType: EventType.ESCROW_REFUNDED,
          txHash,
          payload: expect.objectContaining({
            amount: 150,
            authorisedByApprovalIds: refundAuthorisation.approvalIds,
          }),
        }),
      );

      expect(result.status).toBe(EscrowStatus.REFUNDED);
    });
  });
});
