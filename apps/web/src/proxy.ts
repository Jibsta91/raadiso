import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { contentSecurityPolicy, newNonce } from './lib/csp';
import { env } from './lib/env';

// Locale negotiation (Accept-Language / cookie) and prefix redirects.
const intl = createMiddleware(routing);

const ADMIN_PATH = new RegExp(`^/(${routing.locales.join('|')})/admin(/|$)`);

/**
 * Keeps the two hosts apart (ADR-0028): the admin host (admin.<domain>) serves only the
 * /<locale>/admin area, and the website never serves it. Every page gets a fresh script nonce and the
 * CSP that requires it (lib/csp.ts).
 */
export default function proxy(req: NextRequest) {
  const admin = (req.headers.get('host') ?? '').startsWith('admin.');
  const path = req.nextUrl.pathname;
  const adminPath = ADMIN_PATH.test(path);
  if (admin && !adminPath) {
    const locale = routing.locales.find((l) => path.split('/')[1] === l) ?? routing.defaultLocale;
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
  const res = intl(new NextRequest(req, { headers }));
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  // Skip API routes, the BFF's /auth/*, Next internals and static files.
  matcher: ['/((?!api|auth|_next|_vercel|.*\\..*).*)'],
};
