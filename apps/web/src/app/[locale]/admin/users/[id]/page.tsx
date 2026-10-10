import { Select } from '@raadi/ui';
import {
  BadgeCheck,
  Ban,
  Fingerprint,
  KeyRound,
  Laptop,
  Lock,
  MessagesSquare,
  Package,
  Pin,
  Receipt,
  ShieldAlert,
  Smartphone,
  Star,
} from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  emailAction,
  otpResetAction,
  rolesAction,
  signOutAction,
  suspendAction,
  unlockAction,
  unsuspendAction,
} from '@/app/[locale]/admin/actions';
import { ActionDialog } from '@/components/admin/action-dialog';
import { CopyButton } from '@/components/admin/copy';
import { NoteForm } from '@/components/admin/note-form';
import { Ago } from '@/components/admin/time';
import { TrackRecent } from '@/components/admin/track-recent';
import {
  Avatar,
  Empty,
  Id,
  KeyValues,
  Panel,
  Pill,
  Stat,
  Table,
  Tabs,
  td,
  Unavailable,
} from '@/components/admin/ui';
import { Link } from '@/i18n/navigation';
import {
  adminAudit,
  AdminApiError,
  getUser,
  messagingUser,
  notificationsUser,
  searchAdminListings,
  searchOrders,
  searchReviews,
  sellerSnapshot,
  settle,
  staffNames,
  userNotes,
  userTrust,
} from '@/lib/admin/api';
import { nok } from '@/lib/admin/format';
import { SUSPENSION_REASONS } from '@/lib/admin/reasons';
import { getSession } from '@/lib/session';
import { can, canOpen, STAFF_ROLES } from '@/lib/staff';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await settle(getUser(id));
  return { title: user?.name ?? user?.email ?? 'User' };
}

const TABS = ['overview', 'listings', 'orders', 'reviews', 'security', 'notes', 'history'] as const;
type Tab = (typeof TABS)[number];

/**
 * One account across every service (ADR-0030): Keycloak (status, roles, sessions, sign-ins),
 * listings, orders, reviews, messaging counts, devices, support's notes and staff actions.
 */
export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ locale, id }, sp] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session.authenticated || !canOpen('users', session.user.roles)) notFound();
  const roles = session.user.roles;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'overview';
  const [t, tr] = await Promise.all([
    getTranslations('admin.user'),
    getTranslations('admin.roles'),
  ]);

  let user;
  try {
    user = await getUser(id);
  } catch (error) {
    if (error instanceof AdminApiError && (error.status === 404 || error.status === 400))
      notFound();
    return <Unavailable>{t('unavailable')}</Unavailable>;
  }

  const [seller, trust, messaging, delivery, notes, orders] = await Promise.all([
    settle(sellerSnapshot(id)),
    settle(userTrust(id)),
    settle(messagingUser(id)),
    settle(notificationsUser(id)),
    settle(userNotes(id)),
    canOpen('orders', roles) ? settle(searchOrders({ user: id, limit: 50 })) : null,
  ]);

  const isSelf = session.user.id === id;
  const isStaffTarget = user.staffRoles.length > 0;
  const admin = roles.includes('platform-admin');
  // The services enforce these too; the console only hides what would be refused.
  const mayAct = can('suspend', roles) && !isSelf && (!isStaffTarget || admin);
  const hasOtp = user.credentials.some((c) => c.type === 'otp');
  const spent = (orders?.items ?? [])
    .filter((o) => o.status === 'captured')
    .reduce((n, o) => n + o.amountOre, 0);
  const name = user.name ?? user.displayName ?? user.email ?? id;
  const tabHref = (k: Tab) => `/admin/users/${id}${k === 'overview' ? '' : `?tab=${k}`}`;
  const tabs = TABS.map((k) => ({
    key: k,
    href: tabHref(k),
    label: t(`tabs.${k}`),
    count:
      k === 'listings'
        ? seller
          ? seller.active + seller.sold + seller.deleted
          : undefined
        : k === 'orders'
          ? orders?.total
          : k === 'notes'
            ? notes?.items.length
            : k === 'security'
              ? user.sessions.length
              : undefined,
  }));

  return (
    <div className="space-y-6">
      <TrackRecent
        kind="user"
        id={id}
        title={name}
        subtitle={user.email ?? undefined}
        href={`/admin/users/${id}`}
      />
      <header className="flex flex-col gap-5 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar name={name} id={id} size="lg" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href="/admin/users" prefetch={false} className="hover:underline">
                {t('back')}
              </Link>
            </p>
            <h1 className="truncate text-xl font-bold sm:text-2xl" data-testid="admin-title">
              {name}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span data-testid="user-email">{user.email}</span>
              <CopyButton value={id} />
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1" data-testid="user-badges">
              {user.suspended ? (
                <Pill tone="bad" dot testId="user-status">
                  {t('status.suspended')}
                </Pill>
              ) : (
                <Pill tone="good" dot testId="user-status">
                  {t('status.active')}
                </Pill>
              )}
              {user.emailVerified ? (
                <Pill tone="neutral">{t('emailVerified')}</Pill>
              ) : (
                <Pill tone="warn">{t('emailUnverified')}</Pill>
              )}
              {trust?.verifiedAt ? (
                <Pill tone="info">
                  <BadgeCheck aria-hidden className="size-3" />
                  {t('bankid')}
                </Pill>
              ) : null}
              {hasOtp ? (
                <Pill tone="neutral">
                  <KeyRound aria-hidden className="size-3" />
                  {t('otp')}
                </Pill>
              ) : null}
              {user.lockout.locked ? (
                <Pill tone="bad">
                  <Lock aria-hidden className="size-3" />
                  {t('locked')}
                </Pill>
              ) : null}
              {user.staffRoles.map((r) => (
                <Pill key={r} tone="ink">
                  {tr(r)}
                </Pill>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="user-actions">
          {mayAct && !user.suspended ? (
            <ActionDialog
              action={suspendAction}
              label={t('actions.suspend')}
              icon="ban"
              tone="danger"
              title={t('suspend.title', { name })}
              description={t('suspend.description')}
              hidden={{ id }}
              stepUp
              reasons={{
                label: t('suspend.reason'),
                options: SUSPENSION_REASONS.map((r) => ({
                  value: r,
                  label: t(`suspensionReasons.${r}`),
                })),
              }}
              note={{ label: t('suspend.note'), placeholder: t('suspend.notePlaceholder') }}
              testId="user-suspend"
            >
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                {t('suspend.duration')}
                <Select name="hours" className="h-10 px-3 font-normal w-auto">
                  <option value="">{t('suspend.untilLifted')}</option>
                  <option value="24">{t('suspend.hours', { count: 24 })}</option>
                  <option value="72">{t('suspend.hours', { count: 72 })}</option>
                  <option value="168">{t('suspend.days', { count: 7 })}</option>
                  <option value="720">{t('suspend.days', { count: 30 })}</option>
                </Select>
              </label>
            </ActionDialog>
          ) : null}
          {mayAct && user.suspended ? (
            <ActionDialog
              action={unsuspendAction}
              label={t('actions.unsuspend')}
              icon="undo"
              tone="primary"
              title={t('unsuspend.title', { name })}
              description={t('unsuspend.description')}
              hidden={{ id }}
              stepUp
              note={{ label: t('unsuspend.note'), required: true }}
              testId="user-unsuspend"
            />
          ) : null}
          {mayAct ? (
            <ActionDialog
              action={signOutAction}
              label={t('actions.signOut')}
              icon="logout"
              title={t('signOut.title')}
              description={t('signOut.description', { count: user.sessions.length })}
              hidden={{ id }}
              note={{ label: t('signOut.note') }}
              testId="user-sign-out"
            />
          ) : null}
          {mayAct && user.email && !user.suspended ? (
            <ActionDialog
              action={emailAction}
              label={t('actions.passwordReset')}
              icon="mail"
              title={t('passwordReset.title')}
              description={t('passwordReset.description', { email: user.email })}
              hidden={{ id, action: 'password_reset' }}
              submitLabel={t('passwordReset.send')}
              testId="user-password-reset"
            />
          ) : null}
          {mayAct && user.email && !user.emailVerified && !user.suspended ? (
            <ActionDialog
              action={emailAction}
              label={t('actions.verifyEmail')}
              icon="mail"
              title={t('verifyEmail.title')}
              description={t('verifyEmail.description', { email: user.email })}
              hidden={{ id, action: 'verify_email' }}
              testId="user-verify-email"
            />
          ) : null}
          {mayAct && user.lockout.locked ? (
            <ActionDialog
              action={unlockAction}
              label={t('actions.unlock')}
              icon="key"
              title={t('unlock.title')}
              description={t('unlock.description', { count: user.lockout.failures })}
              hidden={{ id }}
              testId="user-unlock"
            />
          ) : null}
          {admin ? (
            <ActionDialog
              action={rolesAction}
              label={t('actions.roles')}
              icon="roles"
              title={t('roles.title', { name })}
              description={t('roles.description')}
              hidden={{ id }}
              stepUp
              note={{ label: t('roles.note'), required: true }}
              testId="user-roles"
            >
              <fieldset className="grid gap-2 sm:grid-cols-2">
                {STAFF_ROLES.map((r) => (
                  <label
                    key={r}
                    className="flex cursor-pointer items-start gap-2 rounded-card border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-soft"
                  >
                    <input
                      type="checkbox"
                      name="roles"
                      value={r}
                      defaultChecked={user.staffRoles.includes(r)}
                      disabled={isSelf && r === 'platform-admin'}
                      className="mt-0.5 size-4 accent-[var(--primary)]"
                      data-testid={`role-${r}`}
                    />
                    <span>
                      <span className="block font-semibold">{tr(r)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`roles.explain.${r}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {isSelf && user.staffRoles.includes('platform-admin') ? (
                <input type="hidden" name="roles" value="platform-admin" />
              ) : null}
            </ActionDialog>
          ) : null}
          {admin && hasOtp && !isSelf ? (
            <ActionDialog
              action={otpResetAction}
              label={t('actions.resetOtp')}
              icon="key"
              tone="ghost"
              title={t('resetOtp.title')}
              description={t('resetOtp.description')}
              hidden={{ id }}
              stepUp
              confirmText={user.email ?? id}
              note={{ label: t('resetOtp.note'), required: true }}
              testId="user-reset-otp"
            />
          ) : null}
        </div>
      </header>

      {user.suspension ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-card border border-destructive/30 bg-destructive/8 p-4 text-sm"
          data-testid="suspension-banner"
        >
          <p className="flex items-center gap-2 font-semibold text-destructive">
            <Ban aria-hidden className="size-4" />
            {t('suspendedBanner', {
              reason: t(`suspensionReasons.${user.suspension.reasonCode}`),
            })}
          </p>
          <p className="text-muted-foreground">
            <Ago at={user.suspension.at} />
            {user.suspension.until ? (
              <>
                {' · '}
                {t('until')} <Ago at={user.suspension.until} />
              </>
            ) : (
              ` · ${t('untilLifted')}`
            )}
            {user.suspension.note ? ` · “${user.suspension.note}”` : ''}
          </p>
        </div>
      ) : null}

      <Tabs tabs={tabs} current={tab} label={t('tabsLabel')} />

      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label={t('kpi.listings')}
              value={seller ? seller.active : '–'}
              hint={
                seller
                  ? t('kpi.listingsHint', {
                      sold: seller.sold,
                      removed: seller.removedByModeration,
                    })
                  : undefined
              }
              icon={Package}
              href={tabHref('listings')}
              tone={seller?.removedByModeration ? 'bad' : undefined}
            />
            <Stat
              label={t('kpi.rating')}
              value={trust?.rating.average ?? '–'}
              hint={trust ? t('kpi.ratingHint', { count: trust.rating.count }) : undefined}
              icon={Star}
              href={tabHref('reviews')}
            />
            <Stat
              label={t('kpi.messages')}
              value={messaging?.messagesSent30d ?? '–'}
              hint={
                messaging
                  ? t('kpi.messagesHint', {
                      conversations:
                        messaging.conversations.asBuyer + messaging.conversations.asSeller,
                      blocked: messaging.blocks.received,
                    })
                  : undefined
              }
              icon={MessagesSquare}
            />
            {orders ? (
              <Stat
                label={t('kpi.spent')}
                value={nok(spent, locale)}
                hint={t('kpi.ordersHint', { count: orders.total })}
                icon={Receipt}
                href={tabHref('orders')}
              />
            ) : null}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('profile')}>
              <KeyValues
                items={[
                  [t('fields.id'), <Id key="id" value={id} />],
                  [t('fields.displayName'), user.displayName ?? '–'],
                  [t('fields.locale'), user.locale ?? '–'],
                  [t('fields.created'), user.createdAt ? <Ago key="c" at={user.createdAt} /> : '–'],
                  [
                    t('fields.lastLogin'),
                    user.lastLoginAt ? <Ago key="l" at={user.lastLoginAt} /> : t('never'),
                  ],
                  [
                    t('fields.firstListing'),
                    seller?.firstListingAt ? <Ago key="f" at={seller.firstListingAt} /> : '–',
                  ],
                  [t('fields.reportsAgainst'), seller?.reports ?? '–'],
                  [
                    t('fields.devices'),
                    delivery
                      ? delivery.devices.map((d) => d.platform).join(', ') || t('none')
                      : '–',
                  ],
                  [
                    t('fields.emailMessages'),
                    delivery ? (delivery.emailMessages ? t('on') : t('off')) : '–',
                  ],
                  user.requiredActions.length
                    ? [t('fields.requiredActions'), user.requiredActions.join(', ')]
                    : null,
                ]}
              />
            </Panel>
            <Panel
              title={t('tabs.notes')}
              icon={Pin}
              actions={
                <Link
                  href={tabHref('notes')}
                  prefetch={false}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  {t('notes.all')}
                </Link>
              }
            >
              {notes?.items.length ? (
                <ul className="space-y-3">
                  {notes.items.slice(0, 3).map((n) => (
                    <li key={n.id} className="space-y-0.5 text-sm">
                      <p className="whitespace-pre-wrap">
                        {n.pinned ? (
                          <Pin aria-hidden className="me-1 inline size-3 text-primary" />
                        ) : null}
                        {n.body}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <Ago at={n.createdAt} />
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <NoteForm userId={id} />
              )}
            </Panel>
          </div>
          <Panel title={t('recentSignIns')} icon={Fingerprint}>
            <SignIns events={user.events.slice(0, 6)} empty={t('noEvents')} />
          </Panel>
        </div>
      ) : null}

      {tab === 'listings' ? <UserListings id={id} /> : null}
      {tab === 'orders' ? <UserOrders orders={orders?.items ?? null} locale={locale} /> : null}
      {tab === 'reviews' ? <UserReviews id={id} /> : null}

      {tab === 'security' ? (
        <div className="space-y-4">
          <Panel title={t('sessions')} icon={Laptop} testId="user-sessions">
            {user.sessions.length === 0 ? (
              <Empty>{t('noSessions')}</Empty>
            ) : (
              <Table
                head={[
                  t('columns.ip'),
                  t('columns.clients'),
                  t('columns.started'),
                  t('columns.lastAccess'),
                ]}
              >
                {user.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className={`${td} font-mono text-xs`}>{s.ip ?? '–'}</td>
                    <td className={td}>
                      <span className="flex flex-wrap gap-1">
                        {s.clients.map((c) => (
                          <Pill key={c} tone="neutral">
                            {c === 'raadi-mobile' ? (
                              <Smartphone aria-hidden className="size-3" />
                            ) : (
                              <Laptop aria-hidden className="size-3" />
                            )}
                            {c}
                          </Pill>
                        ))}
                      </span>
                    </td>
                    <td className={`${td} text-muted-foreground`}>
                      <Ago at={s.startedAt} />
                    </td>
                    <td className={`${td} text-muted-foreground`}>
                      <Ago at={s.lastAccessAt} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('credentials')} icon={KeyRound}>
              <ul className="space-y-2 text-sm">
                {user.credentials.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {t.has(`credentialTypes.${c.type}`)
                        ? t(`credentialTypes.${c.type}` as never)
                        : c.type}
                    </span>
                    <span className="text-muted-foreground">
                      {c.label ? `${c.label} · ` : ''}
                      {c.createdAt ? <Ago at={c.createdAt} /> : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={t('lockout')} icon={ShieldAlert}>
              <KeyValues
                items={[
                  [t('fields.locked'), user.lockout.locked ? t('yes') : t('no')],
                  [t('fields.failures'), user.lockout.failures],
                  [
                    t('fields.lastFailure'),
                    user.lockout.lastFailureAt ? (
                      <Ago key="f" at={user.lockout.lastFailureAt} />
                    ) : (
                      '–'
                    ),
                  ],
                ]}
              />
            </Panel>
          </div>
          <Panel title={t('signIns')} icon={Fingerprint} testId="user-events">
            <SignIns events={user.events} empty={t('noEvents')} />
          </Panel>
        </div>
      ) : null}

      {tab === 'notes' ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Panel title={t('tabs.notes')} icon={Pin} testId="user-notes">
            {!notes ? (
              <Unavailable>{t('unavailable')}</Unavailable>
            ) : notes.items.length === 0 ? (
              <Empty>{t('notes.empty')}</Empty>
            ) : (
              <NoteList notes={notes.items} />
            )}
          </Panel>
          <Panel title={t('notes.add')}>
            <NoteForm userId={id} />
          </Panel>
        </div>
      ) : null}

      {tab === 'history' ? <UserHistory id={id} /> : null}
    </div>
  );
}

// -- tab bodies ------------------------------------------------------------------------------

async function SignIns({
  events,
  empty,
}: {
  events: Array<{
    type: string;
    at: string;
    ip: string | null;
    client: string | null;
    error: string | null;
  }>;
  empty: string;
}) {
  if (!events.length) return <Empty>{empty}</Empty>;
  return (
    <ol className="space-y-2 text-sm">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-2">
          <Pill tone={e.error ? 'bad' : e.type.includes('LOGIN') ? 'good' : 'neutral'}>
            {e.type}
          </Pill>
          {e.client ? <span className="text-muted-foreground">{e.client}</span> : null}
          {e.ip ? <span className="font-mono text-xs text-muted-foreground">{e.ip}</span> : null}
          {e.error ? <span className="text-destructive">{e.error}</span> : null}
          <span className="ms-auto text-xs text-muted-foreground">
            <Ago at={e.at} />
          </span>
        </li>
      ))}
    </ol>
  );
}

async function NoteList({
  notes,
}: {
  notes: Array<{ id: string; authorId: string; body: string; pinned: boolean; createdAt: string }>;
}) {
  const names = await staffNames(notes.map((n) => n.authorId));
  return (
    <ul className="space-y-4">
      {notes.map((n) => {
        const author = names.get(n.authorId);
        return (
          <li key={n.id} className="flex gap-3" data-testid="user-note">
            <Avatar name={author?.name ?? author?.email ?? '?'} id={n.authorId} size="sm" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {author?.name ?? author?.email ?? n.authorId.slice(0, 8)}
                </span>{' '}
                · <Ago at={n.createdAt} />
                {n.pinned ? <Pin aria-hidden className="ms-1 inline size-3 text-primary" /> : null}
              </p>
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

async function UserListings({ id }: { id: string }) {
  const [t, page] = await Promise.all([
    getTranslations('admin.listings'),
    settle(searchAdminListings({ owner: id, limit: 50 })),
  ]);
  if (!page) return <Unavailable>{t('unavailable')}</Unavailable>;
  if (!page.items.length) return <Empty icon={Package}>{t('empty')}</Empty>;
  return (
    <Table
      head={[t('columns.listing'), t('columns.status'), t('columns.reports'), t('columns.created')]}
    >
      {page.items.map((l) => (
        <tr key={l.id} className="hover:bg-accent/50">
          <td className={td}>
            <Link
              href={`/admin/listings/${l.id}`}
              prefetch={false}
              className="flex items-center gap-3"
            >
              {l.image ? (
                <img src={l.image.thumb} alt="" className="size-10 rounded-card object-cover" />
              ) : (
                <span className="size-10 rounded-card bg-placeholder" />
              )}
              <span className="font-medium hover:underline">{l.title}</span>
            </Link>
          </td>
          <td className={td}>
            <Pill
              tone={l.status === 'active' ? 'good' : l.status === 'deleted' ? 'bad' : 'neutral'}
            >
              {t(`status.${l.status}`)}
            </Pill>
          </td>
          <td className={td}>{l.openReports ? <Pill tone="bad">{l.openReports}</Pill> : '–'}</td>
          <td className={`${td} text-muted-foreground`}>
            <Ago at={l.createdAt} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

async function UserOrders({
  orders,
  locale,
}: {
  orders: Array<{
    id: string;
    product: string;
    amountOre: number;
    status: string;
    createdAt: string;
  }> | null;
  locale: string;
}) {
  const t = await getTranslations('admin.orders');
  if (!orders) return <Unavailable>{t('unavailable')}</Unavailable>;
  if (!orders.length) return <Empty icon={Receipt}>{t('empty')}</Empty>;
  return (
    <Table
      head={[
        t('columns.order'),
        t('columns.product'),
        t('columns.amount'),
        t('columns.status'),
        t('columns.created'),
      ]}
    >
      {orders.map((o) => (
        <tr key={o.id} className="hover:bg-accent/50">
          <td className={td}>
            <Id value={o.id} href={`/admin/orders/${o.id}`} />
          </td>
          <td className={td}>{t(`products.${o.product}` as never)}</td>
          <td className={`${td} tabular-nums`}>{nok(o.amountOre, locale)}</td>
          <td className={td}>
            <Pill
              tone={o.status === 'captured' ? 'good' : o.status === 'refunded' ? 'info' : 'neutral'}
            >
              {t(`status.${o.status}` as never)}
            </Pill>
          </td>
          <td className={`${td} text-muted-foreground`}>
            <Ago at={o.createdAt} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

async function UserReviews({ id }: { id: string }) {
  const [t, page] = await Promise.all([
    getTranslations('admin.reviews'),
    settle(searchReviews({ user: id, limit: 50 })),
  ]);
  if (!page) return <Unavailable>{t('unavailable')}</Unavailable>;
  if (!page.items.length) return <Empty icon={Star}>{t('empty')}</Empty>;
  return (
    <ul className="space-y-2">
      {page.items.map((r) => (
        <li key={r.id} className="rounded-card border bg-card p-4 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tabular-nums">
              {'★'.repeat(r.rating)}
              {'☆'.repeat(5 - r.rating)}
            </span>
            <Pill tone="neutral">{r.subjectId === id ? t('about') : t('by')}</Pill>
            <span className="text-muted-foreground">{r.listingTitle}</span>
            {r.removedAt ? <Pill tone="bad">{t('removed')}</Pill> : null}
            <span className="ms-auto text-xs text-muted-foreground">
              <Ago at={r.createdAt} />
            </span>
          </p>
          {r.comment ? <p className="mt-2 whitespace-pre-wrap">{r.comment}</p> : null}
        </li>
      ))}
    </ul>
  );
}

async function UserHistory({ id }: { id: string }) {
  const [t, ta] = await Promise.all([
    getTranslations('admin.user'),
    getTranslations('admin.audit'),
  ]);
  const page = await settle(adminAudit({ targetId: id, limit: 50 }));
  if (!page) return <Unavailable>{t('unavailable')}</Unavailable>;
  if (!page.items.length) return <Empty>{t('noHistory')}</Empty>;
  const names = await staffNames(page.items.map((e) => e.actor.id));
  return (
    <ol className="relative space-y-4 border-s ps-5" data-testid="user-history">
      {page.items.map((e) => {
        const actor = names.get(e.actor.id);
        return (
          <li key={e.id} className="relative text-sm">
            <span className="absolute -start-[26px] top-1 size-3 rounded-full border-2 border-background bg-primary" />
            <p className="font-semibold">
              {ta(`actionNames.${e.action.replace(/\./g, '_')}` as never)}
            </p>
            <p className="text-xs text-muted-foreground">
              {actor?.name ?? actor?.email ?? e.actor.id.slice(0, 8)} · <Ago at={e.at} />
            </p>
            {e.reason ? <p className="mt-1 text-subtle-foreground">“{e.reason}”</p> : null}
            {e.details ? (
              <p className="mt-1 flex flex-wrap gap-1">
                {Object.entries(e.details).map(([k, v]) => (
                  <Pill key={k} tone="neutral">
                    {k}: {Array.isArray(v) ? v.join(', ') || '–' : String(v)}
                  </Pill>
                ))}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
