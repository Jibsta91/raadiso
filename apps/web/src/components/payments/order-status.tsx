'use client';

import type { PaymentOrder } from '@raadi/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';

const OPEN = new Set(['created', 'authorized']);

/**
 * Shows an order's outcome after the provider redirects back. While the
 * provider's confirmation (webhook) is on its way, it polls the order.
 */
export function OrderStatus({ initial }: { initial: PaymentOrder }) {
  const t = useTranslations('payments');
  const format = useFormatter();
  const [order, setOrder] = useState(initial);

  useEffect(() => {
    if (!OPEN.has(order.status)) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const res = await fetch(`/api/v1/payments/orders/${order.id}`).catch(() => null);
      if (res?.ok) setOrder((await res.json()) as PaymentOrder);
      if (tries > 30) clearInterval(timer);
    }, 2_000);
    return () => clearInterval(timer);
  }, [order.id, order.status]);

  const done = order.status === 'captured';
  return (
    <div className="space-y-4" data-testid="order-status" data-status={order.status}>
      <h1 className="text-xl font-bold">{t(`status.${order.status}`)}</h1>
      {done && order.promotedUntil ? (
        <p data-testid="order-promoted-until">
          {t('promotedUntil', {
            date: format.dateTime(new Date(order.promotedUntil), { dateStyle: 'long' }),
          })}
        </p>
      ) : null}
      {OPEN.has(order.status) ? <p className="text-muted-foreground">{t('waiting')}</p> : null}
      {done ? <p className="text-sm text-muted-foreground">{t('receipt')}</p> : null}
      <div className="flex gap-3">
        <Link href={`/listings/${order.listingId}`} className="text-primary hover:underline">
          {t('toListing')}
        </Link>
        {!done && !OPEN.has(order.status) ? (
          <Link
            href={`/listings/${order.listingId}/promote`}
            className="text-primary hover:underline"
            data-testid="order-retry"
          >
            {t('tryAgain')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
