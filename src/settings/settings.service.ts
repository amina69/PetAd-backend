import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CachedSettingsProvider } from './cached-settings.provider';

export interface SettingDefinition {
  key: string;
  type: 'number' | 'boolean' | 'string' | 'json';
  defaultValue: any;
  description?: string;
  validator?: (val: any) => boolean;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly definitions: Map<string, SettingDefinition> = new Map([
    ['escrow_timeout_hours', { key: 'escrow_timeout_hours', type: 'number', defaultValue: 72, description: 'Escrow timeout in hours', validator: (v) => typeof v === 'number' && v > 0 }],
    ['anchoring_threshold', { key: 'anchoring_threshold', type: 'number', defaultValue: 1000, description: 'Anchoring threshold amount', validator: (v) => typeof v === 'number' && v >= 0 }],
    ['trust_policy_min_score', { key: 'trust_policy_min_score', type: 'number', defaultValue: 50, description: 'Minimum trust score required', validator: (v) => typeof v === 'number' && v >= 0 && v <= 100 }],
    ['approval_rules_auto', { key: 'approval_rules_auto', type: 'boolean', defaultValue: false, description: 'Enable automatic approvals', validator: (v) => typeof v === 'boolean' }],
    ['upload_limit_mb', { key: 'upload_limit_mb', type: 'number', defaultValue: 10, description: 'Max file upload size in MB', validator: (v) => typeof v === 'number' && v > 0 }],
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cachedProvider: CachedSettingsProvider,
  ) {}

  async onModuleInit() {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "system_settings" (
          "key" TEXT NOT NULL PRIMARY KEY,
          "value" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "description" TEXT,
          "updatedBy" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "system_setting_versions" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "settingKey" TEXT NOT NULL,
          "value" TEXT NOT NULL,
          "version" INTEGER NOT NULL,
          "actor" TEXT,
          "reason" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "system_setting_versions_settingKey_fkey" FOREIGN KEY ("settingKey") REFERENCES "system_settings"("key") ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "system_setting_versions_settingKey_idx" ON "system_setting_versions"("settingKey");
      `);
    } catch (e) {
      // Table might already exist or DB restricted
    }
  }

  public getDefinition(key: string): SettingDefinition {
    const def = this.definitions.get(key);
    if (!def) {
      throw new NotFoundException(`Setting key "${key}" is not recognized.`);
    }
    return def;
  }

  public validateValue(def: SettingDefinition, rawValue: any): any {
    let parsed = rawValue;
    if (def.type === 'number') {
      parsed = Number(rawValue);
      if (isNaN(parsed)) {
        throw new BadRequestException(`Setting "${def.key}" must be a valid number.`);
      }
    } else if (def.type === 'boolean') {
      if (typeof rawValue === 'string') {
        if (rawValue === 'true') parsed = true;
        else if (rawValue === 'false') parsed = false;
      }
      if (typeof parsed !== 'boolean') {
        throw new BadRequestException(`Setting "${def.key}" must be a boolean.`);
      }
    } else if (def.type === 'json') {
      if (typeof rawValue === 'string') {
        try {
          parsed = JSON.parse(rawValue);
        } catch (e) {
          throw new BadRequestException(`Setting "${def.key}" must be valid JSON.`);
        }
      }
    }

    if (def.validator && !def.validator(parsed)) {
      throw new BadRequestException(`Invalid value for setting "${def.key}": failed validation range/type check.`);
    }
    return parsed;
  }

  async getSetting(key: string): Promise<any> {
    return this.cachedProvider.get(key);
  }

  async getAllSettings(): Promise<Record<string, any>> {
    const keys = Array.from(this.definitions.keys());
    const result: Record<string, any> = {};
    for (const key of keys) {
      result[key] = await this.getSetting(key);
    }
    return result;
  }

  async updateSetting(key: string, value: any, actor: string, reason?: string) {
    const def = this.getDefinition(key);
    const validatedValue = this.validateValue(def, value);
    const stringVal = JSON.stringify(validatedValue);

    return this.prisma.$transaction(async (tx) => {
      let setting = await tx.systemSetting.findUnique({ where: { key } });
      let nextVersion = 1;

      if (setting) {
        const lastVersion = await tx.systemSettingVersion.findFirst({
          where: { settingKey: key },
          orderBy: { version: 'desc' },
        });
        nextVersion = (lastVersion?.version ?? 0) + 1;
      }

      setting = await tx.systemSetting.upsert({
        where: { key },
        update: {
          value: stringVal,
          updatedBy: actor,
        },
        create: {
          key,
          value: stringVal,
          type: def.type,
          description: def.description,
          updatedBy: actor,
        },
      });

      await tx.systemSettingVersion.create({
        data: {
          settingKey: key,
          value: stringVal,
          version: nextVersion,
          actor,
          reason: reason || 'Setting updated',
        },
      });

      this.cachedProvider.invalidate(key);
      return { setting, version: nextVersion };
    });
  }

  async rollbackSetting(key: string, targetVersion: number, actor: string, reason?: string) {
    const def = this.getDefinition(key);
    const versionRecord = await this.prisma.systemSettingVersion.findFirst({
      where: { settingKey: key, version: targetVersion },
    });

    if (!versionRecord) {
      throw new NotFoundException(`Version ${targetVersion} not found for setting "${key}".`);
    }

    const parsedVal = JSON.parse(versionRecord.value);
    return this.updateSetting(key, parsedVal, actor, reason || `Rollback to version ${targetVersion}`);
  }

  async getVersions(key: string) {
    this.getDefinition(key);
    return this.prisma.systemSettingVersion.findMany({
      where: { settingKey: key },
      orderBy: { version: 'desc' },
    });
  }
}
