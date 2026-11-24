import { Injectable } from '@nestjs/common';

export interface SplitResult {
  ownerAmount: number;
  holderAmount: number;
}

@Injectable()
export class FeeSplitService {
  /**
   * Split an escrow amount by owner percentage.
   * @param totalAmount  Total escrow amount in XLM stroops or decimal
   * @param ownerPercent Owner's share in percent (1-99)
   */
  split(totalAmount: number, ownerPercent: number): SplitResult {
    if (ownerPercent < 1 || ownerPercent > 99) {
      throw new Error(`ownerPercent must be 1-99, got ${ownerPercent}`);
    }
    const ownerAmount = Math.floor((totalAmount * ownerPercent) / 100);
    const holderAmount = totalAmount - ownerAmount;
    return { ownerAmount, holderAmount };
  }
}
