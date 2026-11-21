import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentPurpose, PaymentStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { ReceiptsService } from './receipts.service';
import * as receiptPdfModule from './receipt-pdf';
import type { ReceiptPdfData } from './receipt-pdf';

const BASE_DATE = new Date('2026-03-01T10:00:00.000Z');
const PDF = Buffer.from('%PDF-1.7 fake receipt');

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    paymentId: 'payment-1',
    receiptNumber: 1n,
    verificationCode: 'ABCDEF0123456789',
    filePath: '/tmp/receipts/payment-1.pdf',
    contentHash: createHash('sha256').update(PDF).digest('hex'),
    issuedAt: BASE_DATE,
    ...overrides,
  };
}

function makeDetailedPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    userId: 'user-1',
    purpose: PaymentPurpose.DEPOSIT,
    status: PaymentStatus.PAID,
    amountMinor: 10000n,
    currency: 'XLM',
    feeRateBps: 250,
    feeMinor: 250n,
    refundedAmountMinor: 0n,
    settlementRefundMinor: 9750n,
    settlementPenaltyMinor: 0n,
    settlementFeeMinor: 250n,
    settledAt: BASE_DATE,
    escrowId: null,
    custodyId: 'custody-1',
    adoptionId: 'adoption-1',
    externalRef: 'fake_ch_1',
    txHash: 'fake_stellar_1',
    paidAt: BASE_DATE,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    user: {
      email: 'ada@example.com',
      firstName: null,
      lastName: null,
    },
    adoption: {
      owner: {
        email: 'owner@example.com',
        firstName: 'Grace',
        lastName: 'Hopper',
      },
      adopter: {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    },
    custody: {
      holder: { email: 'holder@example.com', firstName: null, lastName: null },
      pet: {
        currentOwner: {
          email: 'owner@example.com',
          firstName: 'Grace',
          lastName: 'Hopper',
        },
      },
    },
    lines: [
      {
        id: 'line-1',
        paymentId: 'payment-1',
        account: 'USER_WALLET',
        direction: 'DEBIT',
        type: 'PRINCIPAL',
        amountMinor: 10000n,
        currency: 'XLM',
        description: 'Deposit paid by user',
        createdAt: BASE_DATE,
      },
    ],
    ...overrides,
  };
}

describe('ReceiptsService', () => {
  let service: ReceiptsService;
  let prisma: {
    payment: { findUnique: jest.Mock };
    receipt: {
      findUnique: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
    };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let storage: { write: jest.Mock; read: jest.Mock };
  let signing: { sign: jest.Mock; verify: jest.Mock };
  let renderSpy: jest.SpyInstance;

  const config = {
    get: <T>(key: string, fallback?: T): T | undefined => {
      switch (key) {
        case 'apiPrefix':
          return 'api/v1' as unknown as T;
        case 'payments.receiptSigningSecret':
          return 'test-secret-at-least-32-characters-long' as unknown as T;
        default:
          return fallback;
      }
    },
  };

  beforeEach(() => {
    prisma = {
      payment: { findUnique: jest.fn() },
      receipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _max: { receiptNumber: null } }),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => Promise.resolve(callback(prisma)),
    );

    storage = {
      write: jest.fn().mockResolvedValue('/tmp/receipts/payment-1.pdf'),
      read: jest.fn().mockResolvedValue(PDF),
    };
    signing = {
      sign: jest.fn().mockReturnValue({
        token: 'signed-token',
        expiresAt: new Date(Date.now() + 300_000),
      }),
      verify: jest.fn(),
    };

    renderSpy = jest
      .spyOn(receiptPdfModule, 'renderReceiptPdf')
      .mockResolvedValue(PDF);

    service = new ReceiptsService(
      prisma as never,
      config as never,
      storage as never,
      signing as never,
    );
  });

  afterEach(() => {
    renderSpy.mockRestore();
  });

  // ─── getReceiptLink ────────────────────────────────────────────────────

  describe('getReceiptLink', () => {
    it('hides payments the actor does not own', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.getReceiptLink({ userId: 'user-1', role: 'USER' }, 'payment-1'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.payment.findUnique.mockResolvedValueOnce({
        id: 'payment-1',
        userId: 'other-user',
        status: PaymentStatus.PAID,
      });
      await expect(
        service.getReceiptLink({ userId: 'user-1', role: 'USER' }, 'payment-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows an admin to fetch a receipt for any payment', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({
        id: 'payment-1',
        userId: 'other-user',
        status: PaymentStatus.PAID,
      });
      prisma.receipt.findUnique.mockResolvedValueOnce(makeReceipt());

      const view = await service.getReceiptLink(
        { userId: 'admin-1', role: 'ADMIN' },
        'payment-1',
      );

      expect(view.url).toBe('/api/v1/payments/receipts/download/signed-token');
      expect(view.receiptNumber).toBe('1');
    });

    it('rejects unpaid payments', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        userId: 'user-1',
        status: PaymentStatus.PENDING,
      });

      await expect(
        service.getReceiptLink({ userId: 'user-1', role: 'USER' }, 'payment-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates the receipt on first access and signs its number', async () => {
      prisma.payment.findUnique.mockResolvedValue(makeDetailedPayment());
      prisma.receipt.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...data, id: 'receipt-1', issuedAt: BASE_DATE }),
      );

      const view = await service.getReceiptLink(
        { userId: 'user-1', role: 'USER' },
        'payment-1',
      );

      expect(prisma.receipt.aggregate).toHaveBeenCalled();
      expect(storage.write).toHaveBeenCalledWith('payment-1', PDF);
      const createArg = (
        prisma.receipt.create.mock.calls as unknown[][]
      )[0][0] as {
        data: {
          paymentId: string;
          receiptNumber: bigint;
          contentHash: string;
        };
      };
      expect(createArg.data.paymentId).toBe('payment-1');
      expect(createArg.data.receiptNumber).toBe(1n);
      expect(createArg.data.contentHash).toBe(
        createHash('sha256').update(PDF).digest('hex'),
      );
      expect(signing.sign).toHaveBeenCalledWith('payment-1', 1n);
      expect(view.expiresAt).toBeDefined();
    });

    it('allocates the next sequential number from the current maximum', async () => {
      prisma.payment.findUnique.mockResolvedValue(makeDetailedPayment());
      prisma.receipt.aggregate.mockResolvedValue({
        _max: { receiptNumber: 41n },
      });
      prisma.receipt.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...data, id: 'receipt-42', issuedAt: BASE_DATE }),
      );

      await service.getReceiptLink(
        { userId: 'user-1', role: 'USER' },
        'payment-1',
      );

      const createArg = (
        prisma.receipt.create.mock.calls as unknown[][]
      )[0][0] as {
        data: { receiptNumber: bigint };
      };
      expect(createArg.data.receiptNumber).toBe(42n);
      expect(signing.sign).toHaveBeenCalledWith('payment-1', 42n);
    });

    it('reuses a receipt created by a concurrent request', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        userId: 'user-1',
        status: PaymentStatus.PAID,
      });
      const raced = makeReceipt({ receiptNumber: 9n });
      // Fast-path miss, then the in-transaction recheck finds the winner.
      prisma.receipt.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(raced);

      const view = await service.getReceiptLink(
        { userId: 'user-1', role: 'USER' },
        'payment-1',
      );

      expect(view.receiptNumber).toBe('9');
      expect(prisma.receipt.create).not.toHaveBeenCalled();
      expect(storage.write).not.toHaveBeenCalled();
    });

    it('builds parties and falls back to email when names are missing', async () => {
      prisma.payment.findUnique.mockResolvedValue(makeDetailedPayment());
      prisma.receipt.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...data, id: 'receipt-1', issuedAt: BASE_DATE }),
      );

      await service.getReceiptLink(
        { userId: 'user-1', role: 'USER' },
        'payment-1',
      );

      const pdfData = (
        renderSpy.mock.calls as unknown[][]
      )[0][0] as ReceiptPdfData;
      expect(pdfData.payer).toBe('ada@example.com');
      expect(pdfData.parties).toEqual([
        { role: 'Adoption owner', displayName: 'Grace Hopper' },
        { role: 'Adopter', displayName: 'Ada Lovelace' },
        { role: 'Custodian', displayName: 'holder@example.com' },
        { role: 'Pet owner', displayName: 'Grace Hopper' },
      ]);
      expect(pdfData.verificationCode).toMatch(/^[0-9A-F]{16}$/);
    });

    it('fails if the signing secret is not configured', async () => {
      const unconfigured = new ReceiptsService(
        prisma as never,
        { get: () => undefined } as never,
        storage as never,
        signing as never,
      );
      prisma.payment.findUnique.mockResolvedValue({
        id: 'payment-1',
        userId: 'user-1',
        status: PaymentStatus.PAID,
      });
      prisma.receipt.findUnique.mockResolvedValueOnce(makeReceipt());
      signing.sign.mockReturnValueOnce({
        token: 'token',
        expiresAt: new Date(),
      });

      // getReceiptLink itself only needs signing + apiPrefix, so it works.
      await expect(
        unconfigured.getReceiptLink(
          { userId: 'user-1', role: 'USER' },
          'payment-1',
        ),
      ).resolves.toBeDefined();

      // Creating a new receipt needs the secret for the verification code.
      prisma.receipt.findUnique.mockResolvedValue(null);
      await expect(
        unconfigured.getReceiptLink(
          { userId: 'user-1', role: 'USER' },
          'payment-1',
        ),
      ).rejects.toThrow(/secret is not configured/);
    });

    it('rejects when the payment vanishes inside the transaction', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.getReceiptLink({ userId: 'user-1', role: 'USER' }, 'payment-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── download ──────────────────────────────────────────────────────────

  describe('download', () => {
    it('rejects a token that no longer matches a receipt', async () => {
      signing.verify.mockReturnValue({
        paymentId: 'payment-1',
        receiptNumber: 1n,
        expiresAt: new Date(),
      });
      prisma.receipt.findUnique.mockResolvedValueOnce(null);

      await expect(service.download('token')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.receipt.findUnique.mockResolvedValueOnce(
        makeReceipt({ receiptNumber: 2n }),
      );
      await expect(service.download('token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('streams the stored PDF with a padded filename', async () => {
      signing.verify.mockReturnValue({
        paymentId: 'payment-1',
        receiptNumber: 42n,
        expiresAt: new Date(),
      });
      prisma.receipt.findUnique.mockResolvedValue(
        makeReceipt({ receiptNumber: 42n }),
      );

      const download = await service.download('token');

      expect(download.buffer.equals(PDF)).toBe(true);
      expect(download.fileName).toBe('petad-receipt-00000042.pdf');
      expect(storage.read).toHaveBeenCalledWith('/tmp/receipts/payment-1.pdf');
    });

    it('detects a corrupted stored file', async () => {
      signing.verify.mockReturnValue({
        paymentId: 'payment-1',
        receiptNumber: 1n,
        expiresAt: new Date(),
      });
      prisma.receipt.findUnique.mockResolvedValue(makeReceipt());
      storage.read.mockResolvedValue(Buffer.from('%PDF-1.7 tampered'));

      await expect(service.download('token')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });
});
