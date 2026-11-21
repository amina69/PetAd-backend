import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeeScheduleService } from './fee-schedule.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import { CreateFeeScheduleDto } from './dto/create-fee-schedule.dto';

describe('FeeScheduleService', () => {
  let service: FeeScheduleService;

  const mockPrisma = {
    feeSchedule: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  const mockLogging = { log: jest.fn() };

  const dto: CreateFeeScheduleDto = {
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    platformFeeBps: 500,
    minimumFee: 2,
    latePenaltyBps: 1000,
    depositRules: { DOG: { LARGE: { amount: 40 } } },
    dailyCustodyRates: { DOG: { LARGE: { amount: 5 } } },
    cancellationLeadTimes: { DEFAULT: { hours: 24 } },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.feeSchedule.findFirst.mockResolvedValue(null);
    mockPrisma.feeSchedule.create.mockImplementation(async ({ data }) => ({
      id: 'schedule-new',
      ...data,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeScheduleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn(() => 60) } },
        { provide: LoggingService, useValue: mockLogging },
      ],
    }).compile();

    service = module.get(FeeScheduleService);
  });

  it('creates a new version and never edits an existing one', async () => {
    mockPrisma.feeSchedule.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: 7 });

    const created = await service.create(dto, 'admin-1');

    expect(created.version).toBe(8);
    expect(mockPrisma.feeSchedule.update).toBeUndefined();
    expect(mockPrisma.feeSchedule.create).toHaveBeenCalledTimes(1);
    expect(mockLogging.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FEE_SCHEDULE_CREATED' }),
    );
  });

  it('rejects overlapping effective dates', async () => {
    mockPrisma.feeSchedule.findFirst.mockResolvedValueOnce({
      id: 'existing',
      version: 3,
    });

    await expect(service.create(dto)).rejects.toThrow(ConflictException);
    expect(mockPrisma.feeSchedule.create).not.toHaveBeenCalled();
  });

  it('rejects an inverted effective range', async () => {
    await expect(
      service.create({ ...dto, effectiveTo: '2025-01-01T00:00:00.000Z' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('caches the effective schedule and invalidates it after a change', async () => {
    const oldSchedule = { id: 'old', effectiveFrom: new Date('2025-01-01') };
    mockPrisma.feeSchedule.findFirst.mockResolvedValue(oldSchedule);

    const at = new Date('2026-06-01T00:00:00.000Z');
    await service.findEffective(at);
    await service.findEffective(at);
    expect(mockPrisma.feeSchedule.findFirst).toHaveBeenCalledTimes(1);

    service.invalidateCache();
    await service.findEffective(at);
    expect(mockPrisma.feeSchedule.findFirst).toHaveBeenCalledTimes(2);
  });
});
