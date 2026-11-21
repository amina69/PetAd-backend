import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrustProofService } from './trust-proof.service';
import { TrustScoreService } from './trust-score.service';
import { TrustScoreFactorDto } from './dto/trust.dto';

export interface TrustViewer {
  id?: string;
  userId?: string;
  sub?: string;
}

function viewerId(viewer?: TrustViewer): string | null {
  return viewer?.userId ?? viewer?.sub ?? viewer?.id ?? null;
}

@Injectable()
export class TrustProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scores: TrustScoreService,
    private readonly proofs: TrustProofService,
  ) {}

  async getProfile(userId: string, viewer?: TrustViewer) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        stellarPublicKey: true,
        trustScore: true,
        status: true,
        deletedAt: true,
      },
    });

    if (
      !user ||
      user.status === 'SUSPENDED' ||
      user.status === 'DELETED' ||
      user.deletedAt
    ) {
      throw new NotFoundException('User not found');
    }

    let snapshot = await this.prisma.trustScore.findUnique({
      where: { userId },
    });
    if (!snapshot) {
      await this.scores.recomputeUser(userId);
      snapshot = await this.prisma.trustScore.findUnique({
        where: { userId },
      });
    }

    if (!snapshot) {
      throw new NotFoundException('Trust profile is not available');
    }

    const trustEvents = await this.prisma.trustEvent.findMany({
      where: { subjectUserId: userId },
      select: { sourceEventId: true },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const proof = await this.proofs.buildBundle(snapshot, trustEvents);
    const isOwner = viewerId(viewer) === userId;
    const badges = this.buildBadges(
      user.role,
      user.stellarPublicKey,
      snapshot.score,
    );

    const profile: Record<string, unknown> = {
      id: user.id,
      band: snapshot.band,
      badges,
      completedAgreements: snapshot.completedAgreements,
      disputes: {
        total: snapshot.disputesTotal,
        resolvedInFavour: snapshot.disputesResolvedInFavour,
      },
      anchoredThrough: proof.anchoredThrough,
      proof,
      isOwner,
    };

    if (isOwner) {
      profile.score = snapshot.score;
      profile.algorithmVersion = snapshot.algorithmVersion;
      profile.calculatedAt = snapshot.calculatedAt.toISOString();
      profile.factors = snapshot.factors as unknown as TrustScoreFactorDto[];
    }

    return profile;
  }

  private buildBadges(
    role: string,
    stellarPublicKey: string | null,
    score: number,
  ): string[] {
    const badges: string[] = [];
    if (role === 'SHELTER') badges.push('VERIFIED_SHELTER');
    if (stellarPublicKey) badges.push('STELLAR_VERIFIED');
    if (score >= 80) badges.push('TOP_RATED');
    return badges;
  }
}
