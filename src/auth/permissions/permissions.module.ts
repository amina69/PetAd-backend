import { Module, OnModuleInit } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  imports: [PrismaModule],
  providers: [PermissionsGuard],
  exports: [PermissionsGuard],
})
export class PermissionsModule implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const permissions = [
      { name: 'documents.verify', description: 'Verify user and pet documents' },
      { name: 'disputes.resolve', description: 'Resolve custody and adoption disputes' },
      { name: 'payments.refund', description: 'Refund escrow payments' },
      { name: 'audit.read', description: 'Read system audit logs and replay events' },
      { name: 'settings.write', description: 'Modify global system settings' },
    ];

    for (const p of permissions) {
      try {
        await (this.prisma as any).permission.upsert({
          where: { name: p.name },
          update: {},
          create: p,
        });
      } catch {
        // Table might not be migrated yet in some test suites
      }
    }

    const rolePresets = [
      { role: 'SUPPORT', permissions: ['documents.verify'] },
      { role: 'MODERATOR', permissions: ['disputes.resolve'] },
      { role: 'FINANCE', permissions: ['payments.refund'] },
      { role: 'AUDITOR', permissions: ['audit.read'] },
      { role: 'ADMIN', permissions: ['documents.verify', 'disputes.resolve', 'payments.refund', 'audit.read', 'settings.write'] },
    ];

    for (const preset of rolePresets) {
      for (const permName of preset.permissions) {
        try {
          const perm = await (this.prisma as any).permission.findUnique({ where: { name: permName } });
          if (perm) {
            await (this.prisma as any).rolePermission.upsert({
              where: {
                role_permissionId: {
                  role: preset.role as any,
                  permissionId: perm.id,
                },
              },
              update: {},
              create: {
                role: preset.role as any,
                permissionId: perm.id,
              },
            });
          }
        } catch {
          // Skip if table doesn't exist
        }
      }
    }
  }
}
