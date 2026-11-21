import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeeSchedule, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '../../logging/logging.service';
import {
  CreateFeeScheduleDto,
  FeeRuleMap,
  FeeRuleValue,
} from './dto/create-fee-schedule.dto';

const FAR_FUTURE = new Date('9999-12-31T23:59:59.999Z');

@Injectable()
export class FeeScheduleService {
  private readonly logger = new Logger(FeeScheduleService.name);
  private cached: {
    key: string;
    schedule: FeeSchedule | null;
    expiresAt: number;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logging: LoggingService,
  ) {}

  async findById(id: string): Promise<FeeSchedule> {
    const schedule = await this.prisma.feeSchedule.findUnique({
      where: { id },
    });
    if (!schedule) {
      throw new NotFoundException(`Fee schedule ${id} not found`);
    }
    return schedule;
  }

  async findAll(): Promise<FeeSchedule[]> {
    return this.prisma.feeSchedule.findMany({
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Resolve the schedule in force at a point in time. Results are cached
   * briefly; creating a schedule always invalidates the cache.
   */
  async findEffective(at: Date = new Date()): Promise<FeeSchedule | null> {
    const key = at.toISOString();
    if (
      this.cached &&
      this.cached.key === key &&
      this.cached.expiresAt > Date.now()
    ) {
      return this.cached.schedule;
    }

    const schedule = await this.prisma.feeSchedule.findFirst({
      where: {
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const ttlSeconds =
      this.configService.get<number>('fees.cacheTtlSeconds') ?? 60;
    this.cached = {
      key,
      schedule,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };

    return schedule;
  }

  /**
   * Create a new, immutable version. Edits in place are intentionally not
   * supported: historical agreements must keep the schedule they started with.
   */
  async create(
    dto: CreateFeeScheduleDto,
    adminId?: string,
  ): Promise<FeeSchedule> {
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;

    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid date');
    }
    if (effectiveTo && Number.isNaN(effectiveTo.getTime())) {
      throw new BadRequestException('effectiveTo must be a valid date');
    }
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException(
        'effectiveTo must be later than effectiveFrom',
      );
    }

    this.validateRuleMap(dto.depositRules, 'depositRules');
    this.validateRuleMap(dto.dailyCustodyRates, 'dailyCustodyRates');
    this.validateRuleMap(dto.cancellationLeadTimes, 'cancellationLeadTimes');

    let schedule: FeeSchedule | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        schedule = await this.prisma.$transaction(async (tx) => {
          const overlapping = await tx.feeSchedule.findFirst({
            where: {
              effectiveFrom: { lt: effectiveTo ?? FAR_FUTURE },
              OR: [
                { effectiveTo: null },
                { effectiveTo: { gt: effectiveFrom } },
              ],
            },
            select: { id: true, version: true },
          });

          if (overlapping) {
            throw new ConflictException(
              `Fee schedule overlaps version ${overlapping.version} (${overlapping.id})`,
            );
          }

          const latest = await tx.feeSchedule.findFirst({
            orderBy: { version: 'desc' },
            select: { version: true },
          });

          return tx.feeSchedule.create({
            data: {
              version: (latest?.version ?? 0) + 1,
              effectiveFrom,
              effectiveTo,
              platformFeeBps: dto.platformFeeBps,
              minimumFee: dto.minimumFee,
              currency: dto.currency ?? 'XLM',
              latePenaltyBps: dto.latePenaltyBps,
              depositRules: dto.depositRules as object,
              dailyCustodyRates: dto.dailyCustodyRates as object,
              cancellationLeadTimes: dto.cancellationLeadTimes as object,
              notes: dto.notes,
              createdBy: adminId,
            },
          });
        });
        break;
      } catch (error) {
        const isVersionRace =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (isVersionRace && attempt < 2) continue;
        throw error;
      }
    }

    if (!schedule) {
      throw new ConflictException('Could not allocate a fee schedule version');
    }

    this.invalidateCache();
    await this.logging.log({
      level: 'INFO',
      action: 'FEE_SCHEDULE_CREATED',
      message: `Created fee schedule version ${schedule.version}`,
      userId: adminId,
      metadata: {
        scheduleId: schedule.id,
        version: schedule.version,
        effectiveFrom: schedule.effectiveFrom.toISOString(),
        effectiveTo: schedule.effectiveTo?.toISOString() ?? null,
      },
    });

    return schedule;
  }

  invalidateCache(): void {
    this.cached = null;
  }

  private validateRuleMap(map: FeeRuleMap, field: string): void {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      throw new BadRequestException(`${field} must be an object`);
    }

    for (const value of Object.values(map) as FeeRuleValue[]) {
      if (value === null || typeof value !== 'object') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new BadRequestException(`${field} contains an invalid rule`);
        }
        continue;
      }
      if (Array.isArray(value)) {
        throw new BadRequestException(`${field} contains an invalid rule`);
      }
      for (const nested of Object.values(
        value as Record<string, FeeRuleValue>,
      )) {
        this.validateRuleValue(nested, field);
      }
    }
  }

  private validateRuleValue(value: FeeRuleValue, field: string): void {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) {
        throw new BadRequestException(
          `${field} contains an invalid rule value`,
        );
      }
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${field} contains an invalid rule value`);
    }
    for (const key of ['amount', 'hours', 'rateBps'] as const) {
      const candidate = value[key];
      if (
        candidate !== undefined &&
        (!Number.isFinite(candidate) || candidate < 0)
      ) {
        throw new BadRequestException(
          `${field} contains an invalid ${key} rule value`,
        );
      }
    }
  }
}
