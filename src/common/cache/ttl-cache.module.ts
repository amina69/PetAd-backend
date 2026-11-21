import { Global, Module } from '@nestjs/common';
import { TtlCacheService } from './ttl-cache.service';

@Global()
@Module({
  providers: [TtlCacheService],
  exports: [TtlCacheService],
})
export class TtlCacheModule {}
