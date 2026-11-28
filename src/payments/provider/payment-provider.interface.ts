export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface ChargeInput {
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  /** Optional provider token (e.g. a card token). */
  token?: string;
}

export interface ChargeResult {
  succeeded: boolean;
  externalRef?: string;
  txHash?: string;
  failureReason?: string;
}

export interface RefundInput {
  paymentId: string;
  refundId?: string;
  amountMinor: bigint;
  currency: string;
  token?: string;
}

export interface RefundResult {
  succeeded: boolean;
  externalRef?: string;
  txHash?: string;
  failureReason?: string;
}

/**
 * Payment provider abstraction.
 *
 * The only implementation shipped today is {@link FakePaymentProvider}; a
 * real Stellar/card provider can be registered behind the same tokens.
 */
export interface PaymentProvider {
  readonly name: string;
  charge(input: ChargeInput): Promise<ChargeResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}
