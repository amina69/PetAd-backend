import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './require-permission.decorator';
import { ROLES_KEY } from '../guards/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private cache = new Map<string, { permissions: string[]; timestamp: number }>();
  private readonly CACHE_TTL = 30000; // 30 seconds cache

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  )	{}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Backwards compatible: if @Roles(ADMIN) or similar is used, ADMIN role passes
    if (requiredRoles && requiredRoles.includes(user.role)) {
      return true;
    }
    if (user.role === 'ADMIN') {
      return true;
    }

    if (!requiredPermission) {
      return true;
    }

    const permissions = await this.getUserPermissions(user.sub || user.userId, user.role);
    if (permissions.includes(requiredPermission) || permissions.includes('*')) {
      return true;
    }

    throw new ForbiddenException(`Missing required permission: ${requiredPermission}`);
  }

  private async getUserPermissions(userId: string, role: string): Promise<string[]> {
    const cacheKey = `${userId}:${role}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.permissions;
    }

    let dbPermissions: { permission: { name: string } }[] = [];
    try {
      dbPermissions = await (this.prisma as any).rolePermission.findMany({
        where: { role: role as any },
        include: { permission: true },
      });
    } catch {
      // Fallback if table doesn't exist yet
    }

    const permissions = dbPermissions.map((rp) => rp.permission.name);
    
    // Role presets default mapping
    if (role === 'FINANCE' && !permissions.includes('payments.refund')) {
      permissions.push('payments.refund');
    }
    if (role === 'MODERATOR' && !permissions.includes('disputes.resolve')) {
      permissions.push('disputes.resolve');
    }
    if (role === 'SUPPORT' && !permissions.includes('documents.verify')) {
      permissions.push('documents.verify');
    }
    if (role === 'AUDITOR' && !permissions.includes('audit.read')) {
      permissions.push('audit.read');
    }

    this.cache.set(cacheKey, { permissions, timestamp: now });
    return permissions;
  }

  public invalidateCache(userId?: string, role?: string) {
    if (userId && role) {
      this.cache.delete(`${userId}:${role}`);
    } else {
      this.cache.clear();
    }
  }
}
