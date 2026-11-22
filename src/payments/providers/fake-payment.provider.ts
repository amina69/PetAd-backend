import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CheckoutSnapshot,
  CreateCheckoutInput,
  CreateCheckoutResult,
  GetStatusInput,
  PaymentProvider,
  ProviderWebhookEvent,
  RefundInput,
  RefundResult,
  VerifyWebhookInput,
} from './payment-provider';
import {
  assertReference,
  validateCreateCheckout,
  validateGetStatus,
  validateNormalizedEvent,
  validateRefund,
  validateWebhookInput,
} from './validation';

export interface FakePaymentProviderConfig {
  environment: 'development' | 'test';
  webhookSecret: string;
}

export interface FakeSignedWebhook {
  payload: Buffer;
  signature: string;
}

type FakeCheckout = {
  snapshot: CheckoutSnapshot;
  completionEvent?: ProviderWebhookEvent;
};

type FakeRefund = {
  result: RefundResult;
  completionEvent?: ProviderWebhookEvent;
};

type IdempotentCommand = {
  operation: 'checkout' | 'refund';
  fingerprint: string;
  result: CreateCheckoutResult | RefundResult;
};

/** In-memory test double; all state and idempotency records disappear on restart. */
export class FakePaymentProvider implements PaymentProvider {
  private readonly secret: string;
  private readonly checkouts = new Map<string, FakeCheckout>();
  private readonly payments = new Map<string, FakeCheckout>();
  private readonly refunds = new Map<string, FakeRefund>();
  private readonly commands = new Map<string, IdempotentCommand>();
  private checkoutSequence = 0;
  private paymentSequence = 0;
  private refundSequence = 0;
  private eventSequence = 0;

  constructor(config: FakePaymentProviderConfig) {
    if (
      !config ||
      (config.environment !== 'development' && config.environment !== 'test') ||
      process.env.NODE_ENV?.trim().toLowerCase() === 'production'
    ) {
      throw new Error('Fake payment provider is disabled outside development and test');
    }
    if (
      typeof config.webhookSecret !== 'string' ||
      config.webhookSecret.length < 16 ||
      config.webhookSecret.length > 512
    ) {
      throw new Error('Invalid fake webhook secret');
    }
    this.secret = config.webhookSecret;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    validateCreateCheckout(input);
    const fingerprint = JSON.stringify([
      input.amountCents,
      input.currency,
      input.successUrl,
      input.cancelUrl,
    ]);
    const previous = this.replay<CreateCheckoutResult>(
      input.idempotencyKey,
      'checkout',
      fingerprint,
    );
    if (previous) return previous;

    const checkoutReference = this.id('cs', ++this.checkoutSequence);
    const snapshot: CheckoutSnapshot = {
      checkoutReference,
      paymentReference: null,
      status: 'open',
      amountCents: input.amountCents,
      currency: input.currency,
    };
    const result: CreateCheckoutResult = {
      ...snapshot,
      checkoutUrl: `https://fake-checkout.invalid/session/${checkoutReference}`,
    };
    this.checkouts.set(checkoutReference, { snapshot });
    this.remember(input.idempotencyKey, 'checkout', fingerprint, result);
    return { ...result };
  }

  async getStatus(input: GetStatusInput): Promise<CheckoutSnapshot> {
    validateGetStatus(input);
    const checkout = this.checkouts.get(input.checkoutReference);
    if (!checkout) throw new Error('Checkout not found');
    return { ...checkout.snapshot };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    validateRefund(input);
    const fingerprint = JSON.stringify([
      input.paymentReference,
      input.amountCents,
      input.currency,
    ]);
    const previous = this.replay<RefundResult>(
      input.idempotencyKey,
      'refund',
      fingerprint,
    );
    if (previous) return previous;

    const checkout = this.payments.get(input.paymentReference);
    if (!checkout || checkout.snapshot.status !== 'paid') {
      throw new Error('Paid payment not found');
    }
    const reserved = [...this.refunds.values()]
      .filter(
        ({ result }) =>
          result.paymentReference === input.paymentReference &&
          (result.status === 'pending' || result.status === 'succeeded'),
      )
      .reduce((sum, { result }) => sum + result.amountCents, 0);
    if (reserved + input.amountCents > (checkout.snapshot.amountCents ?? 0)) {
      throw new Error('Refund exceeds available payment amount');
    }
    const result: RefundResult = {
      refundReference: this.id('re', ++this.refundSequence),
      paymentReference: input.paymentReference,
      amountCents: input.amountCents,
      currency: input.currency,
      status: 'pending',
    };
    this.refunds.set(result.refundReference, { result: { ...result } });
    this.remember(input.idempotencyKey, 'refund', fingerprint, result);
    return { ...result };
  }

  /** Complete once; repeat calls return identical, replayable signed bytes. */
  completeCheckout(checkoutReference: string): FakeSignedWebhook {
    assertReference(checkoutReference);
    const checkout = this.checkouts.get(checkoutReference);
    if (!checkout) throw new Error('Checkout not found');
    if (!checkout.completionEvent) {
      const paymentReference = this.id('pi', ++this.paymentSequence);
      checkout.snapshot = { ...checkout.snapshot, paymentReference, status: 'paid' };
      this.payments.set(paymentReference, checkout);
      checkout.completionEvent = {
        id: this.id('evt', ++this.eventSequence),
        type: 'checkout.status_changed',
        checkout: { ...checkout.snapshot },
      };
    }
    return this.sign(checkout.completionEvent);
  }

  /** Complete a pending refund once; repeat calls replay the same event. */
  completeRefund(refundReference: string): FakeSignedWebhook {
    assertReference(refundReference);
    const refund = this.refunds.get(refundReference);
    if (!refund) throw new Error('Refund not found');
    if (!refund.completionEvent) {
      refund.result = { ...refund.result, status: 'succeeded' };
      refund.completionEvent = {
        id: this.id('evt', ++this.eventSequence),
        type: 'refund.status_changed',
        refund: { ...refund.result },
      };
    }
    return this.sign(refund.completionEvent);
  }

  verifyWebhook(input: VerifyWebhookInput): ProviderWebhookEvent {
    validateWebhookInput(input);
    if (!/^fake-v1=[0-9a-f]{64}$/.test(input.signature)) {
      throw new Error('Invalid fake webhook signature');
    }
    const supplied = Buffer.from(input.signature.slice(8), 'hex');
    const expected = createHmac('sha256', this.secret).update(input.payload).digest();
    if (!timingSafeEqual(supplied, expected)) {
      throw new Error('Invalid fake webhook signature');
    }
    let event: unknown;
    try {
      event = JSON.parse(input.payload.toString('utf8')) as unknown;
    } catch {
      throw new Error('Invalid fake webhook payload');
    }
    return validateNormalizedEvent(event);
  }

  private id(kind: string, sequence: number): string {
    return `fake_${kind}_${String(sequence).padStart(6, '0')}`;
  }

  private sign(event: ProviderWebhookEvent): FakeSignedWebhook {
    const payload = Buffer.from(JSON.stringify(event), 'utf8');
    const digest = createHmac('sha256', this.secret).update(payload).digest('hex');
    return { payload, signature: `fake-v1=${digest}` };
  }

  private replay<T extends CreateCheckoutResult | RefundResult>(
    key: string,
    operation: IdempotentCommand['operation'],
    fingerprint: string,
  ): T | undefined {
    const command = this.commands.get(key);
    if (!command) return undefined;
    if (command.operation !== operation || command.fingerprint !== fingerprint) {
      throw new Error('Idempotency key reused with different parameters');
    }
    return { ...command.result } as T;
  }

  private remember(
    key: string,
    operation: IdempotentCommand['operation'],
    fingerprint: string,
    result: CreateCheckoutResult | RefundResult,
  ): void {
    this.commands.set(key, { operation, fingerprint, result: { ...result } });
  }
}
