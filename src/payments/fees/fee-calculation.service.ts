import { Injectable, NotFoundException } from '@nestjs/common';
import { FeeSchedule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FeeRuleMap, FeeRuleValue } from './dto/create-fee-schedule.dto';
import { FeeScheduleService } from './fee-schedule.service';

export interface FeeCalculationInput {
  schedule: FeeSchedule;
  amount: number;
  currency?: string;
  species?: string;
  size?: string;
  custodyDays?: number;
  cancellationLeadHours?: number;
}

export interface FeeBreakdown {
  scheduleVersion: number;
  currency: string;
  platformFee: number;
  minimumFee: number;
  minimumFeeApplied: boolean;
  deposit: number;
  custodyFee: number;
  cancellationPenalty: number;
  total: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

function asRule(value: FeeRuleValue | undefined): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (typeof value === 'number') return { amount: value };
  return value as Record<string, number>;
}

function isDirectRule(value: FeeRuleValue): boolean {
  if (typeof value === 'number') return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['amount', 'hours', 'rateBps', 'currency'].some((key) => key in value);
}

function normalizeRule(value: FeeRuleValue | undefined): Record<string, number> {
  if (value === undefined || value === null) return {};
  return asRule(value);
}

function lookupRule(
  map: FeeRuleMap,
  species?: string,
  size?: string,
): Record<string, number> {
  if (!map || typeof map !== 'object') return {};

  for (const candidate of [
    species ? map[species] : undefined,
    map.DEFAULT,
  ]) {
    if (candidate === undefined) continue;
    if (isDirectRule(candidate)) return normalizeRule(candidate);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const sized = (candidate as Record<string, FeeRuleValue>)[size ?? 'DEFAULT'];
      if (sized !== undefined) return normalizeRule(sized);
    }
  }

  return {};
}

@Injectable()
export class FeeCalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feeSchedules: FeeScheduleService,
  ) {}

  /**
   * Resolve the schedule pinned to an agreement. Escrows created before a fee
   * change keep their original `feeScheduleId`, so later changes cannot alter
   * what they owe. Fall back to the schedule effective at creation time for
   * legacy agreements created before this field existed.
   */
  async resolveForAgreement(
    feeScheduleId: string | null | undefined,
    createdAt: Date,
  ): Promise<FeeSchedule> {
    if (feeScheduleId) {
      const pinned = await this.prisma.feeSchedule.findUnique({
        where: { id: feeScheduleId },
      });
      if (!pinned) {
        throw new NotFoundException(`Fee schedule ${feeScheduleId} not found`);
      }
      return pinned;
    }

    const effective = await this.feeSchedules.findEffective(createdAt);
    if (!effective) {
      throw new NotFoundException(
        'No fee schedule was effective when the agreement was created',
      );
    }
    return effective;
  }

  calculate(input: FeeCalculationInput): FeeBreakdown {
    const { schedule } = input;
    const amount = round2(input.amount);
    const currency = input.currency ?? schedule.currency;
    const percentageFee = round2((amount * schedule.platformFeeBps) / 10000);
    const minimumFee = round2(toNumber(schedule.minimumFee));
    // Never charge more than the escrowed amount itself.
    const platformFee = round2(Math.max(percentageFee, Math.min(minimumFee, amount)));

    const depositRule = lookupRule(
      schedule.depositRules as unknown as FeeRuleMap,
      input.species,
      input.size,
    );
    const deposit = round2(
      depositRule.amount ??
        ((depositRule.rateBps ?? 0) * amount) / 10000,
    );

    const custodyRule = lookupRule(
      schedule.dailyCustodyRates as unknown as FeeRuleMap,
      input.species,
      input.size,
    );
    const dailyRate = custodyRule.amount ?? ((custodyRule.rateBps ?? 0) * amount) / 10000;
    const custodyFee = round2(dailyRate * (input.custodyDays ?? 0));

    const leadRule = lookupRule(
      schedule.cancellationLeadTimes as unknown as FeeRuleMap,
      input.species,
      input.size,
    );
    const requiredLeadHours = leadRule.hours ?? leadRule.amount ?? 0;
    const cancelledTooLate =
      input.cancellationLeadHours !== undefined &&
      input.cancellationLeadHours < requiredLeadHours;
    const cancellationPenalty = cancelledTooLate
      ? round2((amount * schedule.latePenaltyBps) / 10000)
      : 0;

    return {
      scheduleVersion: schedule.version,
      currency,
      platformFee,
      minimumFee,
      minimumFeeApplied: platformFee === minimumFee && minimumFee > percentageFee,
      deposit,
      custodyFee,
      cancellationPenalty,
      total: round2(platformFee + custodyFee + cancellationPenalty),
    };
  }
}
