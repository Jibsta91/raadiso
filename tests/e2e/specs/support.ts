import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

export const domain = process.env.RAADI_DOMAIN ?? 'raadi.localhost';
export const password = process.env.DEMO_USER_PASSWORD ?? 'raadi-demo-pass';
/**
 * The demo staff users' current one-time code for the admin console (RFC 6238 TOTP: HMAC-SHA256,
 * 6 digits, 30 s, the key being DEMO_OTP_SECRET's bytes as Keycloak stores it).
 */
export function totp(secret = process.env.DEMO_OTP_SECRET ?? 'raadi-demo-otp-secret'): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8')).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Answers Keycloak's one-time code step, if it is showing. Keycloak accepts each code once, and
 * parallel workers sign staff in at the same time, so a rejected code is retried in the next window.
 */
export async function enterOtp(page: Page): Promise<void> {
  const otp = page.locator('#otp');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await otp.isVisible().catch(() => false))) return;
    if (attempt > 0) await page.waitForTimeout(31_000 - (Date.now() % 30_000));
    await otp.fill(totp());
    await page.locator('#kc-login').click();
    await page.waitForLoadState();
  }
}

/** The admin console's own host (ADR-0028). */
export const adminBase = process.env.ADMIN_BASE_URL ?? `http://admin.${domain}`;

/**
 * Where sessions.setup.ts keeps a demo user's signed-in session: the e2e container's temp
 * directory, never the checkout (session cookies are secrets; the secret scan checks the tree).
 */
export const SESSION_DIR = join(tmpdir(), 'raadi-e2e-sessions');
export const sessionFile = (email: string) => join(SESSION_DIR, `${email.split('@')[0]}.json`);
/** The same for the admin host's own session (admin-bff). */
export const adminSessionFile = (email: string) =>
  join(SESSION_DIR, `admin-${email.split('@')[0]}.json`);

/**
 * Opens the admin console as a staff member: with the admin-host session sessions.setup.ts made,
 * or by signing in there.
 */
export async function adminLogin(page: Page, email: string): Promise<void> {
  const file = adminSessionFile(email);
  if (existsSync(file)) {
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      cookies: Parameters<ReturnType<Page['context']>['addCookies']>[0];
    };
    await page.context().addCookies(state.cookies);
  }
  await page.goto(`${adminBase}/en/admin`);
  // Keycloak's sign-in form, or its "re-authenticate" form (e-mail already known).
  if (await page.locator('#password').isVisible()) {
    if (await page.locator('#username').isVisible()) await page.locator('#username').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('#kc-login').click();
    await page.locator('#otp').or(page.getByTestId('admin-console')).waitFor();
    await enterOtp(page);
  }
  await expect(page.getByTestId('admin-console')).toBeVisible();
}

/**
 * Signs in as a demo user: with the session sessions.setup.ts made (one sign-in per user for
 * the whole suite), or through Keycloak's hosted page when there is none.
 */
export async function login(page: Page, email: string): Promise<void> {
  const file = sessionFile(email);
  if (existsSync(file)) {
    const state = JSON.parse(readFileSync(file, 'utf8')) as {
      cookies: Parameters<ReturnType<Page['context']>['addCookies']>[0];
    };
    await page.context().addCookies(state.cookies);
    await page.goto('/en');
    await expect(page.getByTestId('nav-account')).toBeVisible();
    return;
  }
  await signIn(page, email);
}

/** Signs in through Keycloak's hosted page (a new session) and waits until the app is back. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/en');
  await page.getByTestId('nav-login').click();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await enterOtp(page);
  await expect(page.getByTestId('nav-account')).toBeVisible();
}

/** Opens the header's account menu (My listings, Account, Log out live there). */
export async function openAccountMenu(page: Page): Promise<void> {
  await page.getByTestId('nav-account').click();
  await expect(page.getByTestId('nav-logout')).toBeVisible();
}

/** Card prices in display order (whole kroner; "Price on request" cards skipped). */
export async function cardPrices(cards: Locator): Promise<number[]> {
  const texts = await cards.getByTestId('listing-card-price').allInnerTexts();
  return texts
    .map((t) => t.replace(/\D/g, ''))
    .filter((digits) => digits !== '')
    .map(Number);
}

/**
 * A listing of the signed-in user, made through the API for one test. Tests that need "a listing of
 * Kari's" must not take the newest one: other tests running in parallel create and delete theirs.
 * Call `remove` in a `finally`, so failed runs do not leave listings behind (50 active at most).
 */
export async function createListing(
  page: Page,
  title: string,
): Promise<{ id: string; href: string; remove: () => Promise<void> }> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.post('/api/v1/listings', {
    headers: { origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title,
      description: 'Laget av en e2e-test.',
      priceNok: 100,
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return {
    id,
    href: `/en/listings/${id}`,
    remove: async () => {
      await page.request.delete(`/api/v1/listings/${id}`, { headers: { origin } });
    },
  };
}
