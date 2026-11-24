import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEvaluationMode } from '@prisma/client';

export interface UpsertApprovalRuleDto {
  requestType: string;
  requiredGroups: string[];
  quorum: number;
  mode: ApprovalEvaluationMode;
  vetoOnReject: boolean;
}

@Injectable()
export class ApprovalRuleService {
  constructor(private readonly prisma: PrismaService) {}

  findByRequestType(requestType: string) {
    return this.prisma.approvalRule.findFirst({ where: { requestType } });
  }

  listRules() {
    return this.prisma.approvalRule.findMany({ orderBy: { createdAt: 'asc' } });
  }

  upsertRule(data: UpsertApprovalRuleDto) {
    return this.prisma.approvalRule.upsert({
      where: { requestType: data.requestType },
      update: data,
      create: data,
    });
  }
}
