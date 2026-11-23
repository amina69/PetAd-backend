import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { ApprovalExpiryJob } from './approval-expiry.job';

@Module({
  imports: [PrismaModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalExpiryJob],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
