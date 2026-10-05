'use client';

import { Button } from '@raadi/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  endOtherSessions,
  endSession,
  removeCredential,
  type SecurityResult,
} from '@/app/[locale]/account/security/actions';

/**
 * A button on the security page: sign out a session, all other sessions, or remove a sign-in
 * method. When the change needs a recent sign-in, it sends the person to sign in again and back.
 */
export function SecurityAction({
  kind,
  id,
  label,
  confirm,
  testId,
  variant = 'outline',
}: {
  kind: 'session' | 'others' | 'credential';
  id?: string;
  label: string;
  confirm?: string;
  testId?: string;
  variant?: 'outline' | 'secondary' | 'ghost';
}) {
  const t = useTranslations('security');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const act = () => {
    if (confirm && !window.confirm(confirm)) return;
    setFailed(false);
    start(async () => {
      const result: SecurityResult =
        kind === 'session'
          ? await endSession(id!)
          : kind === 'others'
            ? await endOtherSessions()
            : await removeCredential(id!);
      if (result.ok) return router.refresh();
      if (result.stepUp) {
        const back = `${window.location.pathname}?reauthenticated=1`;
        window.location.href = `/auth/login?reauth=1&returnTo=${encodeURIComponent(back)}&locale=${locale}`;
        return;
      }
      setFailed(true);
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant={variant} disabled={pending} onClick={act} data-testid={testId}>
        {label}
      </Button>
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {t('failed')}
        </span>
      ) : null}
    </span>
  );
}
