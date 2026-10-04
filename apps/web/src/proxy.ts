import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

// Locale negotiation (Accept-Language / cookie) and prefix redirects.
const intl = createMiddleware(routing);

const ADMIN_PATH = new RegExp(`^/(${routing.locales.join('|')})/admin(/|$)`);

/**
 * Keeps the two hosts apart (ADR-0028): the admin host (admin.<domain>) serves only the
 * /<locale>/admin area, and the website never serves it.
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
  return intl(req);
}

export const config = {
  // Skip API routes, the BFF's /auth/*, Next internals and static files.
  matcher: ['/((?!api|auth|_next|_vercel|.*\\..*).*)'],
};
