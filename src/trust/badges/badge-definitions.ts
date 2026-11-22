import type { BadgeCode, Prisma } from '@prisma/client';

export interface BadgeDefinitionSeed {
  code: BadgeCode;
  name: string;
  description: string;
  criteria: Prisma.InputJsonValue;
}

/**
 * Rule-based badge catalogue. The rules themselves live in
 * `BadgeRulesService`; this table only carries the public metadata so new
 * badges can be described and deactivated without a code change.
 */
export const BADGE_DEFINITIONS: BadgeDefinitionSeed[] = [
  {
    code: 'ID_VERIFIED',
    name: 'ID verified',
    description:
      'Identity anchored to a verified Stellar account that the user controls.',
    criteria: { requiresStellarPublicKey: true },
  },
  {
    code: 'TRUSTED_ADOPTER',
    name: 'Trusted adopter',
    description:
      'At least 3 completed adoption or custody agreements and a trust score of 80 or more.',
    criteria: { minCompletedAgreements: 3, minTrustScore: 80 },
  },
  {
    code: 'VERIFIED_SHELTER',
    name: 'Verified shelter',
    description: 'Registered shelter account in good standing.',
    criteria: { role: 'SHELTER' },
  },
  {
    code: 'CLEAN_RECORD_12M',
    name: 'Clean record (12 months)',
    description:
      'Account older than 12 months with no custody violations or suspensions in the last 12 months.',
    criteria: { cleanRecordMonths: 12 },
  },
];
