import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AntiAbuseService } from './anti-abuse.service';
import { hashTrustSignal } from './utils/signal-hash.util';

export interface CreateReviewInput {
  revieweeId: string;
  rating: number;
  comment?: string;
  agreementId?: string;
  deviceId?: string;
  ip?: string;
}

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly antiAbuse: AntiAbuseService,
    private readonly configService: ConfigService,
  ) {}

  async create(reviewerId: string, input: CreateReviewInput) {
    if (reviewerId === input.revieweeId) {
      throw new BadRequestException('You cannot review yourself');
    }
    if (input.rating < 1 || input.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    const reviewee = await this.prisma.user.findUnique({
      where: { id: input.revieweeId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!reviewee || reviewee.deletedAt) {
      throw new NotFoundException('Reviewee not found');
    }

    const [adoptions, custodies] = await Promise.all([
      this.prisma.adoption.count({
        where: {
          OR: [
            { adopterId: reviewerId, ownerId: input.revieweeId },
            { adopterId: input.revieweeId, ownerId: reviewerId },
          ],
        },
      }),
      this.prisma.custody.count({
        where: { holderId: { in: [reviewerId, input.revieweeId] } },
      }),
    ]);

    if (adoptions === 0 && custodies === 0) {
      throw new BadRequestException(
        'A completed agreement with this user is required before reviewing',
      );
    }

    const salt = this.configService.get<string>('trustAbuse.signalSalt') ?? 'petad-trust-signals';
    const review = await this.prisma.review.create({
      data: {
        reviewerId,
        revieweeId: input.revieweeId,
        rating: input.rating,
        comment: input.comment,
        agreementId: input.agreementId,
        deviceHash: hashTrustSignal(input.deviceId, salt),
        ipHash: hashTrustSignal(input.ip, salt),
      },
    });

    await this.antiAbuse.evaluateReview(review.id);
    return this.prisma.review.findUnique({ where: { id: review.id } });
  }

  async listForUser(userId: string) {
    return this.prisma.review.findMany({
      where: {
        revieweeId: userId,
        status: { not: 'HIDDEN' },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
