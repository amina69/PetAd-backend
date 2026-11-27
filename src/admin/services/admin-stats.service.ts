import { Injectable } from '@nestjs/common';
import {
  AdoptionStatus,
  EscrowStatus,
  DocumentVerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ADMIN_STATS_CACHE_TTL_MS,
  TtlCacheService,
} from '../../common/cache/ttl-cache.service';
import { AdminStatSection } from '../dto/admin-stats-query.dto';
import {
  AdminStatsDto,
  NEW_USERS_WINDOW_DAYS,
} from '../dto/admin-stats-response.dto';

export type AdminStatsSnapshot = Partial<AdminStatsDto> & {
  generatedAt: string;
};

const SECTION_LOADERS = {
  pendingApprovals: (prisma: PrismaService) =>
    prisma.adoption.count({
      where: {
        status: { in: [AdoptionStatus.REQUESTED, AdoptionStatus.PENDING] },
      },
    }),
  openDisputes: (prisma: PrismaService) =>
    prisma.escrow.count({ where: { status: EscrowStatus.DISPUTED } }),
  documentsAwaitingVerification: (prisma: PrismaService) =>
    prisma.document.count({
      where: { verificationStatus: DocumentVerificationStatus.PENDING },
    }),
  newUsers: (prisma: PrismaService, since: Date) =>
    prisma.user.count({
      where: { createdAt: { gte: since }, deletedAt: null },
    }),
} satisfies {
  [K in AdminStatSection]: (
    prisma: PrismaService,
    since: Date,
  ) => Promise<number>;
};

@Injectable()
export class AdminStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
  ) {}

  async getStats(
    sections: readonly AdminStatSection[],
  ): Promise<AdminStatsSnapshot> {
    const orderedSections = [...new Set(sections)].sort();
    const cacheKey = `admin-stats:${orderedSections.join(',')}`;

    return this.cache.wrap(cacheKey, ADMIN_STATS_CACHE_TTL_MS, async () => {
      const since = new Date(
        Date.now() - NEW_USERS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      );

      const results = await Promise.all(
        orderedSections.map(async (section) => {
          const loader = SECTION_LOADERS[section];
          const value = await loader(this.prisma, since);
          return [section, value] as const;
        }),
      );

      const snapshot: AdminStatsSnapshot = {
        ...(Object.fromEntries(results) as Partial<AdminStatsDto>),
        ...(orderedSections.includes('newUsers')
          ? { since: since.toISOString() }
          : {}),
        generatedAt: new Date().toISOString(),
      };

      return snapshot;
    });
  }
}
