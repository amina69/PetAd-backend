import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CachedSettingsProvider {
  private readonly logger = new Logger(CachedSettingsProvider.name);
  private cache: Map<string, { value: any; fetchedAt: number }> = new Map();
  private readonly TTL = 60000; // 1 minute local memory cache fallback

  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<any> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < this.TTL) {
      return cached.value;
    }

    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });

    let val: any;
    if (!setting) {
      // fallback defaults
      const defaults: Record<string, any> = {
        escrow_timeout_hours: 72,
        anchoring_threshold: 1000,
        trust_policy_min_score: 50,
        approval_rules_auto: false,
        upload_limit_mb: 10,
      };
      val = defaults[key];
    } else {
      try {
        val = JSON.parse(setting.value);
      } catch (e) {
        val = setting.value;
      }
    }

    this.cache.set(key, { value: val, fetchedAt: now });
    return val;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
    this.logger.log(`Cache invalidated for setting: ${key}`);
  }

  invalidateAll(): void {
    this.cache.clear();
    this.logger.log('All settings cache invalidated.');
  }
}
