import {
  CheckoutSnapshot,
  CheckoutStatus,
  CreateCheckoutInput,
  GetStatusInput,
  ProviderWebhookEvent,
  RefundInput,
  RefundResult,
  RefundStatus,
  VerifyWebhookInput,
} from './payment-provider';

const MAX_AMOUNT_CENTS = 99_999_999;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const CHECKOUT_STATUSES: readonly CheckoutStatus[] = [
  'open',
  'pending',
  'paid',
  'failed',
  'expired',
  'unknown',
];
const REFUND_STATUSES: readonly RefundStatus[] = [
  'pending',
  'succeeded',
  'failed',
  'canceled',
  'unknown',
];

export function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
}

export function assertReference(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !REFERENCE_PATTERN.test(value)) {
    throw new Error('Invalid provider reference or idempotency key');
  }
}

export function assertCurrency(value: unknown): asserts value is 'usd' {
  if (value !== 'usd') throw new Error('Only USD is supported');
}

export function assertAmount(value: unknown, minimum = 1): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > MAX_AMOUNT_CENTS
  ) {
    throw new Error('Invalid amount in USD cents');
  }
}

export function assertHttpsUrl(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    value.trim() !== value ||
    /[\x00-\x20\x7f]/.test(value)
  ) {
    throw new Error('Invalid HTTPS URL');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      throw new Error();
    }
  } catch {
    throw new Error('Invalid HTTPS URL');
  }
}

export function validateCreateCheckout(input: CreateCheckoutInput): void {
  assertRecord(input);
  assertAmount(input.amountCents, 50);
  assertCurrency(input.currency);
  assertHttpsUrl(input.successUrl);
  assertHttpsUrl(input.cancelUrl);
  assertReference(input.idempotencyKey);
}

export function validateGetStatus(input: GetStatusInput): void {
  assertRecord(input);
  assertReference(input.checkoutReference);
}

export function validateRefund(input: RefundInput): void {
  assertRecord(input);
  assertReference(input.paymentReference);
  assertAmount(input.amountCents);
  assertCurrency(input.currency);
  assertReference(input.idempotencyKey);
}

export function validateWebhookInput(input: VerifyWebhookInput): void {
  assertRecord(input);
  if (!Buffer.isBuffer(input.payload) || input.payload.length === 0) {
    throw new Error('Webhook payload must be nonempty raw bytes');
  }
  if (typeof input.signature !== 'string' || input.signature.length === 0) {
    throw new Error('Missing webhook signature');
  }
}

/** Rebuild a normalized event without forwarding arbitrary provider data. */
export function validateNormalizedEvent(value: unknown): ProviderWebhookEvent {
  assertRecord(value);
  assertReference(value.id);
  if (value.type === 'checkout.status_changed') {
    const checkout = normalizedCheckout(value.checkout);
    return { id: value.id, type: value.type, checkout };
  }
  if (value.type === 'refund.status_changed') {
    const refund = normalizedRefund(value.refund);
    return { id: value.id, type: value.type, refund };
  }
  if (value.type === 'unhandled') {
    assertReference(value.providerEventType);
    return { id: value.id, type: value.type, providerEventType: value.providerEventType };
  }
  throw new Error('Invalid webhook event type');
}

export function normalizedCheckout(value: unknown): CheckoutSnapshot {
  assertRecord(value);
  assertReference(value.checkoutReference);
  if (value.paymentReference !== null) assertReference(value.paymentReference);
  if (value.amountCents !== null) assertAmount(value.amountCents);
  if (value.currency !== null) assertCurrency(value.currency);
  if (!CHECKOUT_STATUSES.includes(value.status as CheckoutStatus)) {
    throw new Error('Invalid checkout status');
  }
  if (
    value.status === 'paid' &&
    (value.paymentReference === null || value.amountCents === null || value.currency === null)
  ) {
    throw new Error('Paid checkout is missing payment details');
  }
  return {
    checkoutReference: value.checkoutReference,
    paymentReference: value.paymentReference,
    status: value.status as CheckoutStatus,
    amountCents: value.amountCents,
    currency: value.currency,
  };
}

export function normalizedRefund(value: unknown): RefundResult {
  assertRecord(value);
  assertReference(value.refundReference);
  assertReference(value.paymentReference);
  assertAmount(value.amountCents);
  assertCurrency(value.currency);
  if (!REFUND_STATUSES.includes(value.status as RefundStatus)) {
    throw new Error('Invalid refund status');
  }
  return {
    refundReference: value.refundReference,
    paymentReference: value.paymentReference,
    amountCents: value.amountCents,
    currency: value.currency,
    status: value.status as RefundStatus,
  };
}
