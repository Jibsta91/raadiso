import localFont from 'next/font/local';

/*
 * Self-hosted variable fonts (OFL-1.1) from the @fontsource-variable packages: next/font/local copies the
 * Latin woff2 into the build, preloads it and sizes a local fallback to match, so text shows at once
 * (display: swap) without a layout jump. Nothing is fetched from a font service at runtime (ADR-0009).
 */

/** Geist: everything people read and type. */
export const geist = localFont({
  src: '../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  preload: true,
  variable: '--font-geist',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

/** Bricolage Grotesque: display headings and the wordmark only. */
export const bricolage = localFont({
  src: '../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  preload: true,
  variable: '--font-bricolage',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  adjustFontFallback: 'Arial',
});
