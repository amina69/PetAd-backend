import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Projection } from './projection.interface';

@Injectable()
export class ProjectionRunnerService {
  private readonly logger = new Logger(ProjectionRunnerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runProjection(projection: Projection, batchSize = 100): Promise<void> {
    let checkpoint = await this.prisma.projectionCheckpoint.findUnique({
      where: { projection: projection.name },
    });

    let lastCreatedAt: Date | null = checkpoint ? new Date(checkpoint.lastPosition) : null;

    while (true) {
      const whereClause: any = {
        eventType: { in: projection.handles },
      };

      if (lastCreatedAt) {
        whereClause.createdAt = { gt: lastCreatedAt };
      }

      const events = await this.prisma.eventLog.findMany({
        where: whereClause,
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });

      if (events.length === 0) {
        break;
      }

      for (const event of events) {
        await projection.apply({
          id: event.id,
          eventType: event.eventType,
          payload: event.payload,
          entityType: event.entityType,
          entityId: event.entityId,
          createdAt: event.createdAt,
        });
        lastCreatedAt = event.createdAt;
      }

      if (lastCreatedAt) {
        await this.prisma.projectionCheckpoint.upsert({
          where: { projection: projection.name },
          update: { lastPosition: lastCreatedAt.toISOString() },
          create: {
            projection: projection.name,
            lastPosition: lastCreatedAt.toISOString(),
          },
        });
      }

      if (events.length < batchSize) {
        break;
      }
    }

    this.logger.log(`Projection ${projection.name} ran successfully up to ${lastCreatedAt?.toISOString() ?? 'beginning'}`);
  }

  async rebuildProjection(projection: Projection, batchSize = 100): Promise<void> {
    this.logger.log(`Rebuilding projection ${projection.name}...`);
    await projection.reset();
    await this.prisma.projectionCheckpoint.deleteMany({
      where: { projection: projection.name },
    });
    await this.runProjection(projection, batchSize);
    this.logger.log(`Projection ${projection.name} rebuilt successfully.`);
  }
}
