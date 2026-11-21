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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ReviewAgreementType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CreateReviewDto,
  CreateReviewReportDto,
  CreateReviewResponseDto,
  ListReviewsQueryDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';

interface AuthRequest {
  user?: { sub?: string; userId?: string };
}

@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('custody/:id/review')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Review a completed custody agreement' })
  @ApiCreatedResponse({ description: 'Review created' })
  createCustodyReview(
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
    @Req() request: AuthRequest,
  ) {
    return this.reviews.createReview(
      this.userId(request),
      ReviewAgreementType.CUSTODY,
      id,
      dto,
    );
  }

  @Post('adoption/:id/review')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Review a completed adoption agreement' })
  @ApiCreatedResponse({ description: 'Review created' })
  createAdoptionReview(
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
    @Req() request: AuthRequest,
  ) {
    return this.reviews.createReview(
      this.userId(request),
      ReviewAgreementType.ADOPTION,
      id,
      dto,
    );
  }

  @Get('users/:id/reviews')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOkResponse({ description: 'Paginated reviews with summary' })
  listReviews(@Param('id') id: string, @Query() query: ListReviewsQueryDto) {
    return this.reviews.listForUser(id, query);
  }

  @Post('reviews/:id/response')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Respond to a review about you' })
  respond(
    @Param('id') id: string,
    @Body() dto: CreateReviewResponseDto,
    @Req() request: AuthRequest,
  ) {
    return this.reviews.respond(id, this.userId(request), dto);
  }

  @Post('reviews/:id/report')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Report an abusive review' })
  report(
    @Param('id') id: string,
    @Body() dto: CreateReviewReportDto,
    @Req() request: AuthRequest,
  ) {
    return this.reviews.report(id, this.userId(request), dto);
  }

  private userId(request: AuthRequest): string {
    return request.user?.userId ?? request.user?.sub ?? '';
  }
}
