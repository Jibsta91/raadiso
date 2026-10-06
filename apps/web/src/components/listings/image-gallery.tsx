'use client';

import type { Listing } from '@raadi/api-client';
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

/** How far a finger must travel sideways to change the photo, in CSS pixels. */
const SWIPE = 40;

/**
 * The listing's photos: arrows, arrow keys and swipes move between them, and the photo opens full screen
 * in a native dialog (focus stays inside, Escape closes it).
 */
export function ImageGallery({ images, title }: { images: Listing['images']; title: string }) {
  const t = useTranslations('listing');
  const [index, setIndex] = useState(0);
  // The full-size photo is only fetched once someone opens it.
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const swipeFrom = useRef<number | null>(null);
  const current = images[index];
  if (!current) return null;

  const many = images.length > 1;
  const go = (step: number) => setIndex((i) => (i + step + images.length) % images.length);
  const alt = (i: number) => t('imageAlt', { n: i + 1, count: images.length, title });
  const onKey = (e: KeyboardEvent) => {
    if (!many) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else return;
    e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') swipeFrom.current = e.clientX;
  };
  const onPointerUp = (e: PointerEvent) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (from === null || !many) return;
    const dx = e.clientX - from;
    if (Math.abs(dx) >= SWIPE) go(dx < 0 ? 1 : -1);
  };

  const arrows = (big: boolean) =>
    many ? (
      <>
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label={t('previousImage')}
          className={`absolute start-2 top-1/2 grid -translate-y-1/2 place-items-center rounded-full bg-background/85 shadow ${big ? 'size-12' : 'size-10'}`}
          data-testid="gallery-previous"
        >
          <ChevronLeft aria-hidden className="size-5 rtl:rotate-180" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label={t('nextImage')}
          className={`absolute end-2 top-1/2 grid -translate-y-1/2 place-items-center rounded-full bg-background/85 shadow ${big ? 'size-12' : 'size-10'}`}
          data-testid="gallery-next"
        >
          <ChevronRight aria-hidden className="size-5 rtl:rotate-180" />
        </button>
      </>
    ) : null;

  return (
    <div
      className="space-y-2"
      role="region"
      aria-roledescription={t('gallery')}
      aria-label={title}
      onKeyDown={onKey}
    >
      <div
        className="relative touch-pan-y overflow-hidden rounded-lg bg-muted"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            dialog.current?.showModal();
          }}
          aria-label={t('openImage', { n: index + 1, count: images.length })}
          className="block w-full cursor-zoom-in"
          data-testid="gallery-open"
        >
          <img
            src={current.urls.large}
            alt={alt(index)}
            className="aspect-[4/3] w-full object-contain"
            data-testid="gallery-main"
          />
        </button>
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-2 end-2 grid size-8 place-items-center rounded-full bg-background/85"
        >
          <Maximize2 className="size-4" />
        </span>
        {arrows(false)}
        {many ? (
          <p
            className="absolute bottom-2 start-2 rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium"
            aria-live="polite"
            data-testid="gallery-position"
          >
            {t('imagePosition', { n: index + 1, count: images.length })}
          </p>
        ) : null}
      </div>
      {many ? (
        <ul className="flex gap-2 overflow-x-auto" role="list">
          {images.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={alt(i)}
                aria-current={i === index}
                className={`overflow-hidden rounded-md border-2 ${i === index ? 'border-primary' : 'border-transparent'}`}
              >
                <img
                  src={img.urls.thumb}
                  alt=""
                  className="h-16 w-20 object-cover"
                  loading="lazy"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <dialog
        ref={dialog}
        aria-label={title}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
        onClose={() => setOpen(false)}
        onKeyDown={onKey}
        onClick={(e) => {
          // A click on the dark area around the photo closes it, like Escape.
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
        data-testid="gallery-dialog"
      >
        <div
          className="relative grid h-full touch-pan-y place-items-center"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          {open ? (
            <img
              src={current.urls.large}
              alt={alt(index)}
              className="max-h-full max-w-full object-contain"
            />
          ) : null}
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={t('closeImage')}
            className="absolute end-3 top-3 grid size-12 place-items-center rounded-full bg-background/85 text-foreground"
            data-testid="gallery-close"
            autoFocus
          >
            <X aria-hidden className="size-5" />
          </button>
          <div className="text-foreground">{arrows(true)}</div>
        </div>
      </dialog>
    </div>
  );
}
