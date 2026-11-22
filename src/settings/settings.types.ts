import { BadRequestException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { CustodyFeesValueDto, TrustPolicyValueDto } from './settings.dto';

export enum SettingKey {
  TRUST_POLICY = 'TRUST_POLICY',
  CUSTODY_FEES = 'CUSTODY_FEES',
}

export interface SettingValues {
  [SettingKey.TRUST_POLICY]: TrustPolicyValueDto;
  [SettingKey.CUSTODY_FEES]: CustodyFeesValueDto;
}

export interface SettingRecord<K extends SettingKey> {
  key: K;
  value: SettingValues[K];
  version: number;
  actorId: string;
  updatedAt: Date;
}

const fields: Record<SettingKey, readonly string[]> = {
  [SettingKey.TRUST_POLICY]: [
    'minimumCustodyTrustScore',
    'lowScoreThreshold',
    'lowScoreDepositMultiplier',
    'manualReviewThreshold',
    'newAccountAgeDays',
    'newAccountRequestCap24h',
  ],
  [SettingKey.CUSTODY_FEES]: [
    'dailyRateMinor',
    'serviceFeePercentage',
    'baseDepositMinor',
  ],
};

export function assertSettingKey(key: unknown): asserts key is SettingKey {
  if (key !== SettingKey.TRUST_POLICY && key !== SettingKey.CUSTODY_FEES) {
    throw new BadRequestException('Unsupported setting key');
  }
}

/** Validate on every read and write; never coerce, strip fields, or fill defaults. */
export function validateSettingValue<K extends SettingKey>(
  key: K,
  value: unknown,
): SettingValues[K] {
  assertSettingKey(key);
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new BadRequestException(`${key} must be a JSON object`);
  }
  const keys = Object.keys(value);
  const expected = fields[key];
  if (keys.length !== expected.length || keys.some((name) => !expected.includes(name))) {
    throw new BadRequestException(`${key} must contain exactly: ${expected.join(', ')}`);
  }
  const dto = key === SettingKey.TRUST_POLICY
    ? new TrustPolicyValueDto()
    : new CustodyFeesValueDto();
  Object.assign(dto, value);
  const errors = validateSync(dto, { forbidUnknownValues: true });
  if (errors.length) {
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new BadRequestException(`Invalid ${key}: ${messages.join('; ')}`);
  }
  // Copy only the validated own properties; preserve decimal spelling exactly.
  return { ...value } as SettingValues[K];
}
