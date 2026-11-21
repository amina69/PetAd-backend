import { Test, TestingModule } from '@nestjs/testing';
import { FeeCalculationService } from './fee-calculation.service';
import { FeeScheduleService } from './fee-schedule.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FeeSchedule } from '@prisma/client';

function schedule(overrides: Partial<FeeSchedule> = {}): FeeSchedule {
  return {
    id: 'schedule-v1',
    version: 1,
    effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
    effectiveTo: new Date('2026-01-01T00:00:00.000Z'),
    platformFeeBps: 500,
    minimumFee: { toNumber: () => 2 } as never,
    currency: 'XLM',
    latePenaltyBps: 1000,
    depositRules: { DOG: { LARGE: { amount: 40 } } },
    dailyCustodyRates: { DOG: { LARGE: { amount: 5 } } },
    cancellationLeadTimes: { DEFAULT: { hours: 24 } },
    notes: null,
    createdBy: 'admin-1',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  } as FeeSchedule;
}

describe('FeeCalculationService', () => {
  let service: FeeCalculationService;
  const mockPrisma = { feeSchedule: { findUnique: jest.fn() } };
  const mockSchedules = { findEffective: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeCalculationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FeeScheduleService, useValue: mockSchedules },
      ],
    }).compile();
    service = module.get(FeeCalculationService);
  });

  it('applies the minimum fee when the percentage is smaller', () => {
    const result = service.calculate({ schedule: schedule(), amount: 10 });

    expect(result.platformFee).toBe(2);
    expect(result.minimumFeeApplied).toBe(true);
    expect(result.total).toBe(2);
  });

  it('applies species/size deposit, custody and late-cancellation rules', () => {
    const result = service.calculate({
      schedule: schedule(),
      amount: 1000,
      species: 'DOG',
      size: 'LARGE',
      custodyDays: 3,
      cancellationLeadHours: 2,
    });

    expect(result.platformFee).toBe(50);
    expect(result.deposit).toBe(40);
    expect(result.custodyFee).toBe(15);
    expect(result.cancellationPenalty).toBe(100);
    expect(result.total).toBe(165);
  });

  it('settles using the schedule pinned to the agreement, not a later version', async () => {
    const original = schedule({ id: 'v1', version: 1 });
    const replacement = schedule({
      id: 'v2',
      version: 2,
      platformFeeBps: 900,
      effectiveFrom: new Date('2026-01-02T00:00:00.000Z'),
    });
    mockPrisma.feeSchedule.findUnique.mockResolvedValue(original);
    mockSchedules.findEffective.mockResolvedValue(replacement);

    const resolved = await service.resolveForAgreement(
      'v1',
      new Date('2025-06-01T00:00:00.000Z'),
    );
    const settlement = service.calculate({ schedule: resolved, amount: 1000 });

    expect(settlement.scheduleVersion).toBe(1);
    expect(settlement.platformFee).toBe(50);
    expect(mockSchedules.findEffective).not.toHaveBeenCalled();
  });

  it('falls back to the schedule effective at agreement creation for legacy rows', async () => {
    const legacy = schedule();
    mockSchedules.findEffective.mockResolvedValue(legacy);

    const resolved = await service.resolveForAgreement(
      null,
      new Date('2025-06-01T00:00:00.000Z'),
    );

    expect(resolved.id).toBe('schedule-v1');
    expect(mockSchedules.findEffective).toHaveBeenCalledWith(
      new Date('2025-06-01T00:00:00.000Z'),
    );
  });
});
