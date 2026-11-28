import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  EscrowStatus,
  PaymentLineDirection,
  PaymentLineType,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
} from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PaymentProvider } from './provider/payment-provider.interface';

const BASE_DATE = new Date('2026-03-01T10:00:00.000Z');

type LedgerRow = { direction: PaymentLineDirection; amountMinor: bigint };

function callArg<T>(mock: jest.Mock, index = 0): T {
  const calls = mock.mock.calls as unknown[][];
  return calls[index][0] as T;
}

function makeQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1',
    userId: 'user-1',
    purpose: PaymentPurpose.DEPOSIT,
    currency: 'XLM',
    amountMinor: 10000n,
    feeRateBps: 250,
    feeMinor: 250n,
    totalMinor: 10000n,
    escrowId: null,
    custodyId: null,
    adoptionId: null,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    createdAt: BASE_DATE,
    ...overrides,
  };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    userId: 'user-1',
    purpose: PaymentPurpose.DEPOSIT,
    status: PaymentStatus.PENDING,
    amountMinor: 10000n,
    currency: 'XLM',
    feeRateBps: 250,
    feeMinor: 250n,
    refundedAmountMinor: 0n,
    settlementRefundMinor: null,
    settlementPenaltyMinor: null,
    settlementFeeMinor: null,
    settledAt: null,
    escrowId: null,
    custodyId: null,
    adoptionId: null,
    externalRef: null,
    txHash: null,
    paidAt: null,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    lines: [],
    refunds: [],
    receipt: null,
    ...overrides,
  };
}

function makeDetail(overrides: Record<string, unknown> = {}) {
  return { ...makePayment(), ...overrides };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    paymentQuote: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    payment: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
    };
    paymentLine: { createMany: jest.Mock };
    refund: { create: jest.Mock };
    escrow: { findUnique: jest.Mock; update: jest.Mock };
    adoption: { findUnique: jest.Mock };
    custody: { findUnique: jest.Mock };
    eventLog: { create: jest.Mock };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let provider: { name: string; charge: jest.Mock; refund: jest.Mock };
  let logging: { log: jest.Mock };

  const config = {
    get: <T>(key: string, fallback?: T): T | undefined =>
      key === 'payments.feeRateBps' ? (250 as unknown as T) : fallback,
  };

  const actor = { userId: 'user-1', role: 'USER' };

  beforeEach(() => {
    prisma = {
      paymentQuote: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      paymentLine: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      refund: { create: jest.fn() },
      escrow: { findUnique: jest.fn(), update: jest.fn() },
      adoption: { findUnique: jest.fn() },
      custody: { findUnique: jest.fn() },
      eventLog: { create: jest.fn() },
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => Promise.resolve(callback(prisma)),
    );

    provider = {
      name: 'fake',
      charge: jest.fn(),
      refund: jest.fn(),
    };
    logging = { log: jest.fn().mockResolvedValue(null) };

    service = new PaymentsService(
      prisma as never,
      config as never,
      logging as never,
      provider as unknown as PaymentProvider,
    );
  });

  // ─── Quotes ────────────────────────────────────────────────────────────

  describe('createQuote', () => {
    beforeEach(() => {
      prisma.paymentQuote.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'quote-1', createdAt: BASE_DATE }),
      );
    });

    it('snapshots the fee rate and fee for a deposit', async () => {
      const view = await service.createQuote('user-1', {
        purpose: PaymentPurpose.DEPOSIT,
        amountMinor: '10000',
        currency: 'xlm',
      });

      expect(view.feeRateBps).toBe(250);
      expect(view.feeMinor).toBe('250');
      expect(view.currency).toBe('XLM');
      const createCall = callArg<{
        data: { userId: string; totalMinor: bigint; feeMinor: bigint };
      }>(prisma.paymentQuote.create);
      expect(createCall.data).toMatchObject({
        userId: 'user-1',
        totalMinor: 10000n,
        feeMinor: 250n,
      });
    });

    it('charges the full amount as the fee for FEE payments', async () => {
      const view = await service.createQuote('user-1', {
        purpose: PaymentPurpose.FEE,
        amountMinor: '10000',
      });

      expect(view.feeMinor).toBe('10000');
    });

    it('charges no fee for top-ups and refunds', async () => {
      const topup = await service.createQuote('user-1', {
        purpose: PaymentPurpose.TOPUP,
        amountMinor: '10000',
      });
      const refund = await service.createQuote('user-1', {
        purpose: PaymentPurpose.REFUND,
        amountMinor: '10000',
      });

      expect(topup.feeMinor).toBe('0');
      expect(refund.feeMinor).toBe('0');
    });

    it('rejects zero and malformed amounts', async () => {
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '0',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '1.5',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects more than one entity link', async () => {
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '10000',
          escrowId: 'escrow-1',
          adoptionId: 'adoption-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('validates adoption party membership', async () => {
      prisma.adoption.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '10000',
          adoptionId: 'adoption-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.adoption.findUnique.mockResolvedValueOnce({
        adopterId: 'someone-else',
        ownerId: 'someone-else-2',
      });
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '10000',
          adoptionId: 'adoption-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prisma.adoption.findUnique.mockResolvedValueOnce({
        adopterId: 'user-1',
        ownerId: 'owner-1',
      });
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '10000',
          adoptionId: 'adoption-1',
        }),
      ).resolves.toBeDefined();
    });

    it('validates custody party membership', async () => {
      prisma.custody.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '10000',
          custodyId: 'custody-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.custody.findUnique.mockResolvedValueOnce({
        holderId: 'someone-else',
        pet: { currentOwnerId: 'someone-else-2' },
      });
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '10000',
          custodyId: 'custody-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      prisma.custody.findUnique.mockResolvedValueOnce({
        holderId: 'holder-1',
        pet: { currentOwnerId: 'user-1' },
      });
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '10000',
          custodyId: 'custody-1',
        }),
      ).resolves.toBeDefined();
    });

    it('rejects an unknown escrow link', async () => {
      prisma.escrow.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createQuote('user-1', {
          purpose: PaymentPurpose.DEPOSIT,
          amountMinor: '10000',
          escrowId: 'escrow-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── Create payment ────────────────────────────────────────────────────

  describe('createPayment', () => {
    it('consumes the quote and creates a pending payment', async () => {
      prisma.paymentQuote.findUnique.mockResolvedValue(makeQuote());
      prisma.paymentQuote.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.create.mockResolvedValue(makePayment());

      const view = await service.createPayment('user-1', {
        quoteId: 'quote-1',
      });

      expect(view.status).toBe(PaymentStatus.PENDING);
      const claim = callArg<{
        where: { id: string; consumedAt: null };
        data: { consumedAt: Date };
      }>(prisma.paymentQuote.updateMany);
      expect(claim.where).toEqual({ id: 'quote-1', consumedAt: null });
      expect(claim.data.consumedAt).toBeInstanceOf(Date);
    });

    it('rejects unknown and foreign quotes', async () => {
      prisma.paymentQuote.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.createPayment('user-1', { quoteId: 'quote-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.paymentQuote.findUnique.mockResolvedValueOnce(
        makeQuote({ userId: 'other-user' }),
      );
      await expect(
        service.createPayment('user-1', { quoteId: 'quote-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects consumed and expired quotes', async () => {
      prisma.paymentQuote.findUnique.mockResolvedValueOnce(
        makeQuote({ consumedAt: BASE_DATE }),
      );
      await expect(
        service.createPayment('user-1', { quoteId: 'quote-1' }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.paymentQuote.findUnique.mockResolvedValueOnce(
        makeQuote({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(
        service.createPayment('user-1', { quoteId: 'quote-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a quote claimed concurrently', async () => {
      prisma.paymentQuote.findUnique.mockResolvedValue(makeQuote());
      prisma.paymentQuote.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.createPayment('user-1', { quoteId: 'quote-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ─── Pay ───────────────────────────────────────────────────────────────

  describe('pay', () => {
    it('returns 404 for payments owned by someone else', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ userId: 'other-user' }),
      );

      await expect(service.pay(actor, 'payment-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 404 when the payment does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await expect(service.pay(actor, 'payment-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects non-pending payments', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.PAID }),
      );

      await expect(service.pay(actor, 'payment-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('marks the payment FAILED when the provider declines', async () => {
      prisma.payment.findUnique.mockResolvedValue(makePayment());
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      provider.charge.mockResolvedValue({
        succeeded: false,
        failureReason: 'declined',
      });

      await expect(
        service.pay(actor, 'payment-1', { providerToken: 'decline' }),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_DECLINED' } });

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
      expect(logging.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PAYMENT_FAILED', level: 'WARN' }),
      );
    });

    it('posts balanced principal lines and returns the paid payment', async () => {
      prisma.payment.findUnique.mockResolvedValue(makePayment());
      provider.charge.mockResolvedValue({
        succeeded: true,
        txHash: 'fake_stellar_1',
        externalRef: 'fake_ch_1',
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        makeDetail({
          status: PaymentStatus.PAID,
          txHash: 'fake_stellar_1',
          externalRef: 'fake_ch_1',
          paidAt: BASE_DATE,
        }),
      );

      const view = await service.pay(actor, 'payment-1', {});

      expect(view.status).toBe(PaymentStatus.PAID);
      const lines = callArg<{ data: LedgerRow[] }>(
        prisma.paymentLine.createMany,
      ).data;
      expect(lines).toHaveLength(2);
      expect(lines.reduce((sum, line) => sum + line.amountMinor, 0n)).toBe(
        20000n,
      );
      expect(logging.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PAYMENT_PAID' }),
      );
    });

    it('funds a linked escrow', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ escrowId: 'escrow-1' }),
      );
      provider.charge.mockResolvedValue({
        succeeded: true,
        txHash: 'fake_stellar_1',
      });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.escrow.findUnique.mockResolvedValue({
        id: 'escrow-1',
        status: EscrowStatus.CREATED,
      });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        makeDetail({ status: PaymentStatus.PAID, escrowId: 'escrow-1' }),
      );

      await service.pay(actor, 'payment-1', {});

      expect(prisma.escrow.update).toHaveBeenCalledWith({
        where: { id: 'escrow-1' },
        data: {
          status: EscrowStatus.FUNDED,
          fundingTxHash: 'fake_stellar_1',
        },
      });
      const eventCall = callArg<{ data: { eventType: string } }>(
        prisma.eventLog.create,
      );
      expect(eventCall.data.eventType).toBe('ESCROW_FUNDED');
    });

    it('rejects a missing or unfundable escrow', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ escrowId: 'escrow-1' }),
      );
      provider.charge.mockResolvedValue({ succeeded: true });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      prisma.escrow.findUnique.mockResolvedValueOnce(null);
      await expect(service.pay(actor, 'payment-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.escrow.findUnique.mockResolvedValueOnce({
        id: 'escrow-1',
        status: EscrowStatus.RELEASED,
      });
      await expect(service.pay(actor, 'payment-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not re-fund an escrow that is already funded', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ escrowId: 'escrow-1' }),
      );
      provider.charge.mockResolvedValue({ succeeded: true });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.escrow.findUnique.mockResolvedValue({
        id: 'escrow-1',
        status: EscrowStatus.FUNDED,
      });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        makeDetail({ status: PaymentStatus.PAID, escrowId: 'escrow-1' }),
      );

      await service.pay(actor, 'payment-1', {});

      expect(prisma.escrow.update).not.toHaveBeenCalled();
      expect(prisma.eventLog.create).toHaveBeenCalled();
    });

    it('rejects a payment claimed concurrently between charge and write', async () => {
      prisma.payment.findUnique.mockResolvedValue(makePayment());
      provider.charge.mockResolvedValue({ succeeded: true });
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.pay(actor, 'payment-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  // ─── Complete ──────────────────────────────────────────────────────────

  describe('complete', () => {
    it('only settles paid deposits', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(
        makePayment({
          purpose: PaymentPurpose.TOPUP,
          status: PaymentStatus.PAID,
        }),
      );
      await expect(
        service.complete(actor, 'payment-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.payment.findUnique.mockResolvedValueOnce(
        makePayment({ status: PaymentStatus.PENDING }),
      );
      await expect(
        service.complete(actor, 'payment-1', {}),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.payment.findUnique.mockResolvedValueOnce(
        makePayment({
          status: PaymentStatus.PAID,
          settledAt: BASE_DATE,
          settlementRefundMinor: 9750n,
        }),
      );
      await expect(
        service.complete(actor, 'payment-1', {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('settles a deposit with a penalty and posts balanced lines', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.PAID, feeMinor: 250n }),
      );
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.findUniqueOrThrow.mockResolvedValue(
        makeDetail({
          status: PaymentStatus.PAID,
          settledAt: BASE_DATE,
          settlementRefundMinor: 8750n,
          settlementPenaltyMinor: 1000n,
          settlementFeeMinor: 250n,
        }),
      );

      const view = await service.complete(actor, 'payment-1', {
        penaltyMinor: '1000',
      });

      expect(view.settlementRefundMinor).toBe('8750');
      const settleCall = callArg<{
        where: { id: string; status: PaymentStatus; settledAt: null };
        data: Record<string, unknown>;
      }>(prisma.payment.updateMany);
      expect(settleCall.where).toEqual({
        id: 'payment-1',
        status: PaymentStatus.PAID,
        settledAt: null,
      });
      expect(settleCall.data).toMatchObject({
        settlementRefundMinor: 8750n,
        settlementPenaltyMinor: 1000n,
        settlementFeeMinor: 250n,
      });
      expect(settleCall.data.settledAt).toBeInstanceOf(Date);

      const lines = callArg<{ data: LedgerRow[] }>(
        prisma.paymentLine.createMany,
      ).data;
      const debits = lines
        .filter((line) => line.direction === PaymentLineDirection.DEBIT)
        .reduce((sum, line) => sum + line.amountMinor, 0n);
      const credits = lines
        .filter((line) => line.direction === PaymentLineDirection.CREDIT)
        .reduce((sum, line) => sum + line.amountMinor, 0n);
      expect(debits).toBe(credits);
      expect(debits).toBe(10000n);
    });

    it('fails loudly if the stored fee snapshot disagrees', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.PAID, feeMinor: 999n }),
      );

      await expect(service.complete(actor, 'payment-1', {})).rejects.toThrow(
        /Fee snapshot mismatch/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a settlement claimed concurrently', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.PAID }),
      );
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.complete(actor, 'payment-1', {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ─── Refund ────────────────────────────────────────────────────────────

  describe('refund', () => {
    const settledDeposit = (overrides: Record<string, unknown> = {}) =>
      makePayment({
        status: PaymentStatus.PAID,
        amountMinor: 10000n,
        feeMinor: 250n,
        settlementRefundMinor: 9750n,
        settlementPenaltyMinor: 0n,
        settlementFeeMinor: 250n,
        settledAt: BASE_DATE,
        ...overrides,
      });

    it('rejects non-refundable statuses and purposes', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(
        makePayment({ status: PaymentStatus.PENDING }),
      );
      await expect(
        service.refund(actor, 'payment-1', { amountMinor: '1' }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.payment.findUnique.mockResolvedValueOnce(
        makePayment({
          status: PaymentStatus.PAID,
          purpose: PaymentPurpose.FEE,
        }),
      );
      await expect(
        service.refund(actor, 'payment-1', { amountMinor: '1' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.payment.findUnique.mockResolvedValueOnce(
        makePayment({
          status: PaymentStatus.PAID,
          settlementRefundMinor: null,
        }),
      );
      await expect(
        service.refund(actor, 'payment-1', { amountMinor: '1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects zero, over-cap, and above-settlement refunds', async () => {
      prisma.payment.findUnique.mockResolvedValue(settledDeposit());

      await expect(
        service.refund(actor, 'payment-1', { amountMinor: '0' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.refund(actor, 'payment-1', { amountMinor: '9751' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(provider.refund).not.toHaveBeenCalled();

      await expect(
        service.refund(actor, 'payment-1', { amountMinor: '20000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a provider-declined refund', async () => {
      prisma.payment.findUnique.mockResolvedValue(settledDeposit());
      provider.refund.mockResolvedValue({ succeeded: false });

      await expect(
        service.refund(actor, 'payment-1', { amountMinor: '4000' }),
      ).rejects.toMatchObject({ response: { code: 'REFUND_DECLINED' } });
    });

    it('applies a partial refund with a balanced ledger and refund record', async () => {
      prisma.payment.findUnique.mockResolvedValue(settledDeposit());
      provider.refund.mockResolvedValue({
        succeeded: true,
        externalRef: 'fake_re_1',
        txHash: 'fake_stellar_re_1',
      });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.payment.findUniqueOrThrow
        .mockResolvedValueOnce(settledDeposit({ refundedAmountMinor: 4000n }))
        .mockResolvedValueOnce(
          makeDetail({
            status: PaymentStatus.PARTIALLY_REFUNDED,
            refundedAmountMinor: 4000n,
          }),
        );

      const view = await service.refund(actor, 'payment-1', {
        amountMinor: '4000',
        reason: 'partial',
      });

      expect(view.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      const refundCall = callArg<{
        data: {
          amountMinor: bigint;
          status: RefundStatus;
          reason: string;
          createdById: string;
        };
      }>(prisma.refund.create);
      expect(refundCall.data).toMatchObject({
        amountMinor: 4000n,
        status: RefundStatus.COMPLETED,
        reason: 'partial',
        createdById: 'user-1',
      });
      const lines = callArg<{ data: LedgerRow[] }>(
        prisma.paymentLine.createMany,
      ).data;
      expect(lines).toHaveLength(2);
      expect(lines.reduce((sum, line) => sum + line.amountMinor, 0n)).toBe(
        8000n,
      );
      expect(logging.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PAYMENT_REFUNDED' }),
      );

      const rawValues = (prisma.$executeRaw.mock.calls[0] as unknown[]).slice(
        1,
      );
      expect(rawValues).toEqual([4000n, 'payment-1', 4000n, 9750n]);
    });

    it('marks the payment REFUNDED when the whole amount is returned', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        settledDeposit({ settlementRefundMinor: 10000n, feeMinor: 0n }),
      );
      provider.refund.mockResolvedValue({ succeeded: true });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.payment.findUniqueOrThrow
        .mockResolvedValueOnce(
          settledDeposit({
            settlementRefundMinor: 10000n,
            feeMinor: 0n,
            refundedAmountMinor: 10000n,
          }),
        )
        .mockResolvedValueOnce(
          makeDetail({
            status: PaymentStatus.REFUNDED,
            refundedAmountMinor: 10000n,
          }),
        );

      const view = await service.refund(actor, 'payment-1', {
        amountMinor: '10000',
      });

      expect(view.status).toBe(PaymentStatus.REFUNDED);
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: { status: PaymentStatus.REFUNDED },
      });
    });

    it('rejects when the conditional cap update loses the race', async () => {
      prisma.payment.findUnique.mockResolvedValue(settledDeposit());
      provider.refund.mockResolvedValue({ succeeded: true });
      prisma.$executeRaw.mockResolvedValue(0);

      await expect(
        service.refund(actor, 'payment-1', { amountMinor: '4000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('allows a TOPUP refund up to the full amount', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        makePayment({
          purpose: PaymentPurpose.TOPUP,
          status: PaymentStatus.PAID,
          amountMinor: 5000n,
          refundedAmountMinor: 500n,
        }),
      );
      provider.refund.mockResolvedValue({ succeeded: true });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.payment.findUniqueOrThrow
        .mockResolvedValueOnce(
          makePayment({
            purpose: PaymentPurpose.TOPUP,
            status: PaymentStatus.PAID,
            amountMinor: 5000n,
            refundedAmountMinor: 4500n,
          }),
        )
        .mockResolvedValueOnce(
          makeDetail({
            purpose: PaymentPurpose.TOPUP,
            status: PaymentStatus.PARTIALLY_REFUNDED,
            amountMinor: 5000n,
            refundedAmountMinor: 4500n,
          }),
        );

      await service.refund(actor, 'payment-1', { amountMinor: '4000' });
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });

  // ─── Reads ─────────────────────────────────────────────────────────────

  describe('getPayment', () => {
    it('returns a detailed payment to its owner', async () => {
      const detail = makeDetail({
        status: PaymentStatus.PAID,
        lines: [
          {
            id: 'line-1',
            paymentId: 'payment-1',
            account: 'USER_WALLET',
            direction: PaymentLineDirection.DEBIT,
            type: PaymentLineType.PRINCIPAL,
            amountMinor: 10000n,
            currency: 'XLM',
            description: 'x',
            createdAt: BASE_DATE,
            settlementId: null,
          },
        ],
      });
      prisma.payment.findUnique.mockResolvedValueOnce(makePayment());
      prisma.payment.findUniqueOrThrow.mockResolvedValueOnce(detail);

      const view = await service.getPayment(actor, 'payment-1');

      expect(view.lines).toHaveLength(1);
      expect(view.lines?.[0].amountMinor).toBe('10000');
    });

    it('lets an admin read any payment but hides it from other users', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(
        makePayment({ userId: 'other-user' }),
      );
      prisma.payment.findUniqueOrThrow.mockResolvedValueOnce(
        makeDetail({ userId: 'other-user', status: PaymentStatus.PAID }),
      );
      const view = await service.getPayment(
        { userId: 'admin-1', role: 'ADMIN' },
        'payment-1',
      );
      expect(view.userId).toBe('other-user');

      prisma.payment.findUnique.mockResolvedValueOnce(
        makePayment({ userId: 'other-user' }),
      );
      await expect(
        service.getPayment({ userId: 'user-2', role: 'USER' }, 'payment-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listPayments', () => {
    function row(index: number) {
      return makePayment({
        id: `payment-${index}`,
        createdAt: new Date(BASE_DATE.getTime() - index * 1000),
      });
    }

    it('returns a page and a cursor when more rows exist', async () => {
      prisma.payment.findMany.mockResolvedValue([row(0), row(1), row(2)]);

      const page = await service.listPayments('user-1', { limit: 2 });

      expect(page.data).toHaveLength(2);
      expect(page.nextCursor).toBeTruthy();
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it('round-trips the cursor and applies the status filter', async () => {
      prisma.payment.findMany.mockResolvedValueOnce([row(0), row(1)]);
      const first = await service.listPayments('user-1', { limit: 1 });

      prisma.payment.findMany.mockResolvedValueOnce([row(2)]);
      await service.listPayments('user-1', {
        limit: 1,
        cursor: first.nextCursor ?? undefined,
        status: PaymentStatus.PAID,
      });

      const secondCall = callArg<{
        where: { status: string; OR?: unknown };
        take: number;
      }>(prisma.payment.findMany, 1);
      expect(secondCall.where.status).toBe(PaymentStatus.PAID);
      expect(secondCall.where.OR).toBeDefined();
      expect(secondCall.take).toBe(2);
    });

    it('returns no cursor when the page is complete', async () => {
      prisma.payment.findMany.mockResolvedValue([row(0)]);

      const page = await service.listPayments('user-1', { limit: 10 });

      expect(page.nextCursor).toBeNull();
    });

    it('rejects malformed cursors', async () => {
      await expect(
        service.listPayments('user-1', { cursor: 'not-a-cursor' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const malformed = Buffer.from(
        JSON.stringify({ createdAt: 'nope' }),
      ).toString('base64url');
      await expect(
        service.listPayments('user-1', { cursor: malformed }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults the page size', async () => {
      prisma.payment.findMany.mockResolvedValue([]);
      await service.listPayments('user-1', {});
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 26 }),
      );
    });
  });
});
