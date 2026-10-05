/** Number formatting for the console, in the page's language (Intl only, no libraries). */

export function nok(ore: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'nb' ? 'nb-NO' : locale, {
    style: 'currency',
    currency: 'NOK',
    maximumFractionDigits: 0,
  }).format(ore / 100);
}

export function count(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'nb' ? 'nb-NO' : locale, {
    notation: n >= 100_000 ? 'compact' : 'standard',
  }).format(n);
}

/** "2 h 5 min", "40 s", "3 d" — the two largest units. */
export function duration(seconds: number, locale: string): string {
  const units: Array<[Intl.NumberFormatOptions['unit'], number]> = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  let rest = Math.max(0, Math.round(seconds));
  const parts: string[] = [];
  for (const [unit, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0 || (unit === 'second' && parts.length === 0)) {
      parts.push(
        new Intl.NumberFormat(locale === 'nb' ? 'nb-NO' : locale, {
          style: 'unit',
          unit,
          unitDisplay: 'narrow',
        }).format(n),
      );
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

export function bytes(n: number, locale: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return new Intl.NumberFormat(locale === 'nb' ? 'nb-NO' : locale, {
    style: 'unit',
    unit: units[i],
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(v);
}

export function percent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'nb' ? 'nb-NO' : locale, {
    style: 'percent',
    maximumFractionDigits: ratio < 0.01 ? 2 : 1,
  }).format(ratio);
}
