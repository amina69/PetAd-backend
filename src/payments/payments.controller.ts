import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds/refunds.service';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { CreateRefundRequestDto } from './dto/refund-request.dto';

interface AuthRequest extends Request {
  user?: { userId?: string; sub?: string; role?: string };
}

function requester(req: AuthRequest): { id: string; role?: string } {
  const id = req.user?.userId ?? req.user?.sub;
  if (!id) {
    throw new UnauthorizedException();
  }
  return { id, role: req.user?.role };
}

@ApiTags('Payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly refundsService: RefundsService,
  ) {}

  /**
   * GET /payments
   * Own payments only; admins see every payment. Amounts are always returned
   * as `{ amountMinor, currency }` integers in minor units.
   */
  @Get()
  @ApiOperation({
    summary: 'List payments (own only; admins see all)',
    description:
      'Supports status, from/to date filters and pagination. Every amount is ' +
      'an integer in minor units with its currency.',
  })
  @ApiResponse({ status: 200, description: 'Paginated payments list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listPayments(@Req() req: AuthRequest, @Query() query: ListPaymentsDto) {
    return this.paymentsService.listPayments(requester(req), query);
  }

  /**
   * POST /payments/:id/refund-request
   * Only the payer may request a refund, and only while the payment is
   * refundable. Duplicate open requests are rejected.
   */
  @Post(':id/refund-request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Request a refund for a payment',
    description:
      'Requires a reason of at least 20 characters and an eligible payment ' +
      '(within 30 days, not fully refunded, no open request).',
  })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({ status: 201, description: 'Refund request created' })
  @ApiResponse({
    status: 409,
    description: 'Payment not refundable or a refund request is already open',
  })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  createRefundRequest(
    @Req() req: AuthRequest,
    @Param('id') paymentId: string,
    @Body() dto: CreateRefundRequestDto,
  ) {
    return this.refundsService.createRequest(paymentId, requester(req).id, dto);
  }

  /**
   * GET /payments/:id
   * Detail with line items, related entity link, refund history and a
   * server-computed `refundable` flag. Another user's payment returns 404.
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get a payment with lines, related entity and refundable flag',
  })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'Payment detail' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  getPayment(@Req() req: AuthRequest, @Param('id') paymentId: string) {
    return this.paymentsService.getPayment(paymentId, requester(req));
  }
}
