import { CATEGORY_KEYS } from '@raadi/catalog';
import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { searchListings } from '@/lib/api';
import { env } from '@/lib/env';

export const revalidate = 3600;

/** How many of the newest listings the sitemap lists (search pages hold at most 48 each). */
const LISTING_PAGES = 10;

/** Every public page in every language: the front page, categories, legal pages and active listings. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.publicBaseUrl;
  const page = (path: string, extra: Partial<MetadataRoute.Sitemap[number]> = {}) => ({
    url: `${base}/${routing.defaultLocale}${path}`,
    alternates: {
      languages: Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}${path}`])),
    },
    ...extra,
  });

  const listings: MetadataRoute.Sitemap = [];
  for (let n = 1; n <= LISTING_PAGES; n++) {
    const result = await searchListings({ sort: 'newest', page: n, pageSize: 48 }).catch(
      () => null,
    );
    if (!result) break;
    for (const hit of result.items) {
      listings.push(page(`/listings/${hit.id}`, { lastModified: hit.publishedAt }));
    }
    if (result.items.length < 48) break;
  }

  return [
    page('', { changeFrequency: 'hourly', priority: 1 }),
    ...CATEGORY_KEYS.map((c) => page(`/${c}`, { changeFrequency: 'hourly', priority: 0.8 })),
    page('/terms', { changeFrequency: 'yearly', priority: 0.1 }),
    page('/privacy', { changeFrequency: 'yearly', priority: 0.1 }),
    ...listings,
  ];
}
