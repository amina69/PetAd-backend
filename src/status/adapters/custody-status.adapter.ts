import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustodyStatus } from '@prisma/client';
import type { StatusResponse } from '../status.types';

const TERMINAL = new Set<CustodyStatus>([
  CustodyStatus.COMPLETED,
  CustodyStatus.RETURNED,
  CustodyStatus.CANCELLED,
  CustodyStatus.VIOLATION,
]);

const STEPS: CustodyStatus[] = [
  CustodyStatus.PENDING,
  CustodyStatus.ACTIVE,
  CustodyStatus.COMPLETED,
];

const NEXT_ACTIONS: Partial<Record<CustodyStatus, string[]>> = {
  [CustodyStatus.PENDING]: ['activate', 'cancel'],
  [CustodyStatus.ACTIVE]: ['complete', 'return', 'report_violation'],
};

@Injectable()
export class CustodyStatusAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(id: string): Promise<StatusResponse | null> {
    const custody = await this.prisma.custody.findUnique({
      where: { id },
      select: { status: true, updatedAt: true },
    });
    if (!custody) return null;

    return {
      current: custody.status,
      steps: STEPS.map((s) => ({
        name: s,
        completed: STEPS.indexOf(s) <= STEPS.indexOf(custody.status),
      })),
      nextActions: NEXT_ACTIONS[custody.status] ?? [],
      updatedAt: custody.updatedAt,
      isTerminal: TERMINAL.has(custody.status),
    };
  }
}
