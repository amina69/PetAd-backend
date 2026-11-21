import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
} from './payment-provider.interface';

/**
 * Deterministic fake payment provider used by tests and local development.
 *
 * - A `providerToken` of `decline` (or `fail`) makes the operation fail.
 * - References and tx hashes are derived from the payment/refund id, so the
 *   same operation always produces the same on-chain-looking reference.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';

  charge(input: ChargeInput): Promise<ChargeResult> {
    if (input.amountMinor <= 0n) {
      return Promise.resolve({
        succeeded: false,
        failureReason: 'invalid_amount',
      });
    }
    if (this.isDeclined(input.token)) {
      return Promise.resolve({
        succeeded: false,
        failureReason: 'card_declined',
      });
    }

    const digest = this.digest('charge', input.paymentId);
    return Promise.resolve({
      succeeded: true,
      externalRef: `fake_ch_${digest.slice(0, 24)}`,
      txHash: `fake_stellar_${digest.slice(0, 32)}`,
    });
  }

  refund(input: RefundInput): Promise<RefundResult> {
    if (input.amountMinor <= 0n) {
      return Promise.resolve({
        succeeded: false,
        failureReason: 'invalid_amount',
      });
    }
    if (this.isDeclined(input.token)) {
      return Promise.resolve({
        succeeded: false,
        failureReason: 'refund_declined',
      });
    }

    const digest = this.digest(
      'refund',
      `${input.paymentId}:${input.amountMinor.toString()}`,
    );
    return Promise.resolve({
      succeeded: true,
      externalRef: `fake_re_${digest.slice(0, 24)}`,
      txHash: `fake_stellar_${digest.slice(0, 32)}`,
    });
  }

  private isDeclined(token?: string): boolean {
    const normalised = token?.trim().toLowerCase();
    return normalised === 'decline' || normalised === 'fail';
  }

  private digest(kind: string, value: string): string {
    return createHash('sha256').update(`${kind}:${value}`).digest('hex');
  }
}
