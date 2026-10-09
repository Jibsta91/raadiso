// Pure helpers shared by the screens; unit-tested in test/format.test.ts.
import { formatMoney, type Money } from '@raadi/catalog/money';

export type Locale = 'nb' | 'en' | 'so';

export const intlLocale: Record<Locale, string> = { nb: 'nb-NO', en: 'en-GB', so: 'so-SO' };

/**
 * "12 500 kr", "$1,250": the listing's currency in the reader's format (ADR-0040), or the
 * `onRequest` label supplied by the caller when there is no price.
 */
export function formatPrice(price: Money | null, locale: Locale, onRequest: string): string {
  return price === null ? onRequest : formatMoney(price, locale);
}

type Unit = 'second' | 'minute' | 'hour' | 'day';

// Hermes (React Native's engine on iOS and Android) has no Intl.RelativeTimeFormat: past times in
// short form, the only way the app uses it.
const AGO: Record<
  Locale,
  { now: string; ago: (n: number, unit: Exclude<Unit, 'second'>) => string }
> = {
  nb: { now: 'nå', ago: (n, u) => `for ${n} ${{ minute: 'min.', hour: 't', day: 'd' }[u]} siden` },
  en: {
    now: 'now',
    ago: (n, u) => `${n} ${{ minute: 'min', hour: 'hr', day: n === 1 ? 'day' : 'days' }[u]} ago`,
  },
  so: {
    now: 'hadda',
    ago: (n, u) => `${n} ${{ minute: 'daqiiqo', hour: 'saacadood', day: 'maalmood' }[u]} ka hor`,
  },
};

function relative(locale: Locale): (value: number, unit: Unit) => string {
  const Rtf = (Intl as { RelativeTimeFormat?: typeof Intl.RelativeTimeFormat }).RelativeTimeFormat;
  if (Rtf) {
    const rtf = new Rtf(intlLocale[locale], { numeric: 'auto', style: 'short' });
    return (value, unit) => rtf.format(value, unit);
  }
  const words = AGO[locale];
  return (value, unit) =>
    unit === 'second' || value === 0 ? words.now : words.ago(Math.abs(value), unit);
}

/** How much a price drop took off, in whole percent, when it is worth saying (5% or more). */
export function dropPercent(listing: {
  price: Money | null;
  priceDrop?: { previous: Money };
}): number | undefined {
  const before = listing.priceDrop?.previous.amountMinor;
  const now = listing.price?.amountMinor;
  if (!before || now === undefined || now >= before) return undefined;
  const pct = Math.round(((before - now) / before) * 100);
  return pct >= 5 ? pct : undefined;
}

/** Short relative time ("5 min", "3 t", "2 d") or a date for anything older than a week. */
export function formatAge(iso: string, locale: Locale, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const rtf = { format: relative(locale) };
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return new Intl.DateTimeFormat(intlLocale[locale], { dateStyle: 'medium' }).format(then);
}

/** Pick the app language from the device's preferred locales; Norwegian variants map to nb. */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lang = tag.toLowerCase().split(/[-_]/)[0];
    if (lang === 'nb' || lang === 'no' || lang === 'nn') return 'nb';
    if (lang === 'en') return 'en';
    if (lang === 'so') return 'so';
  }
  return 'nb';
}
