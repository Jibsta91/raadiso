'use client';

import { formatMoney } from '@raadi/catalog/money';
import { History, ImageOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';

/** What a recently viewed listing looked like when it was seen (ADR-0047); this browser only. */
export interface Seen {
  id: string;
  title: string;
  price: { amountMinor: number; currency: string } | null;
  image?: string;
  place: string;
}

const KEY = 'raadi.recentlyViewed';
const MAX = 12;

function read(): Seen[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? (list as Seen[]).filter((x) => x && typeof x.id === 'string') : [];
  } catch {
    return [];
  }
}

/** Remembers a listing page as seen, newest first. */
export function RecordSeen({ listing }: { listing: Seen }) {
  const key = JSON.stringify(listing);
  useEffect(() => {
    try {
      const next = [listing, ...read().filter((x) => x.id !== listing.id)].slice(0, MAX);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Blocked storage: nothing is remembered.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/**
 * The listings this browser looked at lately, on the front page. Rendered after hydration only (the
 * server knows nothing of them), and gone with one click.
 */
export function RecentlyViewed() {
  const t = useTranslations('home');
  const locale = useLocale();
  const [items, setItems] = useState<Seen[]>([]);
  useEffect(() => setItems(read().slice(0, 8)), []);
  if (!items.length) return null;
  return (
    <section aria-labelledby="recently-viewed" className="space-y-5" data-testid="recently-viewed">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="recently-viewed" className="flex items-center gap-2 text-2xl font-bold">
          <History aria-hidden className="size-7" />
          {t('recentTitle')}
        </h2>
        <button
          type="button"
          className="rounded font-semibold text-primary hover:underline"
          onClick={() => {
            try {
              localStorage.removeItem(KEY);
            } catch {
              // Nothing to clear.
            }
            setItems([]);
          }}
        >
          {t('recentClear')}
        </button>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-8" role="list">
        {items.map((x) => (
          <li key={x.id}>
            <Link
              href={`/listings/${x.id}`}
              className="group block space-y-2"
              data-testid="recent-card"
            >
              <div className="relative aspect-square overflow-hidden rounded-card bg-placeholder">
                {x.image ? (
                  <img src={x.image} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <ImageOff
                    aria-hidden
                    className="absolute inset-0 m-auto size-6 text-muted-foreground"
                  />
                )}
              </div>
              <p className="line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">
                {x.title}
              </p>
              {x.price ? (
                <p className="price text-sm text-muted-foreground">
                  {formatMoney(x.price, locale)}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
