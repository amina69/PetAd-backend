import { Injectable } from '@nestjs/common';

export interface ApprovalRule {
  type: string;
  quorum: number;
  allowedRoles: string[];
  expiryDays?: number;
}

/** Provides configurable approval rules (quorum, veto, expiry, role gates). */
@Injectable()
export class ApprovalRuleService {
  private readonly rules: Map<string, ApprovalRule> = new Map([
    ['ADOPTION', { type: 'ADOPTION', quorum: 1, allowedRoles: ['ADMIN', 'SHELTER'] }],
    ['CUSTODY', { type: 'CUSTODY', quorum: 1, allowedRoles: ['ADMIN', 'SHELTER'] }],
  ]);

  getRule(type: string): ApprovalRule | undefined {
    return this.rules.get(type);
  }

  isQuorumMet(type: string, approvedCount: number): boolean {
    const rule = this.getRule(type);
    return rule ? approvedCount >= rule.quorum : false;
  }

  isRoleAuthorised(type: string, role: string): boolean {
    const rule = this.getRule(type);
    return rule ? rule.allowedRoles.includes(role) : false;
  }

  isExpired(type: string, createdAt: Date): boolean {
    const rule = this.getRule(type);
    if (!rule?.expiryDays) return false;
    const expiryMs = rule.expiryDays * 86_400_000;
    return Date.now() - createdAt.getTime() > expiryMs;
  }
}
