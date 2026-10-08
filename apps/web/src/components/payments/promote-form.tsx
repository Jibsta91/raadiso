'use client';

import type { PaymentOrder, PaymentProduct } from '@raadi/api-client';
import { Button, cn } from '@raadi/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { formatPrice } from '@/lib/format';

/**
 * Choose a promotion and pay at the provider's hosted page. One Idempotency-Key
 * per visit: a double click or a retry after a network error never buys twice.
 */
export function PromoteForm({
  listingId,
  products,
}: {
  listingId: string;
  products: PaymentProduct[];
}) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const [product, setProduct] = useState(products[0]?.id);
  const [key] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/payments/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ listingId, product, locale }),
      });
      if (res.ok) {
        const order = (await res.json()) as PaymentOrder;
        // A full navigation to the provider's page (not a client-side route).
        window.location.assign(order.redirectUrl ?? `/${locale}/payments/${order.id}`);
        return;
      }
      setError(
        t(
          res.status === 429
            ? 'errors.rateLimited'
            : res.status === 503
              ? 'errors.provider'
              : 'errors.generic',
        ),
      );
    } catch {
      setError(t('errors.generic'));
    }
    setSending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="promote-form">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{t('choose')}</legend>
        {products.map((p) => (
          <label
            key={p.id}
            className={cn(
              'cursor-pointer rounded-lg border p-4 transition-colors',
              product === p.id ? 'border-primary ring-2 ring-primary' : 'hover:bg-accent',
            )}
          >
            <input
              type="radio"
              name="product"
              value={p.id}
              checked={product === p.id}
              onChange={() => setProduct(p.id)}
              className="sr-only"
              data-testid={`product-${p.id}`}
            />
            <span className="block font-semibold">{t('days', { count: p.days })}</span>
            <span className="block text-2xl font-bold">
              {formatPrice({ amountMinor: p.amountOre, currency: 'NOK' }, locale)}
            </span>
            <span className="block text-xs text-muted-foreground">{t('vatIncluded')}</span>
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="promote-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={sending || !product} data-testid="promote-pay">
        {t('pay')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('hostedNote')}</p>
    </form>
  );
}
