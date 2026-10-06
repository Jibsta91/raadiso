/** Pure security helpers (unit tested). */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SUPPORTED = ['nb', 'en', 'so'] as const;
export type Locale = (typeof SUPPORTED)[number];

/**
 * Only same-site relative paths are allowed as post-login redirect targets
 * (prevents open redirects such as "//evil.com" or "/\\evil.com").
 */
export function safeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex -- deliberately rejects control characters (header/URL injection)
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'http://raadi.invalid');
    return url.host === 'raadi.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function normaliseLocale(value: unknown): Locale {
  return SUPPORTED.includes(value as Locale) ? (value as Locale) : 'nb';
}

/**
 * Keycloak calls Norwegian "no". Somali comes from the Raadi theme
 * (deploy/keycloak/themes/raadi), which falls back to English where it has no text.
 */
export function keycloakUiLocale(locale: Locale): string {
  return locale === 'nb' ? 'no' : locale;
}

/**
 * Where to go after the callback: a user's very first login goes through the
 * welcome page, which then continues to the original target. The welcome page
 * keeps the language the user was browsing in (the target's locale), falling
 * back to their profile language.
 */
export function afterLoginPath(
  returnTo: string,
  profileLocale: Locale,
  firstLogin: boolean,
): string {
  if (!firstLogin) return returnTo;
  const fromPath = returnTo.split(/[/?#]/)[1];
  const locale = SUPPORTED.includes(fromPath as Locale) ? (fromPath as Locale) : profileLocale;
  return `/${locale}/welcome?${new URLSearchParams({ next: returnTo })}`;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated, state-changing requests: the browser
 * must prove the request comes from our own origin (Origin header, or
 * Sec-Fetch-Site when Origin is absent). SameSite=Lax cookies are the first layer.
 */
export function isCsrfSafe(
  method: string,
  headers: { origin?: string | string[]; 'sec-fetch-site'?: string | string[] },
  allowedOrigins: string[],
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  const origin = first(headers.origin);
  if (origin) return allowedOrigins.includes(origin);
  const site = first(headers['sec-fetch-site']);
  return site === 'same-origin';
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Login CSRF defence (RFC 9700 §4.7): the callback must come back to the browser that started the
 * login. The browser keeps a random secret in a short-lived cookie; the login transaction keeps only
 * its hash. Without it, someone could send a victim their own callback URL and sign the victim into the
 * attacker's account (and a BankID check done there would verify the attacker).
 */
export function newBrowserBinding(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: sha256(secret).toString('base64url') };
}

export function browserBindingMatches(
  secret: string | undefined,
  hash: string | undefined,
): boolean {
  if (!secret || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = sha256(secret);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** One cookie per login in progress, so two tabs signing in at once do not overwrite each other. */
export function loginCookieName(sessionCookie: string, state: string): string {
  return `${sessionCookie}_login_${sha256(state).toString('hex').slice(0, 16)}`;
}
