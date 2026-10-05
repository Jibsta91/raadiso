import { History } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LiveRefresh } from '@/components/admin/live';
import { Ago } from '@/components/admin/time';
import { Empty, PageHeader, Pill, Stat, Table, Tabs, td, Unavailable } from '@/components/admin/ui';
import { Workbench } from '@/components/admin/workbench';
import { Link } from '@/i18n/navigation';
import { listingStats, moderationHistory, settle, staffNames, workbench } from '@/lib/admin/api';
import { duration } from '@/lib/admin/format';
import { env } from '@/lib/env';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('moderation'), robots: { index: false } };
}

/** The moderation workbench and the team's recent decisions (moderators, platform admins). */
export default async function ModerationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('moderation', session.user.roles)) notFound();
  const t = await getTranslations('admin.moderation');
  const view = sp.view === 'history' ? 'history' : sp.view === 'mine' ? 'mine' : 'queue';

  const [stats, queue, history] = await Promise.all([
    settle(listingStats()),
    view === 'queue' ? settle(workbench()) : null,
    view !== 'queue'
      ? settle(moderationHistory(view === 'mine' ? session.user.id : undefined))
      : null,
  ]);
  const mod = stats?.moderation;
  const names = history ? await staffNames(history.items.map((h) => h.handledBy)) : new Map();

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} intro={t('intro')} actions={<LiveRefresh seconds={20} />} />
      {mod ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label={t('stats.open')}
            value={mod.listings}
            hint={t('stats.reports', { count: mod.open })}
            tone={mod.listings ? 'bad' : 'good'}
          />
          <Stat
            label={t('stats.oldest')}
            value={
              mod.oldestAt ? duration((Date.now() - Date.parse(mod.oldestAt)) / 1000, locale) : '–'
            }
            hint={t('stats.oldestHint')}
          />
          <Stat
            label={t('stats.median')}
            value={
              mod.medianHandleSeconds !== null ? duration(mod.medianHandleSeconds, locale) : '–'
            }
            hint={t('stats.medianHint')}
          />
          <Stat
            label={t('stats.handled')}
            value={mod.handled7d}
            trend={mod.handled.map((d) => d.count)}
            hint={t('stats.split', { removed: mod.removed7d, dismissed: mod.dismissed7d })}
            tone="good"
          />
        </div>
      ) : null}
      <Tabs
        label={t('views')}
        current={view}
        tabs={[
          { key: 'queue', href: '/admin/moderation', label: t('tabs.queue'), count: mod?.listings },
          { key: 'mine', href: '/admin/moderation?view=mine', label: t('tabs.mine') },
          { key: 'history', href: '/admin/moderation?view=history', label: t('tabs.history') },
        ]}
      />
      {view === 'queue' ? (
        queue ? (
          <Workbench items={queue.items} publicBaseUrl={`${env.publicBaseUrl}/${locale}`} />
        ) : (
          <Unavailable>{t('unavailable')}</Unavailable>
        )
      ) : !history ? (
        <Unavailable>{t('unavailable')}</Unavailable>
      ) : history.items.length === 0 ? (
        <Empty icon={History}>{t('noHistory')}</Empty>
      ) : (
        <Table
          testId="moderation-history"
          head={[
            t('columns.listing'),
            t('columns.outcome'),
            t('columns.reports'),
            t('columns.by'),
            t('columns.time'),
            t('columns.when'),
          ]}
        >
          {history.items.map((h) => {
            const by = names.get(h.handledBy);
            return (
              <tr key={`${h.listingId}-${h.handledAt}`} className="hover:bg-accent/50">
                <td className={td}>
                  <Link
                    href={`/admin/listings/${h.listingId}`}
                    prefetch={false}
                    className="font-medium hover:underline"
                  >
                    {h.title}
                  </Link>
                  {h.note ? <p className="text-xs text-muted-foreground">“{h.note}”</p> : null}
                </td>
                <td className={td}>
                  <Pill tone={h.outcome === 'resolved' ? 'bad' : 'good'}>
                    {t(`outcome.${h.outcome}`)}
                  </Pill>
                </td>
                <td className={`${td} tabular-nums`}>{h.reports}</td>
                <td className={td}>{by?.name ?? by?.email ?? h.handledBy.slice(0, 8)}</td>
                <td className={`${td} tabular-nums text-muted-foreground`}>
                  {duration(h.secondsToDecision, locale)}
                </td>
                <td className={`${td} text-muted-foreground`}>
                  <Ago at={h.handledAt} />
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
