import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export const STROOPS_PER_XLM = 10_000_000n;
const DEFAULT_FEE_BPS = 200; // 2 %

export interface FeeSplitResult {
  totalStroops: bigint;
  platformFeeStroops: bigint;
  recipientStroops: bigint;
  recipientAddress: string;
  feeBps: number;
}

/**
 * Split `totalStroops` into a platform fee and a recipient amount using
 * basis-point arithmetic.  Fee is truncated (floor) so the recipient always
 * gets at least the nominal amount.  Invariant: fee + recipient === total.
 */
export function splitAmount(
  totalStroops: bigint,
  feeBps: number,
): { platformFeeStroops: bigint; recipientStroops: bigint } {
  const platformFeeStroops = (totalStroops * BigInt(feeBps)) / 10_000n;
  const recipientStroops = totalStroops - platformFeeStroops;

  if (platformFeeStroops + recipientStroops !== totalStroops) {
    throw new Error('Fee split invariant violated');
  }

  return { platformFeeStroops, recipientStroops };
}

/** Convert an XLM amount (may be a decimal string or number) to stroops. */
export function xlmToStroops(amount: number | string): bigint {
  // Parse as fixed-precision to avoid IEEE-754 drift
  const str = String(amount);
  const [integer, decimals = ''] = str.split('.');
  const paddedDecimals = decimals.padEnd(7, '0').slice(0, 7);
  return BigInt(integer) * STROOPS_PER_XLM + BigInt(paddedDecimals);
}

/**
 * Validate a Stellar G-address structural format (base32 / 56 chars).
 * Full StrKey checksum verification happens at the signing layer.
 */
export function validateStellarAddress(address: string): void {
  if (!/^G[A-Z2-7]{55}$/.test(address)) {
    throw new BadRequestException({
      message: 'Invalid Stellar address format',
      code: 'INVALID_STELLAR_ADDRESS',
    });
  }
}

@Injectable()
export class FeeSplitService {
  private readonly feeBps: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.feeBps =
      this.configService.get<number>('PLATFORM_FEE_BPS') ?? DEFAULT_FEE_BPS;
  }

  async computePayout(escrowId: string, userId: string): Promise<FeeSplitResult> {
    const escrow = await this.prisma.escrow.findUnique({
      where: { id: escrowId },
    });
    if (!escrow) throw new NotFoundException('Escrow not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stellarPublicKey: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (!user.stellarPublicKey) {
      throw new BadRequestException({
        message: 'Payout account not configured',
        code: 'PAYOUT_ACCOUNT_REQUIRED',
      });
    }

    validateStellarAddress(user.stellarPublicKey);

    const totalStroops = xlmToStroops(escrow.amount.toString());
    const { platformFeeStroops, recipientStroops } = splitAmount(
      totalStroops,
      this.feeBps,
    );

    return {
      totalStroops,
      platformFeeStroops,
      recipientStroops,
      recipientAddress: user.stellarPublicKey,
      feeBps: this.feeBps,
    };
  }
}
