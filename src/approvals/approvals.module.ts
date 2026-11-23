import { Module } from '@nestjs/common';
import { ApprovalRuleService } from './rules/approval-rule.service';
import { ApprovalsController } from './approvals.controller';
import { AdminApprovalsController } from './admin-approvals.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ApprovalsController, AdminApprovalsController],
  providers: [ApprovalRuleService],
  exports: [ApprovalRuleService],
})
export class ApprovalsModule {}
