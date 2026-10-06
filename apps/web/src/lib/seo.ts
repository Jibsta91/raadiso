import type { Metadata } from 'next';

interface Locales {
  locales: readonly string[];
  defaultLocale: string;
}

/**
 * The same page in every language, for search engines (hreflang). `path` is the part after the
 * locale, e.g. "/listings/<id>"; pass i18n's `routing`. Country URLs (ADR-0032) will add a country here.
 */
export function localeAlternates(
  routing: Locales,
  locale: string,
  path: string,
): Metadata['alternates'] {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`])),
      'x-default': `/${routing.defaultLocale}${path}`,
    },
  };
}

/** A description for search results and link previews: whole words, at most `max` characters. */
export function summary(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[.,;:!?-]+$/, '')}…`;
}

/** JSON for a <script type="application/ld+json">, safe inside HTML ("</script>" cannot end it). */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
