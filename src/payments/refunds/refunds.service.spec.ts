import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RefundsService } from './refunds.service';

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const basePayment = {
  id: 'pay-1',
  payerId: 'payer-1',
  payeeId: 'shelter-1',
  amountMinor: 10000,
  refundedAmountMinor: 0,
  currency: 'XLM',
  status: 'SUCCEEDED',
  escrowId: 'esc-1',
  paidAt: daysAgo(2),
  createdAt: daysAgo(2),
  updatedAt: daysAgo(2),
  refundRequests: [] as Array<{ id: string; status: string }>,
};

const pendingRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 'req-1',
  paymentId: 'pay-1',
  requesterId: 'payer-1',
  reason: 'The adoption was cancelled after payment',
  requestedAmountMinor: 6000,
  approvedAmountMinor: null,
  status: 'PENDING',
  decidedById: null,
  decisionReason: null,
  decidedAt: null,
  createdAt: daysAgo(1),
  ...overrides,
});

function build() {
  const prisma = {
    $transaction: jest.fn((work: (tx: unknown) => unknown) => work(prisma)),
    $executeRaw: jest.fn().mockResolvedValue(1),
    payment: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    refundRequest: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const events = { logEvent: jest.fn().mockResolvedValue(undefined) };
  const settlement = {
    settleRefund: jest.fn().mockResolvedValue({
      rail: 'ESCROW',
      status: 'REFUNDED',
    }),
  };
  const notifications = {
    notifyUser: jest.fn().mockResolvedValue(true),
  };

  const service = new RefundsService(
    prisma as never,
    events as never,
    settlement as never,
    notifications as never,
  );

  return { service, prisma, events, settlement, notifications };
}

describe('RefundsService', () => {
  describe('createRequest', () => {
    it('rejects a reason shorter than 20 characters', async () => {
      const { service, prisma } = build();

      await expect(
        service.createRequest('pay-1', 'payer-1', {
          reason: 'too short',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('hides another user’s payment behind a 404', async () => {
      const { service, prisma } = build();
      prisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        payerId: 'someone-else',
      });

      await expect(
        service.createRequest('pay-1', 'payer-1', {
          reason: 'The adoption was cancelled after payment',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses an ineligible (fully refunded) payment', async () => {
      const { service, prisma } = build();
      prisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        status: 'REFUNDED',
        refundedAmountMinor: 10000,
        refundRequests: [],
      });

      await expect(
        service.createRequest('pay-1', 'payer-1', {
          reason: 'The adoption was cancelled after payment',
        }),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_NOT_REFUNDABLE' } });
    });

    it('blocks a duplicate open request', async () => {
      const { service, prisma } = build();
      prisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        refundRequests: [{ id: 'req-open', status: 'PENDING' }],
      });

      await expect(
        service.createRequest('pay-1', 'payer-1', {
          reason: 'The adoption was cancelled after payment',
        }),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_NOT_REFUNDABLE' } });
    });

    it('allows at most the remaining refundable amount', async () => {
      const { service, prisma } = build();
      prisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        refundedAmountMinor: 2500,
        refundRequests: [],
      });

      await expect(
        service.createRequest('pay-1', 'payer-1', {
          reason: 'The adoption was cancelled after payment',
          amountMinor: 8000,
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_REFUND_AMOUNT' } });
    });

    it('creates a request, logs the event and notifies the requester', async () => {
      const { service, prisma, events, notifications } = build();
      prisma.payment.findUnique.mockResolvedValue(basePayment);
      prisma.refundRequest.create.mockResolvedValue(pendingRequest());

      const result = await service.createRequest('pay-1', 'payer-1', {
        reason: 'The adoption was cancelled after payment',
      });

      expect(result.requestedAmount).toEqual({
        amountMinor: 6000,
        currency: 'XLM',
      });
      expect(events.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REFUND_REQUESTED' }),
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'payer-1',
        expect.objectContaining({ subject: 'Refund request received' }),
      );
    });
  });

  describe('approve', () => {
    it('never refunds more than the paid-minus-refunded balance', async () => {
      const { service, prisma, settlement } = build();
      prisma.refundRequest.findUnique
        .mockResolvedValueOnce({ paymentId: 'pay-1' })
        .mockResolvedValueOnce(
          pendingRequest({ payment: basePayment, requestedAmountMinor: 6000 }),
        );

      await expect(
        service.approve('req-1', 'admin-1', {
          amountMinor: 20000,
          reason: 'Approved after review of the case',
        }),
      ).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_BALANCE' } });

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(settlement.settleRefund).not.toHaveBeenCalled();
    });

    it('fails safely when a concurrent refund consumed the balance', async () => {
      const { service, prisma, settlement } = build();
      prisma.refundRequest.findUnique
        .mockResolvedValueOnce({ paymentId: 'pay-1' })
        .mockResolvedValueOnce(
          pendingRequest({ payment: basePayment, requestedAmountMinor: 6000 }),
        );
      // The conditional update only lands while enough balance remains; a
      // concurrent approval makes it match zero rows.
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.approve('req-1', 'admin-1', {
          reason: 'Approved after review of the case',
        }),
      ).rejects.toMatchObject({ response: { code: 'REFUND_EXCEEDS_BALANCE' } });

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(settlement.settleRefund).not.toHaveBeenCalled();
    });

    it('records a partial approval and queues the refund', async () => {
      const { service, prisma, events, settlement } = build();
      prisma.refundRequest.findUnique
        .mockResolvedValueOnce({ paymentId: 'pay-1' })
        .mockResolvedValueOnce(
          pendingRequest({ payment: basePayment, requestedAmountMinor: 6000 }),
        );
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.update.mockResolvedValue({
        ...basePayment,
        refundedAmountMinor: 3000,
        status: 'PARTIALLY_REFUNDED',
      });
      prisma.refundRequest.update.mockResolvedValue(
        pendingRequest({
          status: 'PARTIALLY_APPROVED',
          approvedAmountMinor: 3000,
          decisionReason: 'Half of the escrow was already released',
        }),
      );

      const result = await service.approve('req-1', 'admin-1', {
        amountMinor: 3000,
        reason: 'Half of the escrow was already released',
      });

      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            refundedAmountMinor: { lte: 7000 },
          }),
        }),
      );
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'PARTIALLY_REFUNDED' },
        }),
      );
      expect(result.status).toBe('PARTIALLY_APPROVED');
      expect(result.payment.refundedAmount).toEqual({
        amountMinor: 3000,
        currency: 'XLM',
      });
      expect(settlement.settleRefund).toHaveBeenCalledWith(
        expect.objectContaining({ escrowId: 'esc-1', amountMinor: 3000 }),
      );
      expect(events.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REFUND_APPROVED' }),
      );
    });

    it('rejects a request that was already decided', async () => {
      const { service, prisma } = build();
      prisma.refundRequest.findUnique
        .mockResolvedValueOnce({ paymentId: 'pay-1' })
        .mockResolvedValueOnce(
          pendingRequest({
            status: 'DENIED',
            payment: basePayment,
          }),
        );

      await expect(
        service.approve('req-1', 'admin-1', {
          reason: 'Approved after review of the case',
        }),
      ).rejects.toMatchObject({
        response: { code: 'REFUND_REQUEST_ALREADY_DECIDED' },
      });
    });
  });

  describe('deny', () => {
    it('records the reason and notifies the requester', async () => {
      const { service, prisma, events, notifications } = build();
      const denied = pendingRequest({
        status: 'DENIED',
        decisionReason: 'The custody agreement is still active',
        payment: basePayment,
      });
      prisma.refundRequest.findUnique
        .mockResolvedValueOnce({ paymentId: 'pay-1' })
        .mockResolvedValueOnce(pendingRequest({ payment: basePayment }));
      prisma.refundRequest.update.mockResolvedValue(denied);

      const result = await service.deny('req-1', 'admin-1', {
        reason: 'The custody agreement is still active',
      });

      expect(prisma.refundRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DENIED',
            decisionReason: 'The custody agreement is still active',
          }),
        }),
      );
      expect(result.decisionReason).toBe(
        'The custody agreement is still active',
      );
      expect(events.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REFUND_DENIED' }),
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'payer-1',
        expect.objectContaining({ subject: 'Refund request denied' }),
      );
    });

    it('requires a decision reason', async () => {
      const { service } = build();

      await expect(
        service.deny('req-1', 'admin-1', { reason: 'nope' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 404 for an unknown request', async () => {
      const { service, prisma } = build();
      prisma.refundRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.deny('missing', 'admin-1', {
          reason: 'The custody agreement is still active',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
