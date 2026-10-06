import { CircleDot, Megaphone } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { refundAction } from '@/app/[locale]/admin/actions';
import { ActionDialog } from '@/components/admin/action-dialog';
import { CopyButton } from '@/components/admin/copy';
import { Ago } from '@/components/admin/time';
import { TrackRecent } from '@/components/admin/track-recent';
import { Empty, Id, KeyValues, Panel, Pill, Unavailable } from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import { adminAudit, AdminApiError, getOrder, settle, staffNames } from '@/lib/admin/api';
import { nok } from '@/lib/admin/format';
import { REFUND_REASONS } from '@/lib/admin/reasons';
import { orderTone } from '@/lib/admin/tones';
import { getSession } from '@/lib/session';
import { can, canOpen } from '@/lib/staff';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `#${id.slice(0, 8)}` };
}

/** One order: amounts, provider, status history, the promotion it bought, refunds. */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('orders', session.user.roles)) notFound();
  const roles = session.user.roles;
  const [t, ta] = await Promise.all([
    getTranslations('admin.orders'),
    getTranslations('admin.audit'),
  ]);
  let o;
  try {
    o = await getOrder(id);
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 404) notFound();
    return <Unavailable>{t('unavailable')}</Unavailable>;
  }
  const history = await settle(adminAudit({ targetId: id, limit: 20 }));
  const names = await staffNames(history?.items.map((e) => e.actor.id) ?? []);
  const amount = nok(o.amountOre, locale);

  return (
    <div className="space-y-6">
      <TrackRecent
        kind="order"
        id={id}
        title={`${t(`products.${o.product}` as never)} · ${amount}`}
        subtitle={o.status}
        href={`/admin/orders/${id}`}
      />
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Link href="/admin/orders" prefetch={false} className="hover:underline">
              {t('back')}
            </Link>
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl" data-testid="admin-title">
            {t(`products.${o.product}` as never)} · <span className="tabular-nums">{amount}</span>
          </h1>
          <p className="flex flex-wrap items-center gap-2">
            <Pill tone={orderTone(o.status)} dot testId="order-status">
              {t(`status.${o.status}`)}
            </Pill>
            <CopyButton value={id} />
          </p>
        </div>
        {can('refund', roles) && o.status === 'captured' ? (
          <ActionDialog
            action={refundAction}
            label={t('refund')}
            icon="refund"
            tone="danger"
            title={t('refundTitle', { amount })}
            description={t('refundDescription')}
            hidden={{ id }}
            stepUp
            reasons={{
              label: t('reason'),
              options: REFUND_REASONS.map((r) => ({ value: r, label: t(`refundReasons.${r}`) })),
            }}
            note={{ label: t('note') }}
            confirmText={amount}
            testId="order-refund"
          />
        ) : null}
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('details')}>
          <KeyValues
            items={[
              [t('fields.id'), <Id key="id" value={o.id} />],
              [
                t('fields.user'),
                canOpen('users', roles) ? (
                  <Id key="u" value={o.userId} href={`/admin/users/${o.userId}`} />
                ) : (
                  <Id key="u" value={o.userId} />
                ),
              ],
              [
                t('fields.listing'),
                canOpen('listings', roles) ? (
                  <Id key="l" value={o.listingId} href={`/admin/listings/${o.listingId}`} />
                ) : (
                  <Id key="l" value={o.listingId} />
                ),
              ],
              [t('fields.provider'), o.provider],
              [
                t('fields.providerRef'),
                o.providerRef ? (
                  <span key="r" className="font-mono text-xs">
                    {o.providerRef}
                  </span>
                ) : (
                  '–'
                ),
              ],
              [t('fields.created'), <Ago key="c" at={o.createdAt} />],
              [t('fields.updated'), <Ago key="up" at={o.updatedAt} />],
            ]}
          />
        </Panel>
        <Panel title={t('promotion')} icon={Megaphone}>
          {o.promotion ? (
            <KeyValues
              items={[
                [t('fields.starts'), <Ago key="s" at={o.promotion.startsAt} />],
                [t('fields.ends'), <Ago key="e" at={o.promotion.endsAt} />],
                [
                  t('fields.revoked'),
                  o.promotion.revokedAt ? <Ago key="r" at={o.promotion.revokedAt} /> : '–',
                ],
              ]}
            />
          ) : (
            <Empty>{t('noPromotion')}</Empty>
          )}
        </Panel>
      </div>
      <Panel title={t('timeline')} icon={CircleDot} testId="order-timeline">
        <ol className="relative space-y-4 border-s ps-5">
          <li className="relative text-sm">
            <span className="absolute -start-[26px] top-1 size-3 rounded-full border-2 border-background bg-muted-foreground" />
            <p className="font-medium">{t('status.created')}</p>
            <p className="text-xs text-muted-foreground">
              <Ago at={o.createdAt} />
            </p>
          </li>
          {o.events.map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute -start-[26px] top-1 size-3 rounded-full border-2 border-background bg-primary" />
              <p className="font-medium">
                {t(`status.${e.to}` as never)}{' '}
                <span className="text-muted-foreground">· {t(`sources.${e.source}` as never)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                <Ago at={e.at} />
              </p>
            </li>
          ))}
          {history?.items.map((e) => {
            const actor = names.get(e.actor.id);
            return (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -start-[26px] top-1 size-3 rounded-full border-2 border-background bg-destructive" />
                <p className="font-medium">
                  {ta(`actionNames.${e.action.replace(/\./g, '_')}` as never)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {actor?.name ?? actor?.email ?? e.actor.id.slice(0, 8)} · <Ago at={e.at} />
                  {e.reason ? ` · “${e.reason}”` : ''}
                </p>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
