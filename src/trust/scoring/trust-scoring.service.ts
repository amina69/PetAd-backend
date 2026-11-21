import { Inject, Injectable } from '@nestjs/common';
import { calculateTrustScore } from './calculate-trust-score';
import { DEFAULT_TRUST_SCORING_CONFIG } from './trust-scoring.config';
import type {
  TrustScoringConfig,
  TrustScoringEvent,
  TrustScoreResult,
} from './trust-scoring.types';

export const TRUST_SCORING_CONFIG = Symbol('TRUST_SCORING_CONFIG');

@Injectable()
export class TrustScoringService {
  constructor(
    @Inject(TRUST_SCORING_CONFIG)
    private readonly config: TrustScoringConfig = DEFAULT_TRUST_SCORING_CONFIG,
  ) {}

  get version(): string {
    return this.config.version;
  }

  get configSnapshot(): TrustScoringConfig {
    return {
      ...this.config,
      weights: { ...this.config.weights },
    };
  }

  calculate(
    events: readonly TrustScoringEvent[],
    asOf: Date | string = new Date(),
  ): TrustScoreResult {
    return calculateTrustScore(events, this.config, asOf);
  }
}
