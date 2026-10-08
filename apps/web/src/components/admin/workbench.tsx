'use client';

import type { WorkbenchItem } from '@raadi/api-client';
import { cn } from '@raadi/ui';
import { ExternalLink, Flag, ImageOff, ShieldCheck } from 'lucide-react';
import { formatMoney } from '@raadi/catalog/money';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { dismissAction, removeListingAction } from '@/app/[locale]/admin/actions';
import { Link } from '@/i18n/navigation';
import { REMOVAL_REASONS } from '@/lib/admin/reasons';
import { ActionDialog } from './action-dialog';

const riskTone = (risk: number) =>
  risk >= 60
    ? 'bg-destructive text-destructive-foreground'
    : risk >= 30
      ? 'bg-highlight text-highlight-foreground'
      : 'bg-muted text-subtle-foreground';

/**
 * The moderation workbench (ADR-0030): reported listings, riskiest first, on the left; everything
 * needed to decide on the right. j/k move, x removes, d dismisses, space selects for bulk dismiss.
 */
export function Workbench({
  items,
  publicBaseUrl,
}: {
  items: WorkbenchItem[];
  publicBaseUrl: string;
}) {
  const t = useTranslations('admin.moderation');
  const tr = useTranslations('report');
  const tl = useTranslations('admin.listings');
  const format = useFormatter();
  const locale = useLocale();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const current = items[Math.min(index, items.length - 1)];

  // Keep the selection valid when the queue changes after a decision.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
    setSelected((s) => new Set([...s].filter((id) => items.some((i) => i.listing.id === id))));
  }, [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input,textarea,select,dialog')) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === ' ' && current) {
        e.preventDefault();
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(current.listing.id)) next.delete(current.listing.id);
          else next.add(current.listing.id);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, current]);

  useEffect(() => {
    document.querySelector(`[data-wb-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const ids = useMemo(() => [...selected], [selected]);

  if (!current) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-20 text-center"
        data-testid="moderation-empty"
      >
        <ShieldCheck aria-hidden className="size-12 text-success" />
        <p className="text-lg font-semibold">{t('emptyTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </div>
    );
  }
  const l = current.listing;
  const open = l.reports.filter((r) => r.status === 'open');

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]" data-testid="moderation-queue">
      <div className="space-y-2">
        {selected.size ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-ink px-3 py-2 text-sm text-ink-foreground">
            <span>{t('selected', { count: selected.size })}</span>
            <ActionDialog
              action={dismissAction}
              label={t('dismissSelected')}
              icon="check"
              size="sm"
              title={t('bulkTitle', { count: selected.size })}
              description={t('bulkDescription')}
              hidden={{ id: ids }}
              note={{ label: t('note') }}
              testId="moderation-bulk-dismiss"
            />
          </div>
        ) : null}
        <ul
          aria-label={t('queue')}
          className="max-h-[calc(100vh-14rem)] space-y-1.5 overflow-y-auto pe-1"
        >
          {items.map((item, i) => (
            <li
              key={item.listing.id}
              data-wb-index={i}
              data-testid="moderation-item"
              className={cn(
                'flex items-center gap-3 rounded-2xl border p-2.5 transition-colors',
                i === index
                  ? 'border-ink bg-card shadow-sm ring-1 ring-ink'
                  : 'bg-card/60 hover:bg-card',
              )}
            >
              <input
                type="checkbox"
                aria-label={`${t('select')}: ${item.listing.title}`}
                checked={selected.has(item.listing.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(item.listing.id)) next.delete(item.listing.id);
                    else next.add(item.listing.id);
                    return next;
                  })
                }
                className="size-4 shrink-0"
              />
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.listing.image ? (
                  <img
                    src={item.listing.image.thumb}
                    alt=""
                    className="size-11 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="size-11 shrink-0 rounded-xl bg-placeholder" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.listing.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t('count', { count: item.count })} ·{' '}
                    {format.relativeTime(new Date(item.firstReportedAt), new Date())}
                  </span>
                </span>
                <span
                  className={cn(
                    'rounded-lg px-1.5 py-0.5 text-xs font-bold tabular-nums',
                    riskTone(item.risk),
                  )}
                  title={t('risk')}
                >
                  {item.risk}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="px-1 text-[11px] text-muted-foreground">{t('keys')}</p>
      </div>

      <article
        className="min-w-0 space-y-4 rounded-3xl border bg-card p-5"
        data-testid="moderation-detail"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={cn('rounded-md px-1.5 py-0.5 font-bold', riskTone(current.risk))}>
                {t('riskLabel', { risk: current.risk })}
              </span>
              <span>{l.sellerName}</span>
              <span>· {format.relativeTime(new Date(l.createdAt), new Date())}</span>
            </p>
            <h2 className="text-xl font-bold">{l.title}</h2>
            <p className="font-semibold tabular-nums">
              {l.price === null ? '–' : formatMoney(l.price, locale)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionDialog
              action={dismissAction}
              label={t('dismiss')}
              icon="check"
              title={t('dismissTitle')}
              description={t('dismissDescription', { count: open.length })}
              hidden={{ id: [l.id] }}
              note={{
                label: t('note'),
                templates: [t('templates.fine'), t('templates.duplicateReport')],
              }}
              shortcut="d"
              testId="moderation-dismiss"
            />
            <ActionDialog
              action={removeListingAction}
              label={t('remove')}
              icon="trash"
              tone="danger"
              title={t('removeTitle')}
              description={t('removeDescription')}
              hidden={{ id: l.id }}
              reasons={{
                label: t('reason'),
                options: REMOVAL_REASONS.map((r) => ({
                  value: r,
                  label: tl(`removalReasons.${r}`),
                })),
              }}
              note={{ label: t('note'), placeholder: t('notePlaceholder') }}
              shortcut="x"
              testId="moderation-remove"
            />
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {l.images.length ? (
            l.images.map((img, n) => (
              <a
                key={img.card}
                href={img.large}
                target="_blank"
                rel="noreferrer"
                aria-label={t('image', { n: n + 1 })}
                className="shrink-0"
              >
                <img src={img.card} alt="" className="h-36 w-48 rounded-2xl object-cover" />
              </a>
            ))
          ) : (
            <div className="flex h-36 w-48 items-center justify-center rounded-2xl bg-placeholder">
              <ImageOff aria-hidden className="size-6 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 font-sans text-sm font-semibold tracking-normal">
              <Flag aria-hidden className="size-4 text-destructive" />
              {t('why')}
            </h3>
            <p className="flex flex-wrap gap-1.5">
              {Object.entries(current.reasons).map(([reason, n]) => (
                <span
                  key={reason}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-semibold',
                    reason === 'fraud'
                      ? 'bg-destructive/12 text-destructive'
                      : 'bg-soft text-soft-foreground',
                  )}
                >
                  {tr(`reasons.${reason}` as never)} · {n}
                </span>
              ))}
            </p>
            <ul className="space-y-1.5 text-sm">
              {open
                .filter((r) => r.comment)
                .slice(0, 6)
                .map((r) => (
                  <li key={r.id} className="border-s-2 ps-3 text-subtle-foreground">
                    {r.comment}
                  </li>
                ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h3 className="font-sans text-sm font-semibold tracking-normal">
              {t('sellerHistory')}
            </h3>
            <dl className="grid grid-cols-2 gap-2 text-center">
              {[
                [t('seller.active'), l.seller.active],
                [t('seller.removed'), l.seller.removedByModeration],
                [t('seller.reports'), l.seller.reports],
                [
                  t('seller.since'),
                  l.seller.firstListingAt
                    ? format.relativeTime(new Date(l.seller.firstListingAt), new Date())
                    : '–',
                ],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-xl bg-muted p-2">
                  <dd className="text-base font-bold tabular-nums">{v}</dd>
                  <dt className="text-[11px] text-muted-foreground">{k}</dt>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <section className="space-y-1.5">
          <h3 className="font-sans text-sm font-semibold tracking-normal">{t('description')}</h3>
          <p className="line-clamp-[12] whitespace-pre-wrap text-sm leading-relaxed text-subtle-foreground">
            {l.description}
          </p>
        </section>

        <div className="flex flex-wrap gap-3 border-t pt-4 text-sm">
          <Link
            href={`/admin/listings/${l.id}`}
            prefetch={false}
            className="font-semibold text-primary hover:underline"
          >
            {t('openDetail')}
          </Link>
          <a
            href={`${publicBaseUrl}/listings/${l.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            {t('openOnSite')}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        </div>
      </article>
    </div>
  );
}
