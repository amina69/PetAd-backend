import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { ReviewModerationService } from './review-moderation.service';
import { ReportReviewDto } from './dto/report-review.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { ModerationQueueDto } from './dto/moderation-queue.dto';

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

@ApiTags('Reviews')
@ApiBearerAuth('JWT-auth')
@Controller('reviews')
export class ReviewModerationController {
  constructor(private readonly moderationService: ReviewModerationService) {}

  /**
   * POST /reviews/:id/report
   * Any authenticated user can report a review once.
   */
  @Post(':id/report')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Report a review',
    description:
      'A user can report the same review only once; duplicate reports are ' +
      'ignored and reported back as `duplicate: true`.',
  })
  @ApiParam({ name: 'id', description: 'Review ID' })
  @ApiResponse({ status: 201, description: 'Report queued for moderation' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  report(
    @Req() req: AuthRequest,
    @Param('id') reviewId: string,
    @Body() dto: ReportReviewDto,
  ) {
    return this.moderationService.report(reviewId, actorId(req), dto);
  }

  /**
   * GET /reviews/moderation/queue
   * Admin queue of reported reviews.
   */
  @Get('moderation/queue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Moderation queue of reported reviews (admin only)',
  })
  @ApiResponse({ status: 200, description: 'Paginated moderation queue' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin role required' })
  moderationQueue(@Query() query: ModerationQueueDto) {
    return this.moderationService.queue(query);
  }

  @Patch(':id/hide')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Hide a review (admin only)',
    description:
      'Hides the review, recomputes the subject’s rating summary and trust ' +
      'inputs, resolves open reports and notifies the author.',
  })
  @ApiParam({ name: 'id', description: 'Review ID' })
  @ApiResponse({ status: 200, description: 'Review hidden' })
  @ApiResponse({ status: 409, description: 'Review is already hidden' })
  hide(
    @Req() req: AuthRequest,
    @Param('id') reviewId: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.moderationService.hide(reviewId, actorId(req), dto.reason);
  }

  @Patch(':id/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Restore a hidden review (admin only)' })
  @ApiParam({ name: 'id', description: 'Review ID' })
  @ApiResponse({ status: 200, description: 'Review restored' })
  @ApiResponse({ status: 409, description: 'Review is already visible' })
  restore(
    @Req() req: AuthRequest,
    @Param('id') reviewId: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.moderationService.restore(reviewId, actorId(req), dto.reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Delete a review (admin only)',
    description:
      'Removes the review from public view but retains the row for audit.',
  })
  @ApiParam({ name: 'id', description: 'Review ID' })
  @ApiResponse({ status: 200, description: 'Review deleted' })
  @ApiResponse({ status: 409, description: 'Review is already deleted' })
  remove(
    @Req() req: AuthRequest,
    @Param('id') reviewId: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.moderationService.remove(reviewId, actorId(req), dto.reason);
  }
}
