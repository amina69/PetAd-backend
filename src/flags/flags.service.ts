import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FeatureFlag, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '../logging/logging.service';
import {
  FEATURE_FLAGS_CACHE_TTL_MS,
  TtlCacheService,
} from '../common/cache/ttl-cache.service';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';

const BUCKETS = 10_000;
const CACHE_PREFIX = 'flags:';

export interface FlagCaller {
  userId?: string;
  role?: string;
}

@Injectable()
export class FlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly cache: TtlCacheService,
  ) {}

  async evaluate(
    caller: FlagCaller,
    requestedKeys?: readonly string[],
  ): Promise<Record<string, boolean>> {
    const keys = requestedKeys
      ? [
          ...new Set(requestedKeys.map((key) => key.trim()).filter(Boolean)),
        ].sort()
      : undefined;
    const keySuffix = keys ? keys.join(',') : '*';
    const cacheKey = `${CACHE_PREFIX}${caller.userId ?? 'anonymous'}:${caller.role ?? 'none'}:${keySuffix}`;

    return this.cache.wrap(cacheKey, FEATURE_FLAGS_CACHE_TTL_MS, async () => {
      const flags = await this.prisma.featureFlag.findMany({
        ...(keys ? { where: { key: { in: keys } } } : {}),
        orderBy: { key: 'asc' },
      });

      return Object.fromEntries(
        flags.map((flag) => [
          flag.key,
          this.isEnabledFor(flag, caller.userId, caller.role),
        ]),
      );
    });
  }

  async findAll(): Promise<FeatureFlag[]> {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async create(
    dto: CreateFeatureFlagDto,
    actorId: string,
  ): Promise<FeatureFlag> {
    const flag = await this.prisma.featureFlag.create({
      data: {
        key: dto.key,
        enabled: dto.enabled ?? false,
        rolloutPercentage: dto.rolloutPercentage ?? 0,
        targetRoles: dto.targetRoles ?? [],
        description: dto.description,
      },
    });

    await this.audit('FEATURE_FLAG_CREATED', actorId, flag.key, {
      after: flag,
    });
    this.invalidateCache();
    return flag;
  }

  async update(
    key: string,
    dto: UpdateFeatureFlagDto,
    actorId: string,
  ): Promise<FeatureFlag> {
    const existing = await this.findByKey(key);

    const updated = await this.prisma.featureFlag.update({
      where: { key },
      data: {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.rolloutPercentage !== undefined
          ? { rolloutPercentage: dto.rolloutPercentage }
          : {}),
        ...(dto.targetRoles !== undefined
          ? { targetRoles: dto.targetRoles }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
      },
    });

    await this.audit('FEATURE_FLAG_UPDATED', actorId, key, {
      before: existing,
      after: updated,
    });
    this.invalidateCache();
    return updated;
  }

  async remove(key: string, actorId: string): Promise<FeatureFlag> {
    const existing = await this.findByKey(key);
    const deleted = await this.prisma.featureFlag.delete({ where: { key } });

    await this.audit('FEATURE_FLAG_DELETED', actorId, key, {
      before: existing,
    });
    this.invalidateCache();
    return deleted;
  }

  private async findByKey(key: string): Promise<FeatureFlag> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }
    return flag;
  }

  private isEnabledFor(
    flag: FeatureFlag,
    userId?: string,
    role?: string,
  ): boolean {
    if (!flag.enabled) return false;

    if (flag.targetRoles.length > 0) {
      if (!role || !flag.targetRoles.includes(role as UserRole)) return false;
    }

    if (!userId) return false;
    if (flag.rolloutPercentage >= 100) return true;
    if (flag.rolloutPercentage <= 0) return false;

    return (
      this.bucket(flag.key, userId) < flag.rolloutPercentage * (BUCKETS / 100)
    );
  }

  private bucket(flagKey: string, userId: string): number {
    return (
      createHash('sha256')
        .update(`${flagKey}:${userId}`)
        .digest()
        .readUInt16BE(0) % BUCKETS
    );
  }

  private async audit(
    action: string,
    actorId: string,
    key: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.loggingService.log({
      level: 'INFO',
      action,
      message: `Feature flag "${key}" ${action.toLowerCase().replace('feature_flag_', '')}`,
      userId: actorId,
      metadata: { key, ...details },
    });
  }

  private invalidateCache(): void {
    this.cache.deleteByPrefix(CACHE_PREFIX);
  }
}
