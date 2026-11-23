import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdoptionStatus } from '@prisma/client';
import type { StatusResponse } from '../status.types';

const TERMINAL = new Set<AdoptionStatus>([
  AdoptionStatus.COMPLETED,
  AdoptionStatus.REJECTED,
  AdoptionStatus.CANCELLED,
]);

const STEPS: AdoptionStatus[] = [
  AdoptionStatus.REQUESTED,
  AdoptionStatus.PENDING,
  AdoptionStatus.APPROVED,
  AdoptionStatus.ESCROW_FUNDED,
  AdoptionStatus.COMPLETED,
];

const NEXT_ACTIONS: Partial<Record<AdoptionStatus, string[]>> = {
  [AdoptionStatus.REQUESTED]: ['approve', 'reject'],
  [AdoptionStatus.PENDING]: ['approve', 'reject'],
  [AdoptionStatus.APPROVED]: ['fund_escrow', 'cancel'],
  [AdoptionStatus.ESCROW_FUNDED]: ['release_escrow', 'cancel'],
};

@Injectable()
export class AdoptionStatusAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(id: string): Promise<StatusResponse | null> {
    const adoption = await this.prisma.adoption.findUnique({
      where: { id },
      select: { status: true, updatedAt: true },
    });
    if (!adoption) return null;

    return {
      current: adoption.status,
      steps: STEPS.map((s) => ({
        name: s,
        completed: STEPS.indexOf(s) <= STEPS.indexOf(adoption.status),
      })),
      nextActions: NEXT_ACTIONS[adoption.status] ?? [],
      updatedAt: adoption.updatedAt,
      isTerminal: TERMINAL.has(adoption.status),
    };
  }
}
