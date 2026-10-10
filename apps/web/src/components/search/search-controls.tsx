'use client';

import { Alert, Select } from '@raadi/ui';
import type { CountryCode } from '@raadi/catalog/countries';
import { placeName, placesOf } from '@raadi/catalog/places';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { href, type Params, withParams } from '@/lib/search-params';

const RADII = ['10', '25', '50', '100', '250'];

/** The parameters this form sets; every other one is carried along in hidden fields. */
const OWN = new Set(['near', 'lat', 'lon', 'radiusKm', 'sort', 'page']);

/**
 * Location (place or the browser's position), radius and sort. A plain GET form, so it works before the
 * page's JavaScript has loaded (or when it never does); once it has, a choice applies at once, and the
 * fields say so beforehand (WCAG 3.2.2).
 */
export function SearchControls({
  params,
  country,
  sorts,
}: {
  params: Params;
  country: CountryCode;
  /** The sorts on offer: the base ones, and a single category's own (ADR-0042). */
  sorts: readonly string[];
}) {
  const t = useTranslations('search');
  const locale = useLocale();
  const router = useRouter();
  const places = [...placesOf(country)].sort((a, b) =>
    placeName(a, locale as never).localeCompare(placeName(b, locale as never), locale),
  );
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [positionFailed, setPositionFailed] = useState(false);
  useEffect(() => setHydrated(true), []);
  const go = (changes: Record<string, string | undefined>) =>
    startTransition(() => router.push(href(withParams(params, changes)), { scroll: false }));
  const hasCentre = Boolean(params.near || params.lat);

  const nearMe = () => {
    setPositionFailed(false);
    if (!navigator.geolocation) return setPositionFailed(true);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        go({
          near: undefined,
          lat: pos.coords.latitude.toFixed(3),
          lon: pos.coords.longitude.toFixed(3),
          radiusKm: params.radiusKm ?? '50',
          sort: 'distance',
        }),
      () => setPositionFailed(true),
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };

  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        // With JavaScript the choices have already been applied.
        if (hydrated) e.preventDefault();
      }}
    >
      {Object.entries(params)
        .filter(([key, value]) => !OWN.has(key) && value)
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      <p id="search-controls-hint" className="sr-only">
        {t('controlsHint')}
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('near')}</span>
        <Select
          name="near"
          aria-describedby="search-controls-hint"
          data-testid="filter-near"
          className="h-10 px-3 w-auto"
          value={params.near ?? (params.lat ? '__me' : '')}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__me') return nearMe();
            go({
              near: v || undefined,
              lat: undefined,
              lon: undefined,
              radiusKm: v ? (params.radiusKm ?? '50') : undefined,
              sort: !v && params.sort === 'distance' ? undefined : params.sort,
            });
          }}
        >
          <option value="">{t('anywhere')}</option>
          {hydrated ? <option value="__me">📍 {t('nearMe')}</option> : null}
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {placeName(p, locale as never)}
            </option>
          ))}
        </Select>
      </label>
      {hasCentre ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('radius')}</span>
          <Select
            name="radiusKm"
            aria-describedby="search-controls-hint"
            data-testid="filter-radius"
            className="h-10 px-3 w-auto"
            value={params.radiusKm ?? '50'}
            onChange={(e) => go({ radiusKm: e.target.value })}
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                {t('radiusKm', { km: r })}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <label className="ms-auto flex flex-col gap-1 text-sm">
        <span className="font-medium">{t('sortLabel')}</span>
        <Select
          name="sort"
          aria-describedby="search-controls-hint"
          data-testid="sort"
          className="h-10 px-3 w-auto"
          value={params.sort ?? 'relevance'}
          onChange={(e) =>
            go({ sort: e.target.value === 'relevance' ? undefined : e.target.value })
          }
        >
          {sorts
            .filter((s) => s !== 'distance' || hasCentre)
            .map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}` as never)}
              </option>
            ))}
        </Select>
      </label>
      {hydrated ? null : (
        <button type="submit" className="h-10 rounded-full border px-4 text-sm font-medium">
          {t('apply')}
        </button>
      )}
      {positionFailed ? (
        <Alert variant="danger" className="w-full p-3" data-testid="near-me-failed">
          {t('nearMeFailed')}
        </Alert>
      ) : null}
    </form>
  );
}
