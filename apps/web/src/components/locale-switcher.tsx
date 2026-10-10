'use client';

import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';

const NAMES: Record<string, string> = { nb: 'Norsk', en: 'English', so: 'Soomaali' };

/**
 * Language picker, among the languages the site's country offers (ADR-0053). For signed-in users the
 * choice is also saved to their profile, so e-mails and pushes come in the same language.
 */
export function LocaleSwitcher({
  label,
  signedIn,
  locales,
}: {
  label: string;
  signedIn: boolean;
  locales: readonly string[];
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{label}</span>
      <select
        data-testid="locale-switcher"
        className="h-11 rounded-full border border-input bg-card px-4 text-foreground focus-ring"
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          if (signedIn) {
            void fetch('/api/v1/identity/me', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ locale: next }),
            }).catch(() => undefined);
          }
          startTransition(() => router.replace(pathname, { locale: next }));
        }}
      >
        {locales.map((l) => (
          <option key={l} value={l} lang={l}>
            {NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
