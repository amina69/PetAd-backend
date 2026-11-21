import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CreateReviewDto } from './dto/review.dto';
import { ReviewService } from './review.service';
import { TrustScoreService } from './trust-score.service';

@ApiTags('trust')
@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewService,
    private readonly trustScore: TrustScoreService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a review; anti-abuse checks run automatically' })
  async create(
    @Body() dto: CreateReviewDto,
    @Req() req: Request,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const reviewer = user as unknown as { userId?: string; sub?: string } | undefined;
    const reviewerId = reviewer?.userId ?? reviewer?.sub;
    if (!reviewerId) {
      throw new UnauthorizedException(
        'Authenticated reviewer is missing from the request',
      );
    }

    return this.reviews.create(reviewerId, {
      ...dto,
      deviceId: req.header('x-device-id') ?? undefined,
      ip: req.ip,
    });
  }

  @Get('user/:userId')
  async listForUser(@Param('userId') userId: string) {
    return this.reviews.listForUser(userId);
  }

  @Get('score/:userId')
  async score(@Param('userId') userId: string) {
    const score = await this.trustScore.calculate(userId);
    return { userId, score };
  }
}
