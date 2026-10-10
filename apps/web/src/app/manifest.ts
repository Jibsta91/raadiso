import type { MetadataRoute } from 'next';
import { currentLocales } from '@/lib/host';

/**
 * The web app manifest: installable from the browser, opening on the site's front page in the
 * country's default language (ADR-0053). Colours are the page background tokens (globals.css); the
 * icons come from the app's (apps/mobile/assets/icon.png), with maskable full-bleed variants.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { defaultLocale } = await currentLocales();
  return {
    id: '/',
    name: 'Raadiso',
    short_name: 'Raadiso',
    lang: defaultLocale,
    start_url: `/${defaultLocale}`,
    scope: '/',
    display: 'standalone',
    background_color: '#f3f4f7',
    theme_color: '#f3f4f7',
    categories: ['shopping', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
