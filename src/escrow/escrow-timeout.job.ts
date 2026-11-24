import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EscrowStatus } from '@prisma/client';

@Injectable()
export class EscrowTimeoutJob {
  private readonly logger = new Logger(EscrowTimeoutJob.name);

  constructor(private readonly prisma: PrismaService) {}

  async expireStaleEscrows(timeoutMs = 7 * 24 * 60 * 60 * 1000) {
    const cutoff = new Date(Date.now() - timeoutMs);

    const stale = await this.prisma.escrow.findMany({
      where: {
        status: EscrowStatus.FUNDED,
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    });

    if (stale.length === 0) return { expired: 0 };

    this.logger.log(`Expiring ${stale.length} stale funded escrows`);

    await this.prisma.escrow.updateMany({
      where: { id: { in: stale.map((e) => e.id) } },
      data: { status: EscrowStatus.REFUNDED },
    });

    return { expired: stale.length };
  }
}
