import type { Category } from '@raadi/catalog';
import type { DemoImage } from '@raadi/catalog/demo';

/*
 * Category icons from Lucide (https://lucide.dev), ISC License,
 * Copyright (c) Lucide Icons and Contributors. Used for generated demo images only.
 */
const ICONS: Record<string, string> = {
  torget:
    '<path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>',
  bil: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  eiendom:
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  jobb: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  reise:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
};

/** Somaliland's categories (ADR-0040) reuse the closest drawing. */
const DRAWING: Partial<Record<Category, string>> = {
  vehicles: 'bil',
  property: 'eiendom',
  jobs: 'jobb',
  services: 'jobb',
  business: 'jobb',
};
/** A 1280×960 illustration: gradient in the image's hue, soft circles, the category icon. */
export function demoSvg(image: DemoImage): string {
  const h = image.hue;
  const seed = parseInt(image.id.slice(0, 8), 16);
  const circles = Array.from({ length: 6 }, (_, i) => {
    const x = (seed >> (i * 3)) % 1280;
    const y = (seed >> (i * 2 + 1)) % 960;
    const r = 80 + ((seed >> i) % 220);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="0.07"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960" viewBox="0 0 1280 960">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${h},55%,52%)"/><stop offset="1" stop-color="hsl(${(h + 35) % 360},60%,28%)"/>
</linearGradient></defs>
<rect width="1280" height="960" fill="url(#g)"/>${circles}
<g transform="translate(448 288) scale(16)" fill="none" stroke="#fff" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${ICONS[DRAWING[image.category] ?? image.category] ?? ICONS.torget}</g>
</svg>`;
}
