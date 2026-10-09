import type { CountryCode } from '@raadi/catalog/countries';
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { countryForHost, countryLocales } from './lib/country-host';
import { contentSecurityPolicy, newNonce } from './lib/csp';
import { env } from './lib/env';

// Locale negotiation (Accept-Language / cookie) and prefix redirects, among the languages the host's
// country offers, its default first (ADR-0053): raadiso.com is English, then Somali.
const intls = new Map<CountryCode, ReturnType<typeof createMiddleware>>();
function intlFor(code: CountryCode) {
  let intl = intls.get(code);
  if (!intl) {
    intl = createMiddleware({ ...routing, ...countryLocales(code) });
    intls.set(code, intl);
  }
  return intl;
}

const ADMIN_PATH = new RegExp(`^/(${routing.locales.join('|')})/admin(/|$)`);

/**
 * Keeps the two hosts apart (ADR-0028): the admin host (admin.<domain>) serves only the
 * /<locale>/admin area, and the website never serves it. Every page gets a fresh script nonce and the
 * CSP that requires it (lib/csp.ts).
 */
export default function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const admin = host.startsWith('admin.');
  const path = req.nextUrl.pathname;
  const country = countryForHost(host, env.countryHosts, env.defaultCountry);
  const { locales, defaultLocale } = countryLocales(country);
  // A language this country doesn't offer (/nb/… on raadiso.com) goes to the same page in its default.
  const prefix = path.split('/')[1] ?? '';
  if ((routing.locales as readonly string[]).includes(prefix) && !locales.includes(prefix)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${defaultLocale}${path.slice(prefix.length + 1)}`;
    return NextResponse.redirect(url, 307);
  }
  const adminPath = ADMIN_PATH.test(path);
  if (admin && !adminPath) {
    const locale = locales.find((l) => prefix === l) ?? defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}/admin`, req.url));
  }
  if (!admin && adminPath) return new NextResponse(null, { status: 404 });

  const csp = contentSecurityPolicy(newNonce(), {
    authBaseUrl: env.authBaseUrl,
    dev: process.env.NODE_ENV === 'development',
  });
  // On the request, so Next.js (and next-intl, which passes request headers on) puts the nonce on the
  // page's scripts; on the response, so the browser enforces it.
  const headers = new Headers(req.headers);
  headers.set('content-security-policy', csp);
  const res = intlFor(country)(new NextRequest(req, { headers }));
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  // Skip API routes, the BFF's /auth/*, Next internals and static files.
  matcher: ['/((?!api|auth|_next|_vercel|.*\\..*).*)'],
};
