import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import { RefundsService } from './refunds.service';
import { ApproveRefundDto, DenyRefundDto } from '../dto/refund-request.dto';

interface AuthRequest extends Request {
  user?: { userId?: string; sub?: string; role?: string };
}

function actorId(req: AuthRequest): string {
  const id = req.user?.userId ?? req.user?.sub;
  if (!id) {
    throw new UnauthorizedException();
  }
  return id;
}

@ApiTags('Payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments/refund-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  /**
   * PATCH /payments/refund-requests/:id/approve
   * Approves the requested amount, or a smaller amount for a partial refund.
   * Approval queues the refund through the settlement service.
   */
  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a refund request (admin only)',
    description:
      'Approves the requested amount, or a smaller `amountMinor` for a ' +
      'partial refund. The refund is then queued through the settlement ' +
      'service (escrow or provider rail).',
  })
  @ApiParam({ name: 'id', description: 'Refund request ID' })
  @ApiResponse({ status: 200, description: 'Refund approved and queued' })
  @ApiResponse({
    status: 409,
    description: 'Request already decided or amount exceeds the balance',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  approve(
    @Req() req: AuthRequest,
    @Param('id') requestId: string,
    @Body() dto: ApproveRefundDto,
  ) {
    return this.refundsService.approve(requestId, actorId(req), dto);
  }

  /**
   * PATCH /payments/refund-requests/:id/deny
   * Denies the request and records the reason for the requester.
   */
  @Patch(':id/deny')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deny a refund request (admin only)',
    description:
      'Records the decision reason, which is visible to the requester on ' +
      'the payment detail and in their notification.',
  })
  @ApiParam({ name: 'id', description: 'Refund request ID' })
  @ApiResponse({ status: 200, description: 'Refund denied with reason' })
  @ApiResponse({ status: 409, description: 'Request already decided' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  deny(
    @Req() req: AuthRequest,
    @Param('id') requestId: string,
    @Body() dto: DenyRefundDto,
  ) {
    return this.refundsService.deny(requestId, actorId(req), dto);
  }
}
