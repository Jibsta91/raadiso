'use client';

import type { NotificationPreferences } from '@raadi/api-client';
import { Button } from '@raadi/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';

/** "Mark all read" for the notification list. */
export function MarkAllRead() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      data-testid="notifications-read-all"
      onClick={() =>
        start(async () => {
          const res = await fetch('/api/v1/notifications/read-all', { method: 'POST' });
          if (res.ok) router.refresh();
        })
      }
    >
      {t('markAllRead')}
    </Button>
  );
}

/** Marks a notification read, then follows its link (`link` has no locale prefix). */
export function NotificationLink({
  id,
  link,
  href,
  children,
}: {
  id: string;
  link: string;
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <a
      href={href}
      className="block p-3 hover:bg-accent"
      data-testid="notification-item"
      onClick={(e) => {
        e.preventDefault();
        void fetch(`/api/v1/notifications/${id}/read`, { method: 'POST' }).finally(() =>
          router.push(link),
        );
      }}
    >
      {children}
    </a>
  );
}

type Channel = 'emailMessages' | 'pushMessages';

/** E-mail and push preferences for new messages; each toggle is saved immediately. */
export function EmailPreferences({ initial }: { initial: NotificationPreferences }) {
  const t = useTranslations('notifications.settings');
  const [prefs, setPrefs] = useState({ ...initial, pushMessages: initial.pushMessages ?? true });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function toggle(channel: Channel, value: boolean) {
    const previous = prefs;
    const next = { ...prefs, [channel]: value };
    setPrefs(next);
    setState('saving');
    const res = await fetch('/api/v1/notifications/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => null);
    if (res?.ok) return setState('saved');
    setPrefs(previous);
    setState('error');
  }

  const option = (channel: Channel, testId: string) => (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 size-4"
        checked={prefs[channel]}
        disabled={state === 'saving'}
        onChange={(e) => void toggle(channel, e.target.checked)}
        data-testid={testId}
      />
      <span>
        <span className="block text-sm font-medium">{t(channel)}</span>
        <span className="block text-xs text-muted-foreground">{t(`${channel}Hint`)}</span>
      </span>
    </label>
  );

  return (
    <section aria-labelledby="email-settings" className="space-y-3 rounded-card border p-4">
      <h2 id="email-settings" className="font-semibold">
        {t('title')}
      </h2>
      {option('emailMessages', 'pref-email-messages')}
      {option('pushMessages', 'pref-push-messages')}
      <p role="status" className="text-xs text-muted-foreground" data-testid="pref-status">
        {state === 'saved' ? t('saved') : state === 'error' ? t('error') : ''}
      </p>
    </section>
  );
}
