'use client';

import type { Autocomplete, Listing, Media, PriceGuide } from '@raadi/api-client';
import {
  attributePayload as toAttributes,
  attributesOf,
  priceRuleOf,
  priceUnitOf,
} from '@raadi/catalog/attributes';
import { categoriesOf, subcategoriesOf, type Category } from '@raadi/catalog/categories';
import { COUNTRIES, type CountryCode } from '@raadi/catalog/countries';
import { currencySymbol, formatMoney, parseMajor, toMajor } from '@raadi/catalog/money';
import { qualityOf } from '@raadi/catalog/quality';
import { placeName, placesOf } from '@raadi/catalog/places';
import { Button } from '@raadi/ui';
import { Check, ChevronLeft, ChevronRight, ImagePlus, Loader2, Star, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { CATEGORY_ICONS, SUBCATEGORY_ICONS } from '@/lib/taxonomy-icons';

/** Fields with their own error text (form.errors.fields); the rest get a general one. */
const FIELD_MESSAGES = [
  'category',
  'subcategory',
  'title',
  'description',
  'price',
  'placeId',
  'attributes',
];

const POLICY_CODES = [
  'quota_exceeded',
  'price_above_ceiling',
  'prohibited_item',
  'too_many_images',
  'policy_undefined',
];
const IMAGE_CODES = ['malware', 'unsupported_type', 'invalid_image', 'too_large'];

interface UploadedImage {
  id: string;
  thumb: string;
}

interface Problem {
  status?: number;
  errors?: Array<{ path?: string; message?: string; code?: string }>;
}

/** The create/edit form. A new listing starts with FINN-style category and subcategory tiles. */
export function ListingForm({
  country,
  listing,
  initialCategory,
}: {
  /** The marketplace the listing is in (ADR-0040): its categories, places and currency. */
  country: CountryCode;
  listing?: Listing;
  /** Preselected from `?category=` (the "new listing" button on a category page). */
  initialCategory?: Category;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { currency } = COUNTRIES[country];
  const places = [...placesOf(country)].sort((a, b) =>
    placeName(a, locale as never).localeCompare(placeName(b, locale as never), locale),
  );
  const id = useId();
  const [category, setCategory] = useState<Category | ''>(
    listing?.category ?? initialCategory ?? '',
  );
  const [subcategory, setSubcategory] = useState(listing?.subcategory ?? '');
  const [attributes, setAttributes] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(listing?.attributes ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [images, setImages] = useState<UploadedImage[]>(
    listing?.images.map((i) => ({ id: i.id, thumb: i.urls.thumb })) ?? [],
  );
  const [uploading, setUploading] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Text fields stay uncontrolled; these follow them for the meter and the draft (ADR-0045).
  const [seed, setSeed] = useState<Partial<Draft> | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [descriptionLength, setDescriptionLength] = useState(listing?.description.length ?? 0);
  const [draft, setDraft] = useState<Draft | null>(null);

  // "What are you selling?" (ADR-0046): the words suggest categories, from search's lexicon.
  const [what, setWhat] = useState('');
  const [guess, setGuess] = useState<Autocomplete['categories']>([]);
  useEffect(() => {
    const q = what.trim();
    if (q.length < 2 || category) {
      setGuess([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/v1/search/autocomplete?${new URLSearchParams({ q: q.slice(0, 60), country })}`, {
        signal: ctrl.signal,
      })
        .then((res) => (res.ok ? (res.json() as Promise<Autocomplete>) : null))
        .then((body) => setGuess((body?.categories ?? []).filter((c) => c.subcategory)))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [what, country, category]);

  // A new listing's form offers to continue the last unfinished one (this browser only).
  useEffect(() => {
    if (!listing) setDraft(readDraft());
  }, [listing]);

  /** Saves what is filled in, debounced, for a new listing only. */
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveDraft = () => {
    if (listing || !category) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const form = formRef.current ? new FormData(formRef.current) : undefined;
      writeDraft({
        category,
        subcategory,
        attributes,
        images,
        title: String(form?.get('title') ?? ''),
        description: String(form?.get('description') ?? ''),
        price: String(form?.get('price') ?? ''),
        placeId: String(form?.get('placeId') ?? ''),
        savedAt: new Date().toISOString(),
      });
    }, 500);
  };

  const priceRule = category ? priceRuleOf(category, subcategory || undefined) : 'required';
  const priceUnit = category ? priceUnitOf(category, subcategory || undefined) : undefined;
  const fields = category && subcategory ? attributesOf(category, subcategory) : [];

  // Category, details and photos change outside the form's input events: save on those too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(saveDraft, [category, subcategory, JSON.stringify(attributes), images]);
  const quality =
    category && subcategory
      ? qualityOf({
          category,
          subcategory,
          description: 'x'.repeat(descriptionLength),
          imageCount: images.length,
          attributes,
        })
      : null;

  // What comparable listings cost, while the seller fills in the details (ADR-0043).
  const [placeId, setPlaceId] = useState(listing?.location.placeId ?? '');
  const [guide, setGuide] = useState<PriceGuide | null>(null);
  const details = JSON.stringify(attributes);
  useEffect(() => {
    if (!category || !subcategory || priceRule === 'none') {
      setGuide(null);
      return;
    }
    const params = new URLSearchParams({ country, category, subcategory });
    if (placeId) params.set('placeId', placeId);
    for (const [k, v] of Object.entries(JSON.parse(details) as Record<string, string>))
      if (v.trim() && fields.some((f) => f.key === k)) params.set(k, v.trim());
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/v1/search/price-guide?${params}`, { signal: ctrl.signal })
        .then((res) => (res.ok ? (res.json() as Promise<{ guide: PriceGuide | null }>) : null))
        .then((body) => setGuide(body?.guide ?? null))
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // `fields` follows category and subcategory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, category, subcategory, placeId, details, priceRule]);
  const perUnit = (amountMinor: number) =>
    formatMoney({ amountMinor: Math.round(amountMinor), currency }, locale) +
    (guide && guide.unit !== 'listing' ? ` ${t(`price.per.${guide.unit}`)}` : '');

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setImageError(null);
    for (const file of Array.from(files).slice(0, 10 - images.length)) {
      setUploading((n) => n + 1);
      try {
        const body = new FormData();
        body.append('file', file);
        const res = await fetch('/api/v1/media', { method: 'POST', body });
        if (res.ok) {
          const media = (await res.json()) as Media;
          setImages((prev) => [...prev, { id: media.id, thumb: media.urls.thumb }]);
        } else {
          const problem = (await res.json().catch(() => ({}))) as Problem;
          const code = res.status === 413 ? 'too_large' : problem.errors?.[0]?.code;
          setImageError(
            t(
              `form.errors.image.${code && IMAGE_CODES.includes(code) ? code : 'generic'}` as never,
            ),
          );
        }
      } catch {
        setImageError(t('form.errors.image.generic'));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function attributePayload(): Record<string, string | number> {
    return category && subcategory ? toAttributes(category, subcategory, attributes) : {};
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const typed = String(form.get('price') ?? '').trim();
    const amountMinor = typed === '' ? undefined : parseMajor(typed, currency);
    if (typed !== '' && amountMinor === undefined) {
      setErrors({ price: fieldMessage('price') });
      setFormError(t('form.errors.validation'));
      return;
    }
    const payload = {
      category,
      subcategory,
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? ''),
      price: priceRule === 'none' || amountMinor === undefined ? null : { amountMinor, currency },
      attributes: attributePayload(),
      placeId: String(form.get('placeId') ?? ''),
      imageIds: images.map((i) => i.id),
    };
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await fetch(listing ? `/api/v1/listings/${listing.id}` : '/api/v1/listings', {
        method: listing ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(listing ? { 'if-match': `"${listing.version}"` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const saved = (await res.json()) as Listing;
        if (!listing) clearDraft();
        router.push(`/listings/${saved.id}`);
        router.refresh();
        return;
      }
      const problem = (await res.json().catch(() => ({}))) as Problem;
      if (res.status === 401) return setFormError(t('form.loginRequired'));
      if (res.status === 412) return setFormError(t('form.errors.conflict'));
      if (res.status === 503) return setFormError(t('form.errors.unavailable'));
      const policy = problem.errors?.find((x) => x.code && POLICY_CODES.includes(x.code));
      if (policy) return setFormError(t(`form.errors.policy.${policy.code}` as never));
      const fieldErrors: Record<string, string> = {};
      for (const err of problem.errors ?? []) {
        // The server's messages are English and technical; each field has its own text.
        if (err.path) {
          const path = err.path.startsWith('price.') ? 'price' : err.path;
          fieldErrors[path] = fieldMessage(path);
        }
      }
      setErrors(fieldErrors);
      setFormError(t('form.errors.validation'));
    } catch {
      setFormError(t('form.errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  function fieldMessage(path: string): string {
    const field = path.startsWith('attributes.') ? 'attributes' : path;
    return FIELD_MESSAGES.includes(field)
      ? t(`form.errors.fields.${field}` as never)
      : t('form.errors.fields.generic');
  }

  // After a failed save, focus the first field that needs attention (its message is read with it).
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  /** Marks a field invalid and ties its message (and any hint) to it, for screen readers. */
  const invalid = (path: string, hintId?: string) => {
    const described = [hintId, errors[path] ? `${id}-${path}-error` : undefined].filter(Boolean);
    return {
      ...(errors[path] ? { 'aria-invalid': true as const } : {}),
      ...(described.length ? { 'aria-describedby': described.join(' ') } : {}),
    };
  };
  const fieldClass = (path: string) =>
    `field h-11 w-full px-4 ${errors[path] ? 'border-destructive' : 'border-input'}`;
  const hint = (path: string) =>
    errors[path] ? (
      <p className="text-sm text-destructive" id={`${id}-${path}-error`}>
        {errors[path]}
      </p>
    ) : null;

  return (
    <form
      key={formKey}
      ref={formRef}
      onSubmit={submit}
      onInput={saveDraft}
      className="space-y-6"
      noValidate
      data-testid="listing-form"
    >
      {draft && !listing ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl border bg-soft p-4 text-sm"
          data-testid="draft-banner"
        >
          <span className="flex-1">{t('form.draftFound')}</span>
          <button
            type="button"
            data-testid="draft-continue"
            className="h-9 rounded-full bg-primary px-4 font-semibold text-primary-foreground"
            onClick={() => {
              setCategory(draft.category);
              setSubcategory(draft.subcategory);
              setAttributes(draft.attributes);
              setImages(draft.images);
              setSeed(draft);
              setPlaceId(draft.placeId);
              setDescriptionLength(draft.description.length);
              setFormKey((k) => k + 1);
              setDraft(null);
            }}
          >
            {t('form.draftContinue')}
          </button>
          <button
            type="button"
            data-testid="draft-discard"
            className="h-9 rounded-full px-4 font-semibold text-primary hover:bg-accent"
            onClick={() => {
              clearDraft();
              setDraft(null);
            }}
          >
            {t('form.draftDiscard')}
          </button>
        </div>
      ) : null}
      {!category ? (
        <fieldset data-testid="pick-category" className="space-y-4">
          <legend className="mb-4 text-xl font-semibold">{t('form.pickCategory')}</legend>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('form.whatSelling')}</span>
            <input
              type="text"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder={t('form.whatSellingHint')}
              data-testid="what-selling"
              className="field h-11 w-full border-input px-4"
            />
          </label>
          {guess.length ? (
            <ul className="flex flex-wrap gap-2" role="list" data-testid="category-guesses">
              {guess.map((g) => (
                <li key={g.subcategory}>
                  <button
                    type="button"
                    data-testid={`guess-${g.subcategory}`}
                    onClick={() => {
                      setCategory(g.category);
                      setSubcategory(g.subcategory!);
                      setAttributes({});
                      setSeed({ title: what.trim() });
                      setFormKey((k) => k + 1);
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent"
                  >
                    {t(`taxonomy.categories.${g.category}` as never)} ›{' '}
                    {t(`taxonomy.subcategories.${g.subcategory}` as never)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {categoriesOf(country).map(({ id: c }) => {
              const Icon = CATEGORY_ICONS[c] ?? ImagePlus;
              return (
                <button
                  key={c}
                  type="button"
                  data-testid={`pick-category-${c}`}
                  onClick={() => {
                    setCategory(c);
                    setSubcategory('');
                    setAttributes({});
                  }}
                  className={tile}
                >
                  <span className={tileIcon}>
                    <Icon aria-hidden strokeWidth={1.7} className="size-6" />
                  </span>
                  <span className="space-y-0.5">
                    <span className="block text-lg font-semibold">
                      {t(`taxonomy.categories.${c}`)}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {t(`home.categories.${c}.description`)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {hint('category')}
        </fieldset>
      ) : (
        <div
          className="flex flex-wrap items-center gap-3 rounded-[1.5rem] border bg-card p-3 ps-4"
          data-testid="picked-category"
        >
          {(() => {
            const Icon = CATEGORY_ICONS[category] ?? ImagePlus;
            return (
              <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-ink-foreground">
                <Icon aria-hidden strokeWidth={1.7} className="size-5" />
              </span>
            );
          })()}
          <span className="flex-1 font-semibold">
            {t(`taxonomy.categories.${category}`)}
            {subcategory ? (
              <span className="font-normal text-subtle-foreground">
                {' › '}
                {t(`taxonomy.subcategories.${subcategory}` as never)}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            data-testid="change-category"
            onClick={() => {
              setCategory('');
              setSubcategory('');
              setAttributes({});
            }}
            className="h-9 rounded-full px-4 text-sm font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('form.change')}
          </button>
        </div>
      )}

      {category && !subcategory ? (
        <fieldset data-testid="pick-subcategory" className="space-y-4">
          <legend className="mb-4 text-xl font-semibold">
            {t('form.pickSubcategory', { category: t(`taxonomy.categories.${category}`) })}
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {subcategoriesOf(category).map((sub) => {
              const Icon = SUBCATEGORY_ICONS[sub] ?? ImagePlus;
              return (
                <button
                  key={sub}
                  type="button"
                  data-testid={`pick-subcategory-${sub}`}
                  onClick={() => setSubcategory(sub)}
                  className={`${tile} min-h-0`}
                >
                  <span className={tileIcon}>
                    <Icon aria-hidden strokeWidth={1.7} className="size-5" />
                  </span>
                  <span className="font-semibold leading-tight">
                    {t(`taxonomy.subcategories.${sub}` as never)}
                  </span>
                </button>
              );
            })}
          </div>
          {hint('subcategory')}
        </fieldset>
      ) : null}

      {category && subcategory ? (
        <>
          <Section n={1} title={t('form.sections.images')} hint={t('form.imagesHint')}>
            <ul
              className="grid grid-cols-3 gap-3 sm:grid-cols-4"
              role="list"
              data-testid="uploaded-images"
            >
              {images.map((img, n) => (
                <li key={img.id} className="relative">
                  <img
                    src={img.thumb}
                    alt=""
                    className="aspect-[4/3] w-full rounded-2xl object-cover"
                  />
                  {n === 0 ? (
                    <span className="absolute bottom-2 start-2 rounded-full bg-ink/85 px-2 py-0.5 text-[11px] font-semibold text-ink-foreground">
                      {t('form.mainImage')}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={t('form.removeImage')}
                    onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                    className="absolute -end-2 -top-2 rounded-full bg-background p-1 shadow ring-1 ring-border"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                  {/* Photo order (ADR-0045): buttons, so it works by keyboard and screen reader. */}
                  {images.length > 1 ? (
                    <div
                      className="mt-1.5 flex justify-center gap-1"
                      data-testid={`photo-order-${n}`}
                    >
                      <button
                        type="button"
                        disabled={n === 0}
                        aria-label={t('form.photoEarlier', { n: n + 1 })}
                        onClick={() => setImages((prev) => move(prev, n, n - 1))}
                        className={orderButton}
                      >
                        <ChevronLeft aria-hidden className="size-4 rtl:rotate-180" />
                      </button>
                      {n > 0 ? (
                        <button
                          type="button"
                          aria-label={t('form.photoMain', { n: n + 1 })}
                          data-testid={`photo-main-${n}`}
                          onClick={() => setImages((prev) => move(prev, n, 0))}
                          className={orderButton}
                        >
                          <Star aria-hidden className="size-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={n === images.length - 1}
                        aria-label={t('form.photoLater', { n: n + 1 })}
                        onClick={() => setImages((prev) => move(prev, n, n + 1))}
                        className={orderButton}
                      >
                        <ChevronRight aria-hidden className="size-4 rtl:rotate-180" />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
              {images.length < 10 ? (
                <li className={images.length === 0 ? 'col-span-3 sm:col-span-4' : ''}>
                  <label
                    className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed text-sm font-medium text-subtle-foreground transition-colors hover:bg-accent ${images.length === 0 ? 'h-36' : 'aspect-[4/3]'}`}
                  >
                    {uploading > 0 ? (
                      <Loader2 aria-hidden className="size-6 animate-spin" />
                    ) : (
                      <ImagePlus aria-hidden className="size-6" />
                    )}
                    {uploading > 0 ? t('form.uploading') : t('form.addImages')}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="sr-only"
                      data-testid="field-images"
                      onChange={(e) => {
                        void upload(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </li>
              ) : null}
            </ul>
            {imageError ? (
              <p role="alert" className="text-sm text-destructive" data-testid="image-error">
                {imageError}
              </p>
            ) : null}
          </Section>

          <Section n={2} title={t('form.sections.about')}>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t('form.title')}</span>
              <input
                name="title"
                required
                minLength={3}
                maxLength={120}
                defaultValue={listing?.title ?? seed?.title}
                placeholder={
                  t.has(`form.titlePlaceholder.${category}` as never)
                    ? t(`form.titlePlaceholder.${category}` as never)
                    : undefined
                }
                data-testid="field-title"
                {...invalid('title', `${id}-title-hint`)}
                className={fieldClass('title')}
              />
              <span id={`${id}-title-hint`} className="text-xs text-muted-foreground">
                {t('form.titleHint')}
              </span>
              {hint('title')}
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t('form.description')}</span>
              <textarea
                name="description"
                required
                maxLength={5000}
                rows={6}
                defaultValue={listing?.description ?? seed?.description}
                onChange={(e) => setDescriptionLength(e.target.value.length)}
                data-testid="field-description"
                {...invalid('description')}
                className={`field w-full p-4 ${errors.description ? 'border-destructive' : 'border-input'}`}
              />
              {hint('description')}
            </label>
          </Section>

          {fields.length ? (
            <Section n={3} title={t('form.sections.details')}>
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map((f) => (
                  <label key={f.key} className="space-y-1">
                    <span className="text-sm font-medium">
                      {t(`taxonomy.attributes.${f.key}` as never)}
                      {f.required ? null : (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          ({t('form.optional')})
                        </span>
                      )}
                    </span>
                    {f.kind === 'select' ? (
                      <select
                        required={f.required}
                        value={attributes[f.key] ?? ''}
                        data-testid={`field-attr-${f.key}`}
                        {...invalid(`attributes.${f.key}`)}
                        className={fieldClass(`attributes.${f.key}`)}
                        onChange={(e) => setAttributes((a) => ({ ...a, [f.key]: e.target.value }))}
                      >
                        <option value="" />
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {t(`taxonomy.values.${f.key}.${o}` as never)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="relative block">
                        <input
                          type={f.kind}
                          required={f.required}
                          inputMode={f.kind === 'number' ? 'numeric' : undefined}
                          min={f.kind === 'number' ? f.min : undefined}
                          max={f.kind === 'number' ? f.max : undefined}
                          value={attributes[f.key] ?? ''}
                          data-testid={`field-attr-${f.key}`}
                          {...invalid(`attributes.${f.key}`)}
                          className={`${fieldClass(`attributes.${f.key}`)} ${f.kind === 'number' && f.unit ? 'pe-12' : ''}`}
                          onChange={(e) =>
                            setAttributes((a) => ({ ...a, [f.key]: e.target.value }))
                          }
                        />
                        {f.kind === 'number' && f.unit ? (
                          <span className={unitClass}>{f.unit}</span>
                        ) : null}
                      </span>
                    )}
                    {hint(`attributes.${f.key}`)}
                  </label>
                ))}
              </div>
            </Section>
          ) : null}

          <Section
            n={fields.length ? 4 : 3}
            title={
              priceRule === 'none' ? t('form.sections.place') : t('form.sections.priceAndPlace')
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {priceRule !== 'none' ? (
                <label className="space-y-1">
                  <span className="text-sm font-medium">
                    {t('form.price')}
                    {priceUnit ? ` (${t(`listing.per.${priceUnit}`)})` : null}
                    {priceRule === 'optional' ? (
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        ({t('form.optional')})
                      </span>
                    ) : null}
                  </span>
                  <span className="relative block">
                    <input
                      name="price"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      required={priceRule === 'required'}
                      defaultValue={
                        listing?.price
                          ? String(toMajor(listing.price.amountMinor, listing.price.currency))
                          : seed?.price || undefined
                      }
                      data-testid="field-price"
                      {...invalid('price')}
                      className={`${fieldClass('price')} pe-12`}
                    />
                    <span className={unitClass}>{currencySymbol(currency, locale)}</span>
                  </span>
                  {hint('price')}
                  {guide ? (
                    <span className="block text-sm text-muted-foreground" data-testid="price-guide">
                      {t('price.guide', {
                        from: perUnit(guide.p25),
                        to: perUnit(guide.p75),
                        median: perUnit(guide.median),
                      })}
                    </span>
                  ) : null}
                </label>
              ) : null}
              <label className="space-y-1">
                <span className="text-sm font-medium">{t('form.place')}</span>
                <select
                  name="placeId"
                  required
                  defaultValue={listing?.location.placeId ?? seed?.placeId ?? ''}
                  onChange={(e) => setPlaceId(e.target.value)}
                  data-testid="field-place"
                  {...invalid('placeId')}
                  className={fieldClass('placeId')}
                >
                  <option value="">{t('form.choosePlace')}</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {placeName(p, locale as never)}
                    </option>
                  ))}
                </select>
                {hint('placeId')}
              </label>
            </div>
          </Section>

          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
              data-testid="form-error"
            >
              {formError}
            </div>
          ) : null}

          {quality ? (
            <section
              aria-labelledby={`${id}-quality`}
              className="space-y-2 rounded-2xl border p-4"
              data-testid="quality-meter"
              data-score={quality.score}
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <h2 id={`${id}-quality`} className="font-semibold">
                  {t('form.quality.title')}
                </h2>
                <span className="font-semibold tabular-nums">
                  {Math.round(quality.score * 100)} %
                </span>
              </div>
              <div
                role="meter"
                aria-labelledby={`${id}-quality`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(quality.score * 100)}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${quality.score * 100}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground" data-testid="quality-next">
                {quality.next?.kind === 'photos'
                  ? t('form.quality.photos', { count: quality.next.more })
                  : quality.next?.kind === 'description'
                    ? t('form.quality.description')
                    : quality.next?.kind === 'details'
                      ? t('form.quality.details', {
                          fields: quality.next.missing
                            .map((k) => t(`taxonomy.attributes.${k}` as never))
                            .join(', '),
                        })
                      : t('form.quality.complete')}
              </p>
            </section>
          ) : null}

          <Button
            type="submit"
            size="lg"
            disabled={saving || uploading > 0}
            data-testid="submit-listing"
            className="w-full sm:w-auto"
          >
            <Check aria-hidden />
            {saving ? t('form.saving') : listing ? t('form.submitSave') : t('form.submitCreate')}
          </Button>
        </>
      ) : null}
    </form>
  );
}

/** An unfinished new listing, kept in this browser only (ADR-0045). */
interface Draft {
  category: string;
  subcategory: string;
  attributes: Record<string, string>;
  images: UploadedImage[];
  title: string;
  description: string;
  price: string;
  placeId: string;
  savedAt: string;
}

const DRAFT_KEY = 'raadi.listingDraft';

function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
    return d && typeof d.category === 'string' && d.category ? d : null;
  } catch {
    return null;
  }
}

function writeDraft(d: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // Private windows and blocked storage: no draft, nothing else changes.
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // As above.
  }
}

/** The list with the item at `from` moved to `to`. */
function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

const orderButton =
  'inline-flex size-8 items-center justify-center rounded-full border bg-background hover:bg-accent disabled:opacity-40';

const tile =
  'flex min-h-32 flex-col items-start justify-between gap-4 rounded-[1.6rem] border bg-card p-5 text-start transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const tileIcon =
  'flex size-11 items-center justify-center rounded-2xl bg-soft text-soft-foreground';
const unitClass =
  'pointer-events-none absolute inset-y-0 end-4 flex items-center text-sm text-muted-foreground';

/** A numbered form section on a card. */
function Section({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <fieldset
      aria-labelledby={headingId}
      className="space-y-4 rounded-[1.75rem] border bg-card p-5 sm:p-7"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-ink-foreground"
        >
          {n}
        </span>
        <div className="space-y-0.5">
          <p id={headingId} className="text-lg font-semibold leading-7">
            {title}
          </p>
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      {children}
    </fieldset>
  );
}
