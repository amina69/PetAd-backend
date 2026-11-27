import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { EscrowStatus, CustodyStatus } from '@prisma/client';

const mockEvents = { logEvent: jest.fn() };

const mockPrisma = {
  $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  adoption: { findUnique: jest.fn() },
  custody: { findUnique: jest.fn() },
  escrow: { update: jest.fn() },
};

describe('SettlementService', () => {
  let service: SettlementService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
      ],
    }).compile();
    service = module.get<SettlementService>(SettlementService);
  });

  // ── settleAdoptionEscrow ────────────────────────────────

  describe('settleAdoptionEscrow()', () => {
    const funded = {
      id: 'adopt-1',
      escrow: { id: 'escrow-1', status: EscrowStatus.FUNDED, amount: '100.00' },
    };

    it('releases escrow and returns split amounts', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue(funded);
      mockPrisma.escrow.update.mockResolvedValue({});

      const result = await service.settleAdoptionEscrow('adopt-1', 100);
      expect(result.releasedAmount).toBe(100);
      expect(result.platformFee).toBeCloseTo(1);
      expect(result.ownerAmount).toBeCloseTo(99);
      expect(mockPrisma.escrow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: EscrowStatus.RELEASED },
        }),
      );
      expect(mockEvents.logEvent).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when adoption missing', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue(null);
      await expect(service.settleAdoptionEscrow('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when no escrow on adoption', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue({
        id: 'adopt-2',
        escrow: null,
      });
      await expect(service.settleAdoptionEscrow('adopt-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks settlement when escrow is DISPUTED', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue({
        id: 'adopt-3',
        escrow: { id: 'e3', status: EscrowStatus.DISPUTED, amount: '50.00' },
      });
      await expect(service.settleAdoptionEscrow('adopt-3')).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.escrow.update).not.toHaveBeenCalled();
    });

    it('blocks settlement when escrow is not FUNDED', async () => {
      mockPrisma.adoption.findUnique.mockResolvedValue({
        id: 'adopt-4',
        escrow: { id: 'e4', status: EscrowStatus.RELEASED, amount: '50.00' },
      });
      await expect(service.settleAdoptionEscrow('adopt-4')).rejects.toThrow(
        ConflictException,
      );
    });

    it('property: fee + ownerAmount === deposit for random inputs', async () => {
      for (const amount of [10, 50.5, 999.99, 0.01]) {
        mockPrisma.adoption.findUnique.mockResolvedValue({
          id: 'adopt-p',
          escrow: {
            id: 'ep',
            status: EscrowStatus.FUNDED,
            amount: amount.toString(),
          },
        });
        mockPrisma.escrow.update.mockResolvedValue({});
        const r = await service.settleAdoptionEscrow('adopt-p', 250);
        expect(r.platformFee + r.ownerAmount).toBeCloseTo(r.releasedAmount, 8);
      }
    });
  });

  // ── settleCustodyDeposit ────────────────────────────────

  describe('settleCustodyDeposit()', () => {
    const makeCustody = (status: CustodyStatus, amount = '200.00') => ({
      id: 'cust-1',
      status,
      depositAmount: amount,
      escrow: { id: 'escrow-c', status: EscrowStatus.FUNDED, amount },
    });

    it('full refund on normal return', async () => {
      mockPrisma.custody.findUnique.mockResolvedValue(
        makeCustody(CustodyStatus.RETURNED),
      );
      mockPrisma.escrow.update.mockResolvedValue({});

      const r = await service.settleCustodyDeposit('cust-1', 2000, false);
      expect(r.outcome).toBe('NORMAL_RETURN');
      expect(r.refundAmount).toBe(200);
      expect(r.penaltyAmount).toBe(0);
    });

    it('deducts late penalty on late return', async () => {
      mockPrisma.custody.findUnique.mockResolvedValue(
        makeCustody(CustodyStatus.RETURNED),
      );
      mockPrisma.escrow.update.mockResolvedValue({});

      const r = await service.settleCustodyDeposit('cust-1', 2000, true);
      expect(r.outcome).toBe('LATE_RETURN');
      // 20% of 200 = 40 penalty
      expect(r.penaltyAmount).toBeCloseTo(40);
      expect(r.refundAmount).toBeCloseTo(160);
      // Conservation: refund + penalty = deposit
      expect(r.refundAmount + r.penaltyAmount).toBeCloseTo(200, 8);
    });

    it('holds funds (DISPUTED) on VIOLATION status', async () => {
      mockPrisma.custody.findUnique.mockResolvedValue(
        makeCustody(CustodyStatus.VIOLATION),
      );
      mockPrisma.escrow.update.mockResolvedValue({});

      const r = await service.settleCustodyDeposit('cust-1');
      expect(r.outcome).toBe('HELD');
      expect(r.refundAmount).toBe(0);
      expect(mockPrisma.escrow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: EscrowStatus.DISPUTED },
        }),
      );
    });

    it('holds funds (DISPUTED) on CANCELLED status', async () => {
      mockPrisma.custody.findUnique.mockResolvedValue(
        makeCustody(CustodyStatus.CANCELLED),
      );
      mockPrisma.escrow.update.mockResolvedValue({});

      const r = await service.settleCustodyDeposit('cust-1');
      expect(r.outcome).toBe('HELD');
    });

    it('property: refund + penalty = deposit for random inputs', async () => {
      for (const amount of [100, 50.5, 999.99, 1]) {
        mockPrisma.custody.findUnique.mockResolvedValue(
          makeCustody(CustodyStatus.RETURNED, amount.toString()),
        );
        mockPrisma.escrow.update.mockResolvedValue({});
        const r = await service.settleCustodyDeposit('cust-1', 2000, true);
        expect(r.refundAmount + r.penaltyAmount).toBeCloseTo(amount, 8);
      }
    });

    it('throws NotFoundException when custody missing', async () => {
      mockPrisma.custody.findUnique.mockResolvedValue(null);
      await expect(service.settleCustodyDeposit('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when no escrow on custody', async () => {
      mockPrisma.custody.findUnique.mockResolvedValue({
        id: 'cust-2',
        status: CustodyStatus.RETURNED,
        depositAmount: '100.00',
        escrow: null,
      });
      await expect(service.settleCustodyDeposit('cust-2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
