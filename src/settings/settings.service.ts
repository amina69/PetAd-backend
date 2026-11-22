import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertSettingKey,
  SettingKey,
  SettingRecord,
  SettingValues,
  validateSettingValue,
} from './settings.types';

const MAX_VERSION = 2_147_483_647;

function auditInputs(actorId: string, reason: string): { actorId: string; reason: string } {
  if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 255) {
    throw new BadRequestException('An authenticated admin actor ID is required');
  }
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) {
    throw new BadRequestException('A nonblank reason of at most 2000 characters is required');
  }
  return { actorId: actorId.trim(), reason: reason.trim() };
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Always reads the database; callers must not cache the active setting. */
  async get<K extends SettingKey>(key: K): Promise<SettingRecord<K>> {
    assertSettingKey(key);
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!row) throw new ServiceUnavailableException(`System setting ${key} is not configured`);
    return this.toRecord(key, row);
  }

  /** Creates version 1 if absent, or appends the next version atomically. */
  async update<K extends SettingKey>(
    key: K,
    value: SettingValues[K],
    actorId: string,
    reason: string,
  ): Promise<SettingRecord<K>> {
    assertSettingKey(key);
    const validated = validateSettingValue(key, value);
    const audit = auditInputs(actorId, reason);
    return this.write(key, audit, async () => ({ value: validated, rollbackOfVersion: null }));
  }

  /** Restores the exact historical JSON as a new, separately audited version. */
  async rollback<K extends SettingKey>(
    key: K,
    version: number,
    actorId: string,
    reason: string,
  ): Promise<SettingRecord<K>> {
    assertSettingKey(key);
    if (!Number.isSafeInteger(version) || version < 1 || version > MAX_VERSION) {
      throw new BadRequestException('Rollback version must be a positive integer');
    }
    const audit = auditInputs(actorId, reason);
    return this.write(key, audit, async (tx, current) => {
      if (!current) throw new ServiceUnavailableException(`System setting ${key} is not configured`);
      const historical = await tx.systemSettingVersion.findUnique({
        where: { key_version: { key, version } },
      });
      if (!historical) throw new NotFoundException(`Version ${version} of ${key} was not found`);
      let value: SettingValues[K];
      try {
        value = validateSettingValue(key, historical.value);
      } catch {
        throw new ServiceUnavailableException(`Version ${version} of ${key} is invalid`);
      }
      return { value, rollbackOfVersion: version };
    });
  }

  private async write<K extends SettingKey>(
    key: K,
    audit: { actorId: string; reason: string },
    chooseValue: (
      tx: Prisma.TransactionClient,
      current: { version: number } | null,
    ) => Promise<{ value: SettingValues[K]; rollbackOfVersion: number | null }>,
  ): Promise<SettingRecord<K>> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: audit.actorId },
        select: { role: true, status: true },
      });
      if (!actor || actor.role !== UserRole.ADMIN || actor.status !== UserStatus.ACTIVE) {
        throw new ForbiddenException('An active admin actor is required');
      }

      // A row lock alone cannot lock a missing row. The transaction-scoped
      // advisory lock serializes creation too; the row lock protects existing
      // rows against other writers using SELECT FOR UPDATE.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`petad.system-settings.${key}`}, 0))`;
      await tx.$queryRaw`SELECT "key" FROM "system_settings" WHERE "key" = ${key} FOR UPDATE`;
      const current = await tx.systemSetting.findUnique({ where: { key } });
      if (!current) {
        const history = await tx.systemSettingVersion.findFirst({ where: { key }, select: { version: true } });
        if (history) throw new ServiceUnavailableException(`System setting ${key} is missing its current record`);
      }
      if (current && current.version >= MAX_VERSION) {
        throw new ServiceUnavailableException(`System setting ${key} has exhausted its version range`);
      }
      const selected = await chooseValue(tx, current);
      const version = (current?.version ?? 0) + 1;
      const value = selected.value as unknown as Prisma.InputJsonValue;

      await tx.systemSettingVersion.create({
        data: { key, version, value, actorId: audit.actorId, reason: audit.reason, rollbackOfVersion: selected.rollbackOfVersion },
      });
      const row = current
        ? await tx.systemSetting.update({ where: { key }, data: { version, value, actorId: audit.actorId } })
        : await tx.systemSetting.create({ data: { key, version, value, actorId: audit.actorId } });
      return this.toRecord(key, row);
    });
  }

  private toRecord<K extends SettingKey>(
    key: K,
    row: { value: Prisma.JsonValue; version: number; actorId: string; updatedAt: Date },
  ): SettingRecord<K> {
    try {
      return { key, value: validateSettingValue(key, row.value), version: row.version, actorId: row.actorId, updatedAt: row.updatedAt };
    } catch {
      throw new ServiceUnavailableException(`System setting ${key} contains invalid data`);
    }
  }
}
