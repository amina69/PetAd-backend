import { Module } from '@nestjs/common';
import {
  DisputesController,
  AdminDisputesController,
} from './disputes.controller';
import { DisputesService } from './disputes.service';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { DisputeStateMachine } from './dispute-state-machine';
import { DisputeResolutionService } from './dispute-resolution.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EscrowModule } from '../escrow/escrow.module';

@Module({
  imports: [PrismaModule, EscrowModule],
  controllers: [DisputesController, AdminDisputesController],
  providers: [
    DisputesService,
    DisputeEvidenceService,
    DisputeStateMachine,
    DisputeResolutionService,
  ],
  exports: [DisputesService, DisputeEvidenceService, DisputeResolutionService],
})
export class DisputesModule {}
