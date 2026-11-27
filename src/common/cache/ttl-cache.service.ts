import { Injectable } from '@nestjs/common';
import { TtlCache } from './ttl-cache';

@Injectable()
export class TtlCacheService extends TtlCache {}

export const ADMIN_STATS_CACHE_TTL_MS = 30_000;
export const FEATURE_FLAGS_CACHE_TTL_MS = 30_000;
