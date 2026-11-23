import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EscrowStatus, AdoptionStatus } from '@prisma/client';

const RECONCILE_INTERVAL_MS = 15 * 60 * 1000; // run every 15 minutes

@Injectable()
export class EscrowReconcilerJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscrowReconcilerJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), RECONCILE_INTERVAL_MS);
    this.logger.log('Escrow reconciler job started');
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    const startedAt = new Date();
    let discrepancies = 0;
    const details: Array<{ escrowId: string; issue: string }> = [];

    try {
      const escrows = await this.prisma.escrow.findMany({
        where: { status: { in: [EscrowStatus.FUNDED, EscrowStatus.CREATED] } },
        include: { adoption: true, custody: true },
      });

      for (const escrow of escrows) {
        // Funded escrow with no linked entity is a dangling record
        if (escrow.status === EscrowStatus.FUNDED && !escrow.adoption && !escrow.custody) {
          discrepancies++;
          details.push({ escrowId: escrow.id, issue: 'FUNDED_NO_ENTITY' });
          this.logger.warn(`Escrow ${escrow.id} is FUNDED but has no linked adoption or custody`);
        }

        // Adoption completed but escrow not released
        if (
          escrow.adoption?.status === AdoptionStatus.COMPLETED &&
          escrow.status !== EscrowStatus.RELEASED
        ) {
          discrepancies++;
          details.push({ escrowId: escrow.id, issue: 'ADOPTION_COMPLETE_ESCROW_UNRELEASED' });
          this.logger.warn(`Escrow ${escrow.id} not released for completed adoption ${escrow.adoption.id}`);
        }

        // Adoption cancelled/rejected but escrow not refunded
        if (
          escrow.adoption &&
          [AdoptionStatus.CANCELLED, AdoptionStatus.REJECTED].includes(escrow.adoption.status) &&
          escrow.status === EscrowStatus.FUNDED
        ) {
          discrepancies++;
          details.push({ escrowId: escrow.id, issue: 'ADOPTION_CANCELLED_ESCROW_FUNDED' });
          this.logger.warn(`Escrow ${escrow.id} still FUNDED for cancelled/rejected adoption ${escrow.adoption.id}`);
        }
      }

      await this.prisma.reconciliationRun.create({
        data: {
          startedAt,
          completedAt: new Date(),
          escrowsChecked: escrows.length,
          discrepancies,
          details: details.length ? details : undefined,
        },
      });

      if (discrepancies > 0) {
        this.logger.warn(
          `Escrow reconciliation: ${discrepancies} discrepancy/discrepancies found across ${escrows.length} escrow(s)`,
        );
      } else {
        this.logger.log(`Escrow reconciliation: ${escrows.length} escrow(s) checked, no discrepancies`);
      }
    } catch (err) {
      this.logger.error(
        'Escrow reconciler job failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
