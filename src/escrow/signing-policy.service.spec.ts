import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  SigningPolicyService,
  EscrowAction,
} from './signing-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEntityType, EventType } from '@prisma/client';

describe('SigningPolicyService', () => {
  let service: SigningPolicyService;

  const mockPrismaService = {
    eventLog: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SigningPolicyService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SigningPolicyService>(SigningPolicyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPolicy', () => {
    it('should return the RELEASE policy', () => {
      const policy = service.getPolicy(EscrowAction.RELEASE);
      expect(policy.action).toBe(EscrowAction.RELEASE);
      expect(policy.requiredApprovalTypes).toContain(EventType.ESCROW_FUNDED);
      expect(policy.requiredApprovalTypes).toContain(
        EventType.ADOPTION_APPROVED,
      );
    });

    it('should return the REFUND policy', () => {
      const policy = service.getPolicy(EscrowAction.REFUND);
      expect(policy.action).toBe(EscrowAction.REFUND);
      expect(policy.requiredApprovalTypes).toContain(EventType.ESCROW_FUNDED);
      expect(policy.requiredApprovalTypes).toContain(
        EventType.ADOPTION_CANCELLED,
      );
    });
  });

  describe('authoriseAndSign', () => {
    const escrowId = 'escrow-123';
    const freshRecord = (id: string, eventType: EventType) => ({
      id,
      entityId: escrowId,
      entityType: EventEntityType.ESCROW,
      eventType,
      actorId: null,
      createdAt: new Date(),
      payload: {},
      metadata: null,
      txHash: null,
      blockHeight: null,
    });

    it('should refuse a release without the required approval records', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValueOnce([]);

      await expect(
        service.authoriseAndSign(escrowId, EscrowAction.RELEASE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should refuse a release missing ADOPTION_APPROVED', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValueOnce([
        freshRecord('log-1', EventType.ESCROW_FUNDED),
      ]);

      await expect(
        service.authoriseAndSign(escrowId, EscrowAction.RELEASE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should refuse a refund without the required approval records', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValueOnce([]);

      await expect(
        service.authoriseAndSign(escrowId, EscrowAction.REFUND),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should refuse when approval records are stale (older than 24 hours)', async () => {
      const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const staleRecord = (id: string, eventType: EventType) => ({
        ...freshRecord(id, eventType),
        createdAt: staleDate,
      });

      mockPrismaService.eventLog.findMany.mockResolvedValueOnce([
        staleRecord('log-1', EventType.ESCROW_FUNDED),
        staleRecord('log-2', EventType.ADOPTION_APPROVED),
      ]);

      await expect(
        service.authoriseAndSign(escrowId, EscrowAction.RELEASE),
      ).rejects.toThrow(BadRequestException);
    });

    it('should approve a release when all required approvals are present and fresh', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValueOnce([
        freshRecord('log-1', EventType.ESCROW_FUNDED),
        freshRecord('log-2', EventType.ADOPTION_APPROVED),
      ]);

      const result = await service.authoriseAndSign(
        escrowId,
        EscrowAction.RELEASE,
      );

      expect(result.approved).toBe(true);
      expect(result.action).toBe(EscrowAction.RELEASE);
      expect(result.approvalIds).toEqual(
        expect.arrayContaining(['log-1', 'log-2']),
      );
    });

    it('should approve a refund when all required approvals are present and fresh', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValueOnce([
        freshRecord('log-1', EventType.ESCROW_FUNDED),
        freshRecord('log-2', EventType.ADOPTION_CANCELLED),
      ]);

      const result = await service.authoriseAndSign(
        escrowId,
        EscrowAction.REFUND,
      );

      expect(result.approved).toBe(true);
      expect(result.action).toBe(EscrowAction.REFUND);
      expect(result.approvalIds).toEqual(
        expect.arrayContaining(['log-1', 'log-2']),
      );
    });

    it('should query event logs with the correct entity type and id', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValueOnce([
        freshRecord('log-1', EventType.ESCROW_FUNDED),
        freshRecord('log-2', EventType.ADOPTION_APPROVED),
      ]);

      await service.authoriseAndSign(escrowId, EscrowAction.RELEASE);

      expect(mockPrismaService.eventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityType: EventEntityType.ESCROW,
            entityId: escrowId,
          }),
        }),
      );
    });
  });

  describe('buildSigningMetadata', () => {
    it('should return metadata linking the transaction to its approval ids', () => {
      const authorisation = {
        approved: true,
        approvalIds: ['log-1', 'log-2'],
        action: EscrowAction.RELEASE,
      };

      const metadata = service.buildSigningMetadata(authorisation);

      expect(metadata.authorisedByApprovalIds).toEqual(['log-1', 'log-2']);
      expect(metadata.action).toBe(EscrowAction.RELEASE);
      expect(metadata.signedAt).toBeDefined();
    });
  });
});
