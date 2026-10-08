import {
  Activity,
  AlertOctagon,
  BarChart3,
  ExternalLink,
  Inbox,
  KeyRound,
  type LucideIcon,
  Network,
  RadioTower,
  Route,
  Smartphone,
  UserCog,
} from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CopyButton } from '@/components/admin/copy';
import { LiveRefresh } from '@/components/admin/live';
import { PageHeader, Panel, Pill } from '@/components/admin/ui';
import { type ToolId, type ToolStatus, toolStatus } from '@/lib/admin/tools';
import { getSession } from '@/lib/session';
import { canOpen } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.sections');
  return { title: t('tools') };
}

const ICONS: Record<ToolId, LucideIcon> = {
  grafana: BarChart3,
  errors: AlertOctagon,
  prometheus: Activity,
  status: RadioTower,
  keycloak: UserCog,
  openbao: KeyRound,
  traefik: Route,
  mailpit: Inbox,
  push: Smartphone,
  pangolin: Network,
};

const TONE = { up: 'good', down: 'bad', unknown: 'neutral', off: 'neutral' } as const;
const GROUPS = ['observe', 'identity', 'dev'] as const;

/**
 * Tools: every web UI of the platform in one place for operators, with how to sign in and whether
 * it answers right now. The UIs keep their own access control; this page only links to them.
 */
export default async function ToolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('tools', session.user.roles)) notFound();
  const t = await getTranslations('admin.tools');
  const list = await toolStatus(locale);

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} intro={t('intro')} actions={<LiveRefresh seconds={30} />} />
      {GROUPS.map((group) => {
        const items = list.filter((tool) => tool.group === group);
        if (!items.length) return null;
        return (
          <Panel key={group} title={t(`groups.${group}`)} testId={`tools-${group}`}>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((tool) => (
                <ToolCard key={tool.id} tool={tool} t={t} />
              ))}
            </ul>
          </Panel>
        );
      })}
      <p className="text-xs text-muted-foreground">{t('footnote')}</p>
    </div>
  );
}

function ToolCard({
  tool,
  t,
}: {
  tool: ToolStatus;
  t: Awaited<ReturnType<typeof getTranslations<'admin.tools'>>>;
}) {
  const Icon = ICONS[tool.id];
  const off = tool.status === 'off';
  return (
    <li
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      data-testid={`tool-${tool.id}`}
      data-status={tool.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent">
            <Icon aria-hidden className="size-4.5" />
          </span>
          <div>
            <p className="font-semibold">{t(`items.${tool.id}.name`)}</p>
            <p className="text-xs text-muted-foreground">{t(`items.${tool.id}.what`)}</p>
          </div>
        </div>
        <Pill tone={TONE[tool.status]} dot>
          {t(`status.${tool.status}`)}
        </Pill>
      </div>
      <p className="text-xs text-muted-foreground">
        {tool.signIn.kind === 'sso' && t('signIn.sso')}
        {tool.signIn.kind === 'none' && t('signIn.none')}
        {tool.signIn.kind === 'public' && t('signIn.public')}
        {tool.signIn.kind === 'secret' &&
          (tool.signIn.user
            ? t('signIn.secretUser', { user: tool.signIn.user })
            : t('signIn.secret'))}
      </p>
      {tool.signIn.kind === 'secret' && (
        <div className="-mt-1">
          <CopyButton
            value={`./raadi secret ${tool.signIn.secret}`}
            label={`./raadi secret ${tool.signIn.secret}`}
          />
        </div>
      )}
      <div className="mt-auto">
        {off ? (
          <p className="text-xs text-muted-foreground">{t('offHint')}</p>
        ) : (
          <a
            href={tool.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-xs font-semibold hover:bg-accent"
            data-testid={`tool-${tool.id}-open`}
          >
            {t('open')}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        )}
      </div>
    </li>
  );
}
