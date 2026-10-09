import type { PaymentProvider } from './provider.js';

/**
 * No payment provider (PAYMENTS_PROVIDER=none, ADR-0051): promotions are switched off until one is
 * chosen for the country. The service still starts, lists no products and refuses new orders (the
 * service answers 503 before any of these is called), so nothing here is ever reached by a buyer.
 */
export class NoProvider implements PaymentProvider {
  readonly name = 'none' as const;
  readonly autoCapture = true;
  private off(): never {
    throw new Error('payments are switched off (PAYMENTS_PROVIDER=none)');
  }
  create(): never {
    return this.off();
  }
  status(): never {
    return this.off();
  }
  capture(): never {
    return this.off();
  }
  refund(): never {
    return this.off();
  }
  cancel(): never {
    return this.off();
  }
  verifyWebhook(): null {
    return null;
  }
}
