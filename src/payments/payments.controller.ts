import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateQuoteDto } from './dto/create-quote.dto';
import {
  CompletePaymentDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PayPaymentDto,
  RefundPaymentDto,
} from './dto/payment-actions.dto';
import { PaymentsService } from './payments.service';
import { ReceiptsService } from './receipts/receipts.service';
import {
  PaymentPageView,
  PaymentView,
  QuoteView,
} from './dto/payment-response.dto';
import { ReceiptLinkView } from './receipts/receipts.service';

@ApiTags('payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly receiptsService: ReceiptsService,
  ) {}

  @Post('quote')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a payment quote',
    description:
      'Snapshots the current platform fee rate against an amount expressed in ' +
      'integer minor units. Quotes expire after 15 minutes and can be paid once.',
  })
  @ApiResponse({ status: 201, description: 'Quote created' })
  @ApiResponse({ status: 400, description: 'Invalid amount or entity link' })
  createQuote(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateQuoteDto,
  ): Promise<QuoteView> {
    return this.paymentsService.createQuote(user.userId, dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a pending payment from a quote',
    description:
      'Consumes the quote and creates a PENDING payment. Pay it with POST /payments/:id/pay.',
  })
  @ApiResponse({ status: 201, description: 'Payment created' })
  @ApiResponse({ status: 409, description: 'Quote already used' })
  createPayment(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentView> {
    return this.paymentsService.createPayment(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the current user’s payments' })
  @ApiResponse({ status: 200, description: 'Cursor-paginated payments' })
  listPayments(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<PaymentPageView> {
    return this.paymentsService.listPayments(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment with its ledger lines and refunds' })
  @ApiResponse({ status: 200, description: 'Payment found' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  getPayment(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<PaymentView> {
    return this.paymentsService.getPayment(user, id);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pay a pending payment through the configured provider',
    description:
      'With the fake provider, pass providerToken "decline" to simulate a failure. ' +
      'A successful deposit payment also funds its linked escrow.',
  })
  @ApiResponse({ status: 200, description: 'Payment paid' })
  @ApiResponse({ status: 400, description: 'Payment declined' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  @ApiResponse({ status: 409, description: 'Payment is not pending' })
  pay(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: PayPaymentDto,
  ): Promise<PaymentView> {
    return this.paymentsService.pay(user, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Settle a paid deposit',
    description:
      'Splits the deposit into refund + penalty + platform fee using the fee ' +
      'rate snapshotted at quote time. Conservation always holds exactly.',
  })
  @ApiResponse({ status: 200, description: 'Deposit settled' })
  @ApiResponse({ status: 400, description: 'Not a deposit or bad penalty' })
  @ApiResponse({ status: 409, description: 'Not paid or already settled' })
  complete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: CompletePaymentDto,
  ): Promise<PaymentView> {
    return this.paymentsService.complete(user, id, dto);
  }

  @Post(':id/refunds')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Issue a (partial) refund',
    description:
      'Refunds are capped at the remaining refundable balance and can never ' +
      'exceed it, even under concurrent requests.',
  })
  @ApiResponse({ status: 201, description: 'Refund completed' })
  @ApiResponse({ status: 400, description: 'Refund exceeds the cap' })
  @ApiResponse({ status: 409, description: 'Payment is not refundable' })
  refund(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<PaymentView> {
    return this.paymentsService.refund(user, id, dto);
  }

  @Get(':id/receipt')
  @ApiOperation({
    summary: 'Get a signed URL for a payment receipt',
    description:
      'Generates the receipt on first access (idempotently) and returns a ' +
      'short-lived signed URL to download the private PDF.',
  })
  @ApiResponse({ status: 200, description: 'Signed receipt URL' })
  @ApiResponse({ status: 400, description: 'Payment is not paid' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  getReceipt(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<ReceiptLinkView> {
    return this.receiptsService.getReceiptLink(user, id);
  }
}
