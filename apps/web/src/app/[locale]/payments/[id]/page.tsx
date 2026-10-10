import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OrderStatus } from '@/components/payments/order-status';
import { paymentOrder } from '@/lib/api';
import { getSession } from '@/lib/session';
import { ClientMessages } from '@/components/client-messages';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('payments');
  return { title: t('title'), robots: { index: false } };
}

/** Where the payment provider sends the payer back to. */
export default async function PaymentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated) {
    redirect(
      `/auth/login?returnTo=${encodeURIComponent(`/${locale}/payments/${id}`)}&locale=${locale}`,
    );
  }
  if (!UUID.test(id)) notFound();
  const order = await paymentOrder(id);
  if (!order) notFound();
  return (
    <ClientMessages set="payment">
      <div className="mx-auto max-w-2xl">
        <OrderStatus initial={order} />
      </div>
    </ClientMessages>
  );
}
