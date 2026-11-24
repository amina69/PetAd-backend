import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { AdminApprovalsController } from './admin-approvals.controller';
import { ApprovalRuleService } from './rules/approval-rule.service';

@Module({
  controllers: [ApprovalsController, AdminApprovalsController],
  providers: [ApprovalRuleService],
  exports: [ApprovalRuleService],
})
export class ApprovalsModule {}
