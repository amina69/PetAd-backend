import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaymentPurpose, PaymentStatus } from '@prisma/client';
import { CreateQuoteDto } from './create-quote.dto';
import {
  CompletePaymentDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PayPaymentDto,
  RefundPaymentDto,
} from './payment-actions.dto';

async function errorsFor<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
) {
  const instance = plainToInstance(type, plain);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  return errors.map((error) => error.property);
}

const UUID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('CreateQuoteDto', () => {
  it('accepts a valid quote', async () => {
    await expect(
      errorsFor(CreateQuoteDto, {
        purpose: PaymentPurpose.DEPOSIT,
        amountMinor: '10000',
        currency: 'XLM',
        escrowId: UUID,
      }),
    ).resolves.toEqual([]);
  });

  it('rejects malformed amounts, currencies and identifiers', async () => {
    const errors = await errorsFor(CreateQuoteDto, {
      purpose: 'NOPE',
      amountMinor: '1.5',
      currency: 'X',
      escrowId: 'not-a-uuid',
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'purpose',
        'amountMinor',
        'currency',
        'escrowId',
      ]),
    );
  });

  it('bounds the currency length', async () => {
    expect(
      await errorsFor(CreateQuoteDto, {
        purpose: PaymentPurpose.FEE,
        amountMinor: '1',
        currency: 'ABCDEFGHIJK',
      }),
    ).toContain('currency');
  });
});

describe('payment action DTOs', () => {
  it('validates payment identifiers', async () => {
    expect(await errorsFor(CreatePaymentDto, {})).toContain('quoteId');
    expect(await errorsFor(CreatePaymentDto, { quoteId: 'nope' })).toContain(
      'quoteId',
    );
    expect(await errorsFor(CreatePaymentDto, { quoteId: UUID })).toEqual([]);
  });

  it('bounds provider tokens on pay and refund', async () => {
    expect(
      await errorsFor(PayPaymentDto, { providerToken: 'x'.repeat(129) }),
    ).toContain('providerToken');
    expect(await errorsFor(PayPaymentDto, {})).toEqual([]);

    expect(
      await errorsFor(RefundPaymentDto, {
        amountMinor: '10',
        providerToken: 'x'.repeat(129),
        reason: 'r'.repeat(501),
      }),
    ).toEqual(expect.arrayContaining(['providerToken', 'reason']));
  });

  it('requires integer-string refund amounts', async () => {
    expect(await errorsFor(RefundPaymentDto, {})).toContain('amountMinor');
    expect(await errorsFor(RefundPaymentDto, { amountMinor: '1.5' })).toContain(
      'amountMinor',
    );
    expect(
      await errorsFor(RefundPaymentDto, {
        amountMinor: '10',
        reason: 'partial refund',
      }),
    ).toEqual([]);
  });

  it('validates the optional settlement penalty', async () => {
    expect(
      await errorsFor(CompletePaymentDto, { penaltyMinor: '12x' }),
    ).toContain('penaltyMinor');
    expect(
      await errorsFor(CompletePaymentDto, { penaltyMinor: '1200' }),
    ).toEqual([]);
  });

  it('bounds list pagination and validates status', async () => {
    expect(await errorsFor(ListPaymentsQueryDto, { limit: 0 })).toContain(
      'limit',
    );
    expect(await errorsFor(ListPaymentsQueryDto, { limit: 101 })).toContain(
      'limit',
    );
    expect(
      await errorsFor(ListPaymentsQueryDto, { status: 'BOGUS' }),
    ).toContain('status');
    expect(
      await errorsFor(ListPaymentsQueryDto, { cursor: 'c'.repeat(513) }),
    ).toContain('cursor');

    expect(
      await errorsFor(ListPaymentsQueryDto, {
        limit: '50',
        status: PaymentStatus.PAID,
        cursor: 'opaque',
      }),
    ).toEqual([]);
  });
});
