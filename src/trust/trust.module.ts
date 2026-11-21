import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TrustScoringWeights } from './scoring/trust-scoring.types';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import {
  DEFAULT_TRUST_SCORING_CONFIG,
  mergeTrustScoringConfig,
} from './scoring/trust-scoring.config';
import {
  TRUST_SCORING_CONFIG,
  TrustScoringService,
} from './scoring/trust-scoring.service';
import { TrustAnchorService } from './trust-anchor.service';
import { TrustEventMapperService } from './trust-event-mapper.service';
import { TrustProofService } from './trust-proof.service';
import { TrustProjectionService } from './trust-projection.service';
import { TrustScoreService } from './trust-score.service';
import { TrustProfileService } from './trust-profile.service';
import { TrustRecomputeScheduler } from './trust-recompute.scheduler';
import { TrustController } from './trust.controller';
import { TrustAdminController } from './trust-admin.controller';
import { VerificationController } from './verification.controller';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [TrustController, TrustAdminController, VerificationController],
  providers: [
    {
      provide: TRUST_SCORING_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const prefix = 'trust.scoring';
        return mergeTrustScoringConfig({
          version: config.get<string>(
            `${prefix}.version`,
            DEFAULT_TRUST_SCORING_CONFIG.version,
          ),
          baseScore: config.get<number>(
            `${prefix}.baseScore`,
            DEFAULT_TRUST_SCORING_CONFIG.baseScore,
          ),
          halfLifeDays: config.get<number>(
            `${prefix}.halfLifeDays`,
            DEFAULT_TRUST_SCORING_CONFIG.halfLifeDays,
          ),
          minimumVolume: config.get<number>(
            `${prefix}.minimumVolume`,
            DEFAULT_TRUST_SCORING_CONFIG.minimumVolume,
          ),
          diminishingRate: config.get<number>(
            `${prefix}.diminishingRate`,
            DEFAULT_TRUST_SCORING_CONFIG.diminishingRate,
          ),
          weights: Object.fromEntries(
            Object.entries(DEFAULT_TRUST_SCORING_CONFIG.weights).map(
              ([key, fallback]) => {
                const configured = config.get<number>(
                  `${prefix}.weights.${key}`,
                );
                return [
                  key,
                  typeof configured === 'number' ? configured : fallback,
                ];
              },
            ),
          ) as TrustScoringWeights,
        });
      },
    },
    TrustScoringService,
    TrustAnchorService,
    TrustEventMapperService,
    TrustProofService,
    TrustScoreService,
    TrustProjectionService,
    TrustProfileService,
    TrustRecomputeScheduler,
  ],
  exports: [
    TrustScoringService,
    TrustProofService,
    TrustProjectionService,
    TrustScoreService,
  ],
})
export class TrustModule {}
