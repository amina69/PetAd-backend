import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  MinLength,
} from 'class-validator';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { AddDisputeCommentDto } from './dto/add-dispute-comment.dto';
import { DisputeResolutionService } from './dispute-resolution.service';
import { DisputeOutcome } from '@prisma/client';

class AssignDisputeDto {
  @IsString()
  adminId: string;
}

class ResolveDisputeAdminDto {
  @IsEnum(DisputeOutcome)
  outcome: DisputeOutcome;

  @IsString()
  @MinLength(20)
  resolution: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  splitPercent?: number;
}

@ApiTags('disputes')
@ApiBearerAuth('JWT-auth')
@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly resolution: DisputeResolutionService,
  ) {}

  /**
   * POST /disputes
   * Open a new dispute against an adoption or custody.
   * Rate-limited to 5 per hour per user.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Open a dispute against an adoption or custody entity' })
  @ApiBody({ type: CreateDisputeDto })
  @ApiResponse({ status: 201, description: 'Dispute opened' })
  @ApiResponse({ status: 404, description: 'Entity not found or caller is not a party' })
  @ApiResponse({ status: 409, description: 'Duplicate open dispute (DISPUTE_ALREADY_OPEN)' })
  create(
    @Body() dto: CreateDisputeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.disputes.create(dto, user.userId);
  }

  /**
   * GET /disputes/:id
   * Retrieve a dispute with paginated comments.
   * Internal admin notes are hidden for non-admins.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a dispute with its comments' })
  @ApiParam({ name: 'id', description: 'Dispute ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Dispute with comments' })
  @ApiResponse({ status: 403, description: 'Not a party to this dispute' })
  @ApiResponse({ status: 404, description: 'Dispute not found' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.disputes.findOne(id, user.userId, user.role, page, limit);
  }

  /**
   * POST /disputes/:id/comments
   * Add a comment to an open dispute.
   * Closed disputes return 409.
   */
  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a comment to a dispute' })
  @ApiParam({ name: 'id', description: 'Dispute ID' })
  @ApiBody({ type: AddDisputeCommentDto })
  @ApiResponse({ status: 201, description: 'Comment added' })
  @ApiResponse({ status: 403, description: 'Not a party to this dispute' })
  @ApiResponse({ status: 404, description: 'Dispute not found' })
  @ApiResponse({ status: 409, description: 'Cannot comment on a resolved dispute' })
  addComment(
    @Param('id') id: string,
    @Body() dto: AddDisputeCommentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.disputes.addComment(id, dto, user.userId, user.role);
  }
}

@ApiTags('admin/disputes')
@ApiBearerAuth('JWT-auth')
@Controller('admin/disputes')
@UseGuards(JwtAuthGuard)
export class AdminDisputesController {
  constructor(private readonly resolution: DisputeResolutionService) {}

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a dispute to an admin for review' })
  @ApiParam({ name: 'id', description: 'Dispute ID' })
  @ApiResponse({ status: 200, description: 'Dispute moved to UNDER_REVIEW' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  @ApiResponse({ status: 409, description: 'DISPUTE_INVALID_TRANSITION' })
  assign(
    @Param('id') id: string,
    @Body() dto: AssignDisputeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.resolution.assignAdmin(id, dto.adminId, user.role);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a dispute with an outcome and written resolution' })
  @ApiParam({ name: 'id', description: 'Dispute ID' })
  @ApiResponse({ status: 200, description: 'Dispute resolved' })
  @ApiResponse({ status: 400, description: 'Validation error or bad outcome' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  @ApiResponse({ status: 500, description: 'On-chain settlement failed (RESOLUTION_PENDING)' })
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeAdminDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.resolution.resolve(id, dto, user.userId, user.role);
  }

  @Post(':id/retry-settlement')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry escrow settlement for a RESOLUTION_PENDING dispute' })
  @ApiParam({ name: 'id', description: 'Dispute ID' })
  @ApiResponse({ status: 200, description: 'Settlement succeeded; dispute RESOLVED' })
  @ApiResponse({ status: 400, description: 'Not in RESOLUTION_PENDING state' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  retrySettlement(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.resolution.retrySettlement(id, user.userId, user.role);
  }
}
