import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EscrowStatus } from '@prisma/client';
import type { StatusResponse } from '../status.types';

const TERMINAL = new Set<EscrowStatus>([
  EscrowStatus.RELEASED,
  EscrowStatus.REFUNDED,
]);

const STEPS: EscrowStatus[] = [
  EscrowStatus.CREATED,
  EscrowStatus.FUNDED,
  EscrowStatus.RELEASED,
];

const NEXT_ACTIONS: Partial<Record<EscrowStatus, string[]>> = {
  [EscrowStatus.CREATED]: ['fund'],
  [EscrowStatus.FUNDED]: ['release', 'refund', 'dispute'],
  [EscrowStatus.DISPUTED]: ['resolve', 'refund'],
};

@Injectable()
export class EscrowStatusAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(id: string): Promise<StatusResponse | null> {
    const escrow = await this.prisma.escrow.findUnique({
      where: { id },
      select: { status: true, updatedAt: true },
    });
    if (!escrow) return null;

    return {
      current: escrow.status,
      steps: STEPS.map((s) => ({
        name: s,
        completed: STEPS.indexOf(s) <= STEPS.indexOf(escrow.status),
      })),
      nextActions: NEXT_ACTIONS[escrow.status] ?? [],
      updatedAt: escrow.updatedAt,
      isTerminal: TERMINAL.has(escrow.status),
    };
  }
}
