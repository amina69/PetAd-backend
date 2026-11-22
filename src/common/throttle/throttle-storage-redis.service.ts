import {
  ThrottlerStorage,
  ThrottlerModuleOptions,
  ThrottlerStorageRecord,
} from '@nestjs/throttler';
import { Redis } from 'ioredis';

/**
 * Redis-backed throttle storage service.
 * Enables shared rate limits across application instances.
 */
export class ThrottlerStorageRedisService implements ThrottlerStorage {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async getKey(limit: string, key: string): Promise<number> {
    const count = await this.redis.get(`throttle:${limit}:${key}`);
    if (count === null) {
      return 0;
    }
    return parseInt(count, 10);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration?: number,
    throttlerName?: string,
  ): Promise<ThrottlerStorageRecord> {
    const result = await this.redis.incr(`throttle:${throttlerName}:${key}`);
    if (result === 1) {
      await this.redis.expire(`throttle:${throttlerName}:${key}`, ttl);
    }
    return { current: result, limit, ttl };
  }

  async reset(limit: string, key: string): Promise<void> {
    await this.redis.del(`throttle:${limit}:${key}`);
  }
}