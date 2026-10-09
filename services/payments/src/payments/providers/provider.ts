import type { ProviderOutcome } from '../model.js';

export interface CreatePaymentInput {
  /** Our order id; also the provider-side reference. */
  reference: string;
  amountOre: number;
  description: string;
  /** Where the provider sends the payer back to. */
  returnUrl: string;
  idempotencyKey: string;
}

/** A provider's view of one payment (from a status lookup). */
export interface ProviderStatus {
  outcome: ProviderOutcome | 'pending';
  authorizedOre: number;
  capturedOre: number;
}

/** A verified webhook: what happened, to which order. */
export interface ProviderEvent {
  /** Unique per delivery content, for exactly-once processing. */
  eventId: string;
  reference: string;
  outcome: ProviderOutcome;
}

export interface IncomingWebhook {
  path: string;
  host: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

/** Rejected webhook: bad signature, stale timestamp or unparseable body. */
export class WebhookRejected extends Error {}

/**
 * A payment provider adapter. Raadi talks only to this interface; adding a
 * provider means one more implementation (ADR-0020).
 */
export interface PaymentProvider {
  readonly name: 'vipps' | 'stripe' | 'none';
  /** Whether the provider captures by itself (then capture() is not called). */
  readonly autoCapture: boolean;
  create(input: CreatePaymentInput): Promise<{ providerRef: string; redirectUrl: string }>;
  status(providerRef: string): Promise<ProviderStatus>;
  capture(providerRef: string, amountOre: number, idempotencyKey: string): Promise<void>;
  refund(providerRef: string, amountOre: number, idempotencyKey: string): Promise<void>;
  cancel(providerRef: string, idempotencyKey: string): Promise<void>;
  /** Verifies and parses a webhook; null for events Raadi does not act on. */
  verifyWebhook(req: IncomingWebhook): ProviderEvent | null;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export const header = (h: IncomingWebhook['headers'], name: string): string => {
  const v = h[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
