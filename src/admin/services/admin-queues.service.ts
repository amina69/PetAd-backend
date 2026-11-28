import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueQueryDto } from '../dto/queue-query.dto';

@Injectable()
export class AdminQueuesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly CLAIM_TIMEOUT_MINUTES = 30;

  private async checkAndExpireClaims() {
    const threshold = new Date(Date.now() - this.CLAIM_TIMEOUT_MINUTES * 60 * 1000);
    await this.prisma.workQueueItem.updateMany({
      where: {
        claimedAt: { lt: threshold },
        assigneeId: { not: null },
      },
      data: {
        assigneeId: null,
        claimedAt: null,
      },
    });
  }

  async getQueue(type: string, query: QueueQueryDto) {
    await this.checkAndExpireClaims();

    const where: any = { type };

    if (query.assignee) {
      where.assigneeId = query.assignee;
    }

    if (query.priority) {
      where.priority = query.priority;
    }

    if (query.olderThanDays !== undefined) {
      const dateLimit = new Date(Date.now() - query.olderThanDays * 24 * 60 * 60 * 1000);
      where.createdAt = { lte: dateLimit };
    }

    const items = await this.prisma.workQueueItem.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    return items.map((item) => {
      const ageMs = Date.now() - new Date(item.createdAt).getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      return {
        ...item,
        slaAgeDays: ageDays,
      };
    });
  }

  async claimItem(id: string, adminId: string) {
    await this.checkAndExpireClaims();

    const item = await this.prisma.workQueueItem.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundException('Work queue item not found');
    }

    if (item.assigneeId && item.assigneeId !== adminId) {
      throw new ConflictException('Item is already claimed by another admin');
    }

    return this.prisma.workQueueItem.update({
      where: { id },
      data: {
        assigneeId: adminId,
        claimedAt: new Date(),
      },
    });
  }

  async unclaimItem(id: string, adminId: string) {
    const item = await this.prisma.workQueueItem.findUnique({
      where: { id },
    });

    if (!item) {
      throw new NotFoundException('Work queue item not found');
    }

    if (item.assigneeId && item.assigneeId !== adminId) {
      throw new ForbiddenException('Cannot unclaim an item assigned to another admin');
    }

    return this.prisma.workQueueItem.update({
      where: { id },
      data: {
        assigneeId: null,
        claimedAt: null,
      },
    });
  }
}
