import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EscrowService } from '../../escrow/escrow.service';

export type SettlementRail = 'ESCROW' | 'PROVIDER';

export interface SettlementResult {
  rail: SettlementRail;
  status: string;
  escrowId?: string;
  reference?: string;
}

/**
 * Routes an approved refund to the rail that holds the funds.
 *
 * Payments backed by a Stellar escrow are refunded through the escrow
 * service; anything else is handed to the payment provider. The provider
 * hand-off is intentionally isolated here so a real integration only has to
 * change this class.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrowService: EscrowService,
  ) {}

  async settleRefund(input: {
    paymentId: string;
    escrowId: string | null;
    amountMinor: number;
    currency: string;
    refundRequestId: string;
  }): Promise<SettlementResult> {
    if (input.escrowId) {
      const escrow = await this.prisma.escrow.findUnique({
        where: { id: input.escrowId },
        select: { id: true, status: true },
      });

      // An already refunded escrow is not touched twice; the provider rail
      // then carries any additional partial refund.
      if (escrow && escrow.status !== 'REFUNDED') {
        const refunded = await this.escrowService.refundEscrow(escrow.id);

        return {
          rail: 'ESCROW',
          status: refunded.status,
          escrowId: escrow.id,
        };
      }
    }

    const reference = `provider-refund:${input.refundRequestId}`;
    this.logger.log(
      `Queued provider refund for payment ${input.paymentId} ` +
        `(${input.amountMinor} ${input.currency} minor units, reference ${reference})`,
    );

    return { rail: 'PROVIDER', status: 'QUEUED', reference };
  }
}
