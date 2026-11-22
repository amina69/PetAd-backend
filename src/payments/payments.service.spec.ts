import { NotFoundException } from '@nestjs/common';
import { PaymentsService, computeRefundability } from './payments.service';

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  payerId: 'payer-1',
  payeeId: 'shelter-1',
  amountMinor: 12500,
  refundedAmountMinor: 0,
  currency: 'XLM',
  status: 'SUCCEEDED',
  escrowId: 'esc-1',
  paidAt: daysAgo(3),
  createdAt: daysAgo(3),
  updatedAt: daysAgo(3),
  lines: [
    {
      id: 'line-1',
      paymentId: 'pay-1',
      kind: 'ESCROW_FUNDED',
      label: 'Adoption escrow',
      amountMinor: 12000,
      createdAt: daysAgo(3),
    },
    {
      id: 'line-2',
      paymentId: 'pay-1',
      kind: 'SERVICE_FEE',
      label: 'Platform fee',
      amountMinor: 500,
      createdAt: daysAgo(3),
    },
  ],
  refundRequests: [],
  escrow: {
    id: 'esc-1',
    status: 'FUNDED',
    adoption: { id: 'adoption-1' },
    custody: null,
  },
  ...overrides,
});

function build() {
  const prisma = {
    payment: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  return {
    service: new PaymentsService(prisma as never),
    prisma,
  };
}

describe('computeRefundability', () => {
  it('is eligible inside the window with a positive balance', () => {
    const result = computeRefundability(payment() as never);

    expect(result.eligible).toBe(true);
    expect(result.remainingAmountMinor).toBe(12500);
    expect(result.remaining).toEqual({ amountMinor: 12500, currency: 'XLM' });
  });

  it('is not eligible once the 30-day window has closed', () => {
    const result = computeRefundability(
      payment({ paidAt: daysAgo(31) }) as never,
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('window');
  });

  it('is not eligible while a request is open', () => {
    const result = computeRefundability(
      payment({
        refundRequests: [{ id: 'req-1', status: 'PENDING' }],
      }) as never,
    );

    expect(result.eligible).toBe(false);
    expect(result.openRequestId).toBe('req-1');
  });
});

describe('PaymentsService', () => {
  it('lists only the caller’s payments for non-admins', async () => {
    const { service, prisma } = build();
    prisma.payment.findMany.mockResolvedValue([payment()]);
    prisma.payment.count.mockResolvedValue(1);

    const result = await service.listPayments(
      { id: 'payer-1', role: 'USER' },
      { page: 1, limit: 20 },
    );

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ payerId: 'payer-1' }, { payeeId: 'payer-1' }],
        },
      }),
    );
    expect(result.data[0].amount).toEqual({
      amountMinor: 12500,
      currency: 'XLM',
    });
    expect(Number.isInteger(result.data[0].amount.amountMinor)).toBe(true);
  });

  it('lets admins list every payment', async () => {
    const { service, prisma } = build();
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);

    await service.listPayments({ id: 'admin-1', role: 'ADMIN' }, {});

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('returns 404 for another user’s payment', async () => {
    const { service, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue(payment());

    await expect(
      service.getPayment('pay-1', { id: 'stranger', role: 'USER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns lines, related entity and the refundable flag as minor units', async () => {
    const { service, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue(payment());

    const result = await service.getPayment('pay-1', {
      id: 'payer-1',
      role: 'USER',
    });

    expect(result.amount).toEqual({ amountMinor: 12500, currency: 'XLM' });
    expect(result.refundedAmount).toEqual({
      amountMinor: 0,
      currency: 'XLM',
    });
    expect(result.lines.map((line) => line.amount.amountMinor)).toEqual([
      12000, 500,
    ]);
    expect(result.relatedEntity).toEqual({
      type: 'ADOPTION',
      id: 'adoption-1',
    });
    expect(result.refundable.eligible).toBe(true);
  });
});
