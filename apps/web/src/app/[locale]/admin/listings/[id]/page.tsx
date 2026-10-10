import { ExternalLink, Flag, History, ImageOff, Store } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { dismissAction, removeListingAction } from '@/app/[locale]/admin/actions';
import { ActionDialog } from '@/components/admin/action-dialog';
import { CopyButton } from '@/components/admin/copy';
import { Ago } from '@/components/admin/time';
import { TrackRecent } from '@/components/admin/track-recent';
import { Empty, Id, KeyValues, Panel, Pill, Unavailable } from '@/components/admin/ui';
import { findPlace } from '@raadi/catalog';
import { Link } from '@/i18n/navigation';
import { adminAudit, AdminApiError, getAdminListing, settle, staffNames } from '@/lib/admin/api';
import { formatMoney } from '@raadi/catalog/money';
import { REMOVAL_REASONS } from '@/lib/admin/reasons';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { can, canOpen } from '@/lib/staff';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await settle(getAdminListing(id));
  return { title: listing?.title ?? 'Listing' };
}

/** One listing, any state: content, images, every report, the seller's history, staff actions. */
export default async function ListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('listings', session.user.roles)) notFound();
  const roles = session.user.roles;
  const [t, tx, tr, ta] = await Promise.all([
    getTranslations('admin.listings'),
    getTranslations('taxonomy'),
    getTranslations('report'),
    getTranslations('admin.audit'),
  ]);
  let l;
  try {
    l = await getAdminListing(id);
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 404) notFound();
    return <Unavailable>{t('unavailable')}</Unavailable>;
  }
  const history = await settle(adminAudit({ targetId: id, limit: 20 }));
  const names = await staffNames([
    ...(history?.items.map((e) => e.actor.id) ?? []),
    ...l.reports.flatMap((r) => (r.handledBy ? [r.handledBy] : [])),
  ]);
  const open = l.reports.filter((r) => r.status === 'open');
  const moderate = can('moderate', roles) && l.status !== 'deleted';

  return (
    <div className="space-y-6">
      <TrackRecent
        kind="listing"
        id={id}
        title={l.title}
        subtitle={l.sellerName}
        href={`/admin/listings/${id}`}
      />
      <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Link href="/admin/listings" prefetch={false} className="hover:underline">
              {t('back')}
            </Link>
            {' · '}
            {tx(`categories.${l.category}` as never)}
          </p>
          <h1 className="text-xl font-bold sm:text-2xl" data-testid="admin-title">
            {l.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pill
              tone={l.status === 'active' ? 'good' : l.status === 'deleted' ? 'bad' : 'neutral'}
              dot
              testId="listing-status"
            >
              {l.status === 'deleted' && l.removedBy === 'moderation'
                ? t('removedByModeration')
                : t(`status.${l.status}`)}
            </Pill>
            {l.removalReason ? (
              <Pill tone="bad">{t(`removalReasons.${l.removalReason}`)}</Pill>
            ) : null}
            {open.length ? (
              <Pill tone="bad">{t('openReports', { count: open.length })}</Pill>
            ) : null}
            {l.promotedUntil ? <Pill tone="info">{t('promoted')}</Pill> : null}
            <span className="font-semibold tabular-nums">
              {l.price === null ? '–' : formatMoney(l.price, locale)}
            </span>
            <CopyButton value={id} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {l.status !== 'deleted' ? (
            <a
              href={`${env.publicBaseUrl}/${locale}/listings/${id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold hover:bg-accent"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t('openOnSite')}
            </a>
          ) : null}
          {moderate && open.length ? (
            <ActionDialog
              action={dismissAction}
              label={t('dismiss')}
              icon="check"
              title={t('dismissTitle')}
              description={t('dismissDescription', { count: open.length })}
              hidden={{ id: [id] }}
              note={{ label: t('note') }}
              testId="listing-dismiss"
            />
          ) : null}
          {moderate ? (
            <ActionDialog
              action={removeListingAction}
              label={t('remove')}
              icon="trash"
              tone="danger"
              title={t('removeTitle')}
              description={t('removeDescription')}
              hidden={{ id }}
              reasons={{
                label: t('reason'),
                options: REMOVAL_REASONS.map((r) => ({
                  value: r,
                  label: t(`removalReasons.${r}`),
                })),
              }}
              note={{ label: t('note'), placeholder: t('notePlaceholder') }}
              testId="listing-remove"
            />
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Panel bodyClassName="p-2">
            {l.images.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {l.images.map((img, i) => (
                  <a
                    key={img.large}
                    href={img.large}
                    target="_blank"
                    rel="noreferrer"
                    className={i === 0 ? 'col-span-2 row-span-2' : ''}

                    aria-label={t('image', { n: i + 1 })}
                  >
                    <img
                      src={i === 0 ? img.large : img.card}
                      alt=""
                      className="aspect-[4/3] size-full rounded-card object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : (
              <Empty icon={ImageOff}>{t('noImages')}</Empty>
            )}
          </Panel>
          <Panel title={t('description')}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{l.description}</p>
            {Object.keys(l.attributes).length ? (
              <KeyValues
                className="mt-4 border-t pt-4"
                items={Object.entries(l.attributes).map(([k, v]) => [
                  tx.has(`attributes.${k}`) ? tx(`attributes.${k}` as never) : k,
                  tx.has(`values.${k}.${String(v)}`)
                    ? tx(`values.${k}.${String(v)}` as never)
                    : String(v),
                ])}
              />
            ) : null}
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title={t('seller')} icon={Store} testId="listing-seller">
            <div className="space-y-3 text-sm">
              <p className="flex items-center justify-between gap-2">
                <span className="font-semibold">{l.sellerName}</span>
                {canOpen('users', roles) ? (
                  <Link
                    href={`/admin/users/${l.ownerId}`}
                    prefetch={false}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    {t('openAccount')}
                  </Link>
                ) : (
                  <Id value={l.ownerId} />
                )}
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  [t('sellerStats.active'), l.seller.active],
                  [t('sellerStats.sold'), l.seller.sold],
                  [t('sellerStats.removed'), l.seller.removedByModeration],
                ].map(([k, v]) => (
                  <div key={String(k)} className="rounded-card bg-muted p-2">
                    <p className="text-lg font-bold tabular-nums">{v}</p>
                    <p className="text-xs text-muted-foreground">{k}</p>
                  </div>
                ))}
              </div>
              <KeyValues
                items={[
                  [t('sellerStats.reports'), l.seller.reports],
                  [
                    t('sellerStats.since'),
                    l.seller.firstListingAt ? <Ago key="s" at={l.seller.firstListingAt} /> : '–',
                  ],
                  [t('fields.created'), <Ago key="c" at={l.createdAt} />],
                  [t('fields.updated'), <Ago key="u" at={l.updatedAt} />],
                  [t('fields.place'), findPlace(l.placeId)?.name ?? l.placeId],
                ]}
              />
              {l.otherListings.length ? (
                <ul className="space-y-1.5 border-t pt-3">
                  {l.otherListings.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/admin/listings/${o.id}`}
                        prefetch={false}
                        className="flex items-center gap-2 hover:underline"
                      >
                        {o.image ? (
                          <img
                            src={o.image.thumb}
                            alt=""
                            className="size-7 rounded-field object-cover"
                          />
                        ) : (
                          <span className="size-7 rounded-field bg-placeholder" />
                        )}
                        <span className="truncate">{o.title}</span>
                        <Pill tone={o.status === 'active' ? 'good' : 'neutral'} className="ms-auto">
                          {t(`status.${o.status}`)}
                        </Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Panel>
          <Panel title={t('reports')} icon={Flag} testId="listing-reports">
            {l.reports.length === 0 ? (
              <Empty>{t('noReports')}</Empty>
            ) : (
              <ul className="space-y-3">
                {l.reports.map((r) => {
                  const by = r.handledBy ? names.get(r.handledBy) : undefined;
                  return (
                    <li key={r.id} className="space-y-1 text-sm">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={r.reason === 'fraud' ? 'bad' : 'neutral'}>
                          {tr(`reasons.${r.reason}` as never)}
                        </Pill>
                        <Pill
                          tone={
                            r.status === 'open' ? 'warn' : r.status === 'resolved' ? 'bad' : 'good'
                          }
                        >
                          {t(`reportStatus.${r.status}`)}
                        </Pill>
                        <span className="ms-auto text-xs text-muted-foreground">
                          <Ago at={r.createdAt} />
                        </span>
                      </p>
                      {r.comment ? (
                        <p className="border-s-2 ps-3 text-subtle-foreground">{r.comment}</p>
                      ) : null}
                      {r.handledAt ? (
                        <p className="text-xs text-muted-foreground">
                          {t('handledBy', {
                            name: by?.name ?? by?.email ?? r.handledBy!.slice(0, 8),
                          })}{' '}
                          · <Ago at={r.handledAt} />
                          {r.handledNote ? ` · “${r.handledNote}”` : ''}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title={t('history')} icon={History}>
            {!history?.items.length ? (
              <Empty>{t('noHistory')}</Empty>
            ) : (
              <ol className="space-y-2 text-sm">
                {history.items.map((e) => {
                  const actor = names.get(e.actor.id);
                  return (
                    <li key={e.id}>
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
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
