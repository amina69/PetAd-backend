/** Provider payment state only; a paid checkout does not imply escrow funding. */
export type CheckoutStatus =
  | 'open'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'unknown';

export type RefundStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'unknown';

export interface CreateCheckoutInput {
  /** Integer USD cents, from 50 to 99,999,999 inclusive. */
  amountCents: number;
  currency: 'usd';
  successUrl: string;
  cancelUrl: string;
  /** Unique per logical command. Reuse only with identical parameters. */
  idempotencyKey: string;
}

export interface GetStatusInput {
  checkoutReference: string;
}

export interface CheckoutSnapshot {
  checkoutReference: string;
  paymentReference: string | null;
  status: CheckoutStatus;
  /** Null when the provider has not supplied a total or currency. */
  amountCents: number | null;
  currency: 'usd' | null;
}

export interface CreateCheckoutResult extends CheckoutSnapshot {
  /** The hosted checkout URL can be null if the session is no longer active. */
  checkoutUrl: string | null;
}

export interface RefundInput {
  paymentReference: string;
  /** Integer USD cents, from 1 to 99,999,999 inclusive. */
  amountCents: number;
  currency: 'usd';
  /** Unique per logical command. Reuse only with identical parameters. */
  idempotencyKey: string;
}

export interface RefundResult {
  refundReference: string;
  paymentReference: string;
  amountCents: number;
  currency: 'usd';
  status: RefundStatus;
}

/** Deduplicate event IDs in durable application storage before applying effects. */
export type ProviderWebhookEvent =
  | {
      id: string;
      type: 'checkout.status_changed';
      checkout: CheckoutSnapshot;
    }
  | { id: string; type: 'refund.status_changed'; refund: RefundResult }
  | { id: string; type: 'unhandled'; providerEventType: string };

export interface VerifyWebhookInput {
  /** Original, unparsed request bytes. */
  payload: Buffer;
  signature: string;
}

export interface PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  getStatus(input: GetStatusInput): Promise<CheckoutSnapshot>;
  refund(input: RefundInput): Promise<RefundResult>;
  /** Verifies authenticity, not delivery uniqueness or ordering. */
  verifyWebhook(input: VerifyWebhookInput): ProviderWebhookEvent;
}
