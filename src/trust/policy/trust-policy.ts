import { assertSafeIntegerInRange, parseDepositMultiplier } from './decimal';

const DAY_MILLISECONDS = 86_400_000n;
// The entire range representable by JavaScript Date spans 200 million days.
const MAX_ACCOUNT_AGE_DAYS = 200_000_000;

export interface TrustPolicySettings {
  /** Scores are finite numbers in the application's 0–100 score range. */
  minimumCustodyTrustScore: number;
  /** Scores strictly below this threshold receive the configured multiplier. */
  lowScoreThreshold: number;
  /** Decimal string from 1 through 100, with at most 18 fractional digits. */
  lowScoreDepositMultiplier: string;
  /** Scores strictly below this threshold require manual review. */
  manualReviewThreshold: number;
  /** Accounts younger than this many elapsed 24-hour days are new. */
  newAccountAgeDays: number;
  /** Maximum prior requests in the rolling window; zero blocks new accounts. */
  newAccountRequestCap24h: number;
}

export type TrustRequestType = 'CUSTODY' | 'ADOPTION';

export interface TrustDecisionInput {
  requestType: TrustRequestType;
  trustScore: number;
  accountCreatedAt: Date;
  /** Caller-supplied evaluation time, so the policy is deterministic. */
  now: Date;
  /**
   * Authoritative timestamps of prior custody AND adoption requests for this
   * account, excluding the candidate request. Timestamps at now are included;
   * timestamps exactly 24 hours before now are excluded. Future times fail.
   */
  priorRequestTimes: readonly Date[];
}

export type TrustDecisionOutcome = 'ALLOW' | 'DENY' | 'MANUAL_REVIEW';
export type TrustReasonCode =
  | 'ELIGIBLE'
  | 'CUSTODY_SCORE_BELOW_MINIMUM'
  | 'NEW_ACCOUNT_REQUEST_CAP_REACHED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'LOW_SCORE_DEPOSIT_MULTIPLIER';

export interface TrustDecisionReason {
  code: TrustReasonCode;
  message: string;
}

export interface TrustPolicyDecision {
  outcome: TrustDecisionOutcome;
  reasons: TrustDecisionReason[];
  /** Canonical decimal string; use this value when calculating the deposit. */
  depositMultiplier: string;
  isNewAccount: boolean;
  recentRequestCount: number;
}

function assertScore(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be a finite number from 0 to 100`);
  }
}

function dateMilliseconds(value: unknown, name: string): bigint {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
  return BigInt(value.getTime());
}

/** Validate every setting; no setting has an implicit default. */
export function validateTrustPolicySettings(
  settings: TrustPolicySettings,
): void {
  if (!settings || typeof settings !== 'object') {
    throw new TypeError('Trust policy settings are required');
  }
  assertScore(settings.minimumCustodyTrustScore, 'minimumCustodyTrustScore');
  assertScore(settings.lowScoreThreshold, 'lowScoreThreshold');
  parseDepositMultiplier(settings.lowScoreDepositMultiplier);
  assertScore(settings.manualReviewThreshold, 'manualReviewThreshold');
  assertSafeIntegerInRange(
    settings.newAccountAgeDays,
    'newAccountAgeDays',
    0,
    MAX_ACCOUNT_AGE_DAYS,
  );
  assertSafeIntegerInRange(
    settings.newAccountRequestCap24h,
    'newAccountRequestCap24h',
    0,
  );
}

/**
 * Pure decision for the candidate request. Denial takes precedence over manual
 * review, but all applicable reasons are returned. A caller enforcing the cap
 * must gather both request types and atomically check/create the request.
 */
export function evaluateTrustPolicy(
  settings: TrustPolicySettings,
  input: TrustDecisionInput,
): TrustPolicyDecision {
  validateTrustPolicySettings(settings);
  if (!input || typeof input !== 'object') {
    throw new TypeError('Trust decision input is required');
  }
  if (input.requestType !== 'CUSTODY' && input.requestType !== 'ADOPTION') {
    throw new RangeError('requestType must be CUSTODY or ADOPTION');
  }
  assertScore(input.trustScore, 'trustScore');
  const now = dateMilliseconds(input.now, 'now');
  const createdAt = dateMilliseconds(
    input.accountCreatedAt,
    'accountCreatedAt',
  );
  if (createdAt > now) {
    throw new RangeError('accountCreatedAt cannot be in the future');
  }
  if (!Array.isArray(input.priorRequestTimes)) {
    throw new TypeError('priorRequestTimes must be an array');
  }

  let recentRequestCount = 0;
  for (const timestamp of input.priorRequestTimes) {
    const requestAt = dateMilliseconds(timestamp, 'priorRequestTimes entry');
    if (requestAt > now) {
      throw new RangeError('prior request timestamps cannot be in the future');
    }
    if (requestAt > now - DAY_MILLISECONDS) {
      recentRequestCount++;
    }
  }

  const isNewAccount =
    now - createdAt < BigInt(settings.newAccountAgeDays) * DAY_MILLISECONDS;
  const belowMinimum =
    input.requestType === 'CUSTODY' &&
    input.trustScore < settings.minimumCustodyTrustScore;
  const capReached =
    isNewAccount && recentRequestCount >= settings.newAccountRequestCap24h;
  const manualReview = input.trustScore < settings.manualReviewThreshold;
  const lowScore = input.trustScore < settings.lowScoreThreshold;
  const depositMultiplier = lowScore
    ? parseDepositMultiplier(settings.lowScoreDepositMultiplier).toFixed()
    : '1';
  const reasons: TrustDecisionReason[] = [];

  if (belowMinimum) {
    reasons.push({
      code: 'CUSTODY_SCORE_BELOW_MINIMUM',
      message: `Your trust score is below the minimum of ${settings.minimumCustodyTrustScore} required to request custody.`,
    });
  }
  if (capReached) {
    reasons.push({
      code: 'NEW_ACCOUNT_REQUEST_CAP_REACHED',
      message: `Your new account has reached its limit of ${settings.newAccountRequestCap24h} requests in 24 hours.`,
    });
  }
  if (manualReview) {
    reasons.push({
      code: 'MANUAL_REVIEW_REQUIRED',
      message:
        'Your trust score requires this request to undergo manual review.',
    });
  }
  if (lowScore && depositMultiplier !== '1') {
    reasons.push({
      code: 'LOW_SCORE_DEPOSIT_MULTIPLIER',
      message: `Your trust score increases the required deposit by a factor of ${depositMultiplier}.`,
    });
  }
  if (reasons.length === 0) {
    reasons.push({
      code: 'ELIGIBLE',
      message: 'Your request meets the trust policy.',
    });
  }

  return {
    outcome:
      belowMinimum || capReached
        ? 'DENY'
        : manualReview
          ? 'MANUAL_REVIEW'
          : 'ALLOW',
    reasons,
    depositMultiplier,
    isNewAccount,
    recentRequestCount,
  };
}
