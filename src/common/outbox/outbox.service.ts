import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

type Tx = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class OutboxService {
  /**
   * Write an outbox record inside an already-open Prisma transaction.
   *
   * The caller is responsible for opening the transaction and passing the
   * transaction client (`tx`) here.  Business change and outbox record are
   * committed atomically, so a crash between the commit and a direct
   * BullMQ enqueue can never lose the job.
   */
  async write(
    tx: Tx,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await (tx as any).outboxMessage.create({
      data: {
        type,
        payload: payload as Record<string, unknown>,
        status: 'PENDING',
        availableAt: new Date(),
      },
    });
  }
}
