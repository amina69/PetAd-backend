import { StreamableFile } from '@nestjs/common';
import {
  CompletePaymentDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PayPaymentDto,
  RefundPaymentDto,
} from './dto/payment-actions.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { PaymentsController } from './payments.controller';
import { ReceiptsController } from './receipts/receipts.controller';

const user = {
  sub: 'user-1',
  userId: 'user-1',
  email: 'ada@example.com',
  role: 'USER',
};

describe('PaymentsController', () => {
  let payments: {
    createQuote: jest.Mock;
    createPayment: jest.Mock;
    listPayments: jest.Mock;
    getPayment: jest.Mock;
    pay: jest.Mock;
    complete: jest.Mock;
    refund: jest.Mock;
  };
  let receipts: { getReceiptLink: jest.Mock };
  let controller: PaymentsController;

  beforeEach(() => {
    payments = {
      createQuote: jest.fn().mockResolvedValue({ id: 'quote-1' }),
      createPayment: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      listPayments: jest.fn().mockResolvedValue({ data: [], nextCursor: null }),
      getPayment: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      pay: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      complete: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      refund: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };
    receipts = { getReceiptLink: jest.fn().mockResolvedValue({ url: '/x' }) };
    controller = new PaymentsController(payments as never, receipts as never);
  });

  it('delegates quote creation for the caller', async () => {
    const dto: CreateQuoteDto = {
      purpose: 'DEPOSIT' as never,
      amountMinor: '100',
    };
    await expect(controller.createQuote(user, dto)).resolves.toEqual({
      id: 'quote-1',
    });
    expect(payments.createQuote).toHaveBeenCalledWith('user-1', dto);
  });

  it('delegates payment creation for the caller', async () => {
    const dto: CreatePaymentDto = { quoteId: 'quote-1' };
    await controller.createPayment(user, dto);
    expect(payments.createPayment).toHaveBeenCalledWith('user-1', dto);
  });

  it('delegates listing with the query', async () => {
    const query: ListPaymentsQueryDto = { limit: 10 };
    await expect(controller.listPayments(user, query)).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    expect(payments.listPayments).toHaveBeenCalledWith('user-1', query);
  });

  it('passes the full user context to get/pay/complete/refund', async () => {
    await controller.getPayment(user, 'payment-1');
    expect(payments.getPayment).toHaveBeenCalledWith(user, 'payment-1');

    const payDto: PayPaymentDto = { providerToken: 'decline' };
    await controller.pay(user, 'payment-1', payDto);
    expect(payments.pay).toHaveBeenCalledWith(user, 'payment-1', payDto);

    const completeDto: CompletePaymentDto = { penaltyMinor: '100' };
    await controller.complete(user, 'payment-1', completeDto);
    expect(payments.complete).toHaveBeenCalledWith(
      user,
      'payment-1',
      completeDto,
    );

    const refundDto: RefundPaymentDto = { amountMinor: '100' };
    await controller.refund(user, 'payment-1', refundDto);
    expect(payments.refund).toHaveBeenCalledWith(user, 'payment-1', refundDto);
  });

  it('delegates receipt links to the receipts service', async () => {
    await controller.getReceipt(user, 'payment-1');
    expect(receipts.getReceiptLink).toHaveBeenCalledWith(user, 'payment-1');
  });
});

describe('ReceiptsController', () => {
  it('streams the PDF as an attachment', async () => {
    const buffer = Buffer.from('%PDF-1.7');
    const service = {
      download: jest.fn().mockResolvedValue({
        buffer,
        fileName: 'petad-receipt-00000001.pdf',
      }),
    };
    const controller = new ReceiptsController(service as never);

    const file = await controller.download('signed-token');

    expect(service.download).toHaveBeenCalledWith('signed-token');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toMatchObject({
      type: 'application/pdf',
      disposition: 'attachment; filename="petad-receipt-00000001.pdf"',
      length: buffer.length,
    });
  });
});
