import Stripe from 'stripe';
import {
  CheckoutSnapshot,
  CheckoutStatus,
  CreateCheckoutInput,
  CreateCheckoutResult,
  GetStatusInput,
  PaymentProvider,
  ProviderWebhookEvent,
  RefundInput,
  RefundResult,
  RefundStatus,
  VerifyWebhookInput,
} from './payment-provider';
import {
  assertAmount,
  assertCurrency,
  assertHttpsUrl,
  assertRecord,
  assertReference,
  normalizedCheckout,
  normalizedRefund,
  validateCreateCheckout,
  validateGetStatus,
  validateRefund,
  validateWebhookInput,
} from './validation';

export interface StripePaymentProviderConfig {
  /** Stripe secret or restricted API key in test mode only. */
  secretKey: string;
  webhookSecret: string;
}

/** Stripe test-mode payments only. This does not perform Stellar settlement. */
export class StripePaymentProvider implements PaymentProvider {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: StripePaymentProviderConfig) {
    if (
      !config ||
      typeof config.secretKey !== 'string' ||
      !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(config.secretKey)
    ) {
      throw new Error('Stripe requires a test-mode secret or restricted key');
    }
    if (
      typeof config.webhookSecret !== 'string' ||
      !/^whsec_[A-Za-z0-9_-]+$/.test(config.webhookSecret)
    ) {
      throw new Error('Invalid Stripe webhook secret');
    }
    this.stripe = new Stripe(config.secretKey);
    this.webhookSecret = config.webhookSecret;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    validateCreateCheckout(input);
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        line_items: [
          {
            price_data: {
              currency: input.currency,
              unit_amount: input.amountCents,
              product_data: { name: 'Payment' },
            },
            quantity: 1,
          },
        ],
      },
      { idempotencyKey: input.idempotencyKey },
    );
    const snapshot = stripeCheckout(session);
    if (snapshot.amountCents !== input.amountCents || snapshot.currency !== input.currency) {
      throw new Error('Stripe checkout does not match the request');
    }
    if (session.url !== null) assertHttpsUrl(session.url);
    return { ...snapshot, checkoutUrl: session.url };
  }

  async getStatus(input: GetStatusInput): Promise<CheckoutSnapshot> {
    validateGetStatus(input);
    assertStripeReference(input.checkoutReference, 'cs_test_');
    const session = await this.stripe.checkout.sessions.retrieve(input.checkoutReference);
    const snapshot = stripeCheckout(session);
    if (snapshot.checkoutReference !== input.checkoutReference) {
      throw new Error('Stripe checkout reference mismatch');
    }
    return snapshot;
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    validateRefund(input);
    assertStripeReference(input.paymentReference, 'pi_');
    // Verify the referenced payment's currency and settled amount before refunding.
    // Stripe still enforces the remaining refundable amount and idempotency.
    const payment = await this.stripe.paymentIntents.retrieve(input.paymentReference);
    if (
      payment.object !== 'payment_intent' ||
      payment.id !== input.paymentReference ||
      payment.livemode !== false ||
      payment.status !== 'succeeded'
    ) {
      throw new Error('Stripe payment is not a succeeded test-mode payment');
    }
    assertCurrency(payment.currency);
    assertAmount(payment.amount_received);
    if (input.amountCents > payment.amount_received) {
      throw new Error('Refund exceeds payment amount');
    }
    const refund = await this.stripe.refunds.create(
      { payment_intent: input.paymentReference, amount: input.amountCents },
      { idempotencyKey: input.idempotencyKey },
    );
    const result = stripeRefund(refund);
    if (
      result.paymentReference !== input.paymentReference ||
      result.amountCents !== input.amountCents
    ) {
      throw new Error('Stripe refund does not match the request');
    }
    return result;
  }

  verifyWebhook(input: VerifyWebhookInput): ProviderWebhookEvent {
    validateWebhookInput(input);
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        input.payload,
        input.signature,
        this.webhookSecret,
      );
    } catch {
      // SDK errors can contain raw payloads or signatures; do not forward them.
      throw new Error('Invalid Stripe webhook signature or payload');
    }
    if (event.livemode !== false) throw new Error('Live Stripe event rejected');
    assertStripeReference(event.id, 'evt_');
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        return {
          id: event.id,
          type: 'checkout.status_changed',
          checkout: stripeCheckout(event.data.object, event.type),
        };
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        return {
          id: event.id,
          type: 'refund.status_changed',
          refund: stripeRefund(event.data.object, event.type),
        };
      default:
        assertReference(event.type);
        return { id: event.id, type: 'unhandled', providerEventType: event.type };
    }
  }
}

function assertStripeReference(value: unknown, prefix: string): asserts value is string {
  assertReference(value);
  if (!value.startsWith(prefix) || value.length === prefix.length) {
    throw new Error('Invalid Stripe provider reference');
  }
}

function paymentReference(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'object') {
    assertRecord(value);
    value = value.id;
  }
  assertStripeReference(value, 'pi_');
  return value;
}

function stripeCheckout(
  session: Stripe.Checkout.Session,
  eventType?: string,
): CheckoutSnapshot {
  if (session.object !== 'checkout.session' || session.mode !== 'payment' || session.livemode !== false) {
    throw new Error('Invalid Stripe test-mode payment session');
  }
  assertStripeReference(session.id, 'cs_test_');
  let status: CheckoutStatus = 'unknown';
  if (session.payment_status === 'paid') {
    status = 'paid';
  } else if (session.payment_status === 'unpaid') {
    if (eventType === 'checkout.session.async_payment_failed') status = 'failed';
    else if (session.status === 'expired') status = 'expired';
    else if (session.status === 'complete') status = 'pending';
    else if (session.status === 'open') status = 'open';
  }
  return normalizedCheckout({
    checkoutReference: session.id,
    paymentReference: paymentReference(session.payment_intent),
    amountCents: session.amount_total,
    currency: session.currency,
    status,
  });
}

function stripeRefund(refund: Stripe.Refund, eventType?: string): RefundResult {
  if (refund.object !== 'refund') throw new Error('Invalid Stripe refund');
  assertStripeReference(refund.id, 're_');
  let status: RefundStatus = 'unknown';
  switch (refund.status) {
    case 'pending':
    case 'requires_action':
      status = 'pending';
      break;
    case 'succeeded':
    case 'failed':
    case 'canceled':
      status = refund.status;
      break;
  }
  if (eventType === 'refund.failed' && status !== 'failed') status = 'unknown';
  return normalizedRefund({
    refundReference: refund.id,
    paymentReference: paymentReference(refund.payment_intent),
    amountCents: refund.amount,
    currency: refund.currency,
    status,
  });
}
