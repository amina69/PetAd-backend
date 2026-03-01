import { Test, TestingModule } from '@nestjs/testing';
import { CustodyService } from './custody.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowService } from '../escrow/escrow.service';
import { TrustScoreService } from '../users/trust-score.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CustodyStatus } from '@prisma/client';

describe('CustodyService - Return Flow', () => {
  let service: CustodyService;
  let prismaService: PrismaService;
  let eventsService: EventsService;
  let escrowService: EscrowService;
  let trustScoreService: TrustScoreService;

  const mockCustody = {
    id: 'custody-1',
    status: CustodyStatus.ACTIVE,
    petId: 'pet-1',
    holderId: 'user-1',
    escrowId: 'escrow-1',
    depositAmount: 100,
    startDate: new Date(),
    endDate: new Date(),
    pet: { id: 'pet-1', name: 'Buddy' },
    holder: { id: 'user-1', email: 'user@test.com' },
    escrow: { id: 'escrow-1', amount: 100 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustodyService,
        {
          provide: PrismaService,
          useValue: {
            custody: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: EventsService,
          useValue: {
            logEvent: jest.fn(),
          },
        },
        {
          provide: EscrowService,
          useValue: {
            releaseEscrow: jest.fn(),
            refundEscrow: jest.fn(),
          },
        },
        {
          provide: TrustScoreService,
          useValue: {
            rewardSuccessfulCustody: jest.fn(),
            penalizeViolation: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CustodyService>(CustodyService);
    prismaService = module.get<PrismaService>(PrismaService);
    eventsService = module.get<EventsService>(EventsService);
    escrowService = module.get<EscrowService>(EscrowService);
    trustScoreService = module.get<TrustScoreService>(TrustScoreService);
  });

  describe('returnCustody', () => {
    it('should successfully return custody and release escrow', async () => {
      const updatedCustody = { ...mockCustody, status: CustodyStatus.RETURNED };

      jest.spyOn(prismaService.custody, 'findUnique').mockResolvedValue(mockCustody as any);
      jest.spyOn(prismaService, '$transaction').mockImplementation(async (callback: any) => {
        return callback({
          custody: {
            update: jest.fn().mockResolvedValue(updatedCustody),
          },
        });
      });

      const result = await service.returnCustody('custody-1', 'user-1');

      expect(result.status).toBe(CustodyStatus.RETURNED);
      expect(escrowService.releaseEscrow).toHaveBeenCalledWith('escrow-1', expect.anything());
      expect(trustScoreService.rewardSuccessfulCustody).toHaveBeenCalledWith('user-1', 'custody-1');
      expect(eventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'CUSTODY_RETURNED',
          entityId: 'custody-1',
        }),
      );
    });

    it('should throw NotFoundException if custody not found', async () => {
      jest.spyOn(prismaService.custody, 'findUnique').mockResolvedValue(null);

      await expect(service.returnCustody('custody-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if custody is not ACTIVE', async () => {
      const inactiveCustody = { ...mockCustody, status: CustodyStatus.RETURNED };
      jest.spyOn(prismaService.custody, 'findUnique').mockResolvedValue(inactiveCustody as any);

      await expect(service.returnCustody('custody-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user is not the holder', async () => {
      jest.spyOn(prismaService.custody, 'findUnique').mockResolvedValue(mockCustody as any);

      await expect(service.returnCustody('custody-1', 'wrong-user')).rejects.toThrow(BadRequestException);
    });
  });

  describe('violationCustody', () => {
    it('should mark custody as violation and refund escrow', async () => {
      const violatedCustody = { ...mockCustody, status: CustodyStatus.VIOLATION };

      jest.spyOn(prismaService.custody, 'findUnique').mockResolvedValue(mockCustody as any);
      jest.spyOn(prismaService, '$transaction').mockImplementation(async (callback: any) => {
        return callback({
          custody: {
            update: jest.fn().mockResolvedValue(violatedCustody),
          },
        });
      });

      const result = await service.violationCustody('custody-1', 'admin-1', 'Pet neglected');

      expect(result.status).toBe(CustodyStatus.VIOLATION);
      expect(escrowService.refundEscrow).toHaveBeenCalledWith('escrow-1', expect.anything());
      expect(trustScoreService.penalizeViolation).toHaveBeenCalledWith('user-1', 'custody-1');
      expect(eventsService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'CUSTODY_RETURNED',
          payload: expect.objectContaining({
            violation: true,
          }),
        }),
      );
    });

    it('should throw NotFoundException if custody not found', async () => {
      jest.spyOn(prismaService.custody, 'findUnique').mockResolvedValue(null);

      await expect(service.violationCustody('custody-1', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if custody is not ACTIVE', async () => {
      const inactiveCustody = { ...mockCustody, status: CustodyStatus.VIOLATION };
      jest.spyOn(prismaService.custody, 'findUnique').mockResolvedValue(inactiveCustody as any);

      await expect(service.violationCustody('custody-1', 'admin-1')).rejects.toThrow(BadRequestException);
    });
  });
});
