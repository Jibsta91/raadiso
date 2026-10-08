import { expect, test } from '@playwright/test';
import { adminBase, adminLogin, domain } from './support.js';

/**
 * The page CSP (review A5): every page sends one with a fresh nonce and no 'unsafe-inline' script, its
 * scripts carry the nonce, and nothing the pages do is blocked by it.
 */
test('pages send a nonce-based CSP and nothing violates it', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text()))
      violations.push(m.text());
  });
  const nonces = new Set<string>();
  for (const path of ['/en', '/so', '/nb/search?q=sofa', '/en/status']) {
    const res = await page.goto(path, { waitUntil: 'networkidle' });
    const csp = res!.headers()['content-security-policy'] ?? '';
    expect(csp, path).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp, path).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    const nonce = csp.match(/'nonce-([^']+)'/)![1]!;
    nonces.add(nonce);
    // Every script in the HTML the server sent carries this page's nonce. Scripts that Next.js adds later
    // are trusted through 'strict-dynamic' and need none.
    const html = await res!.text();
    const tags = html.match(/<script\b[^>]*>/g) ?? [];
    expect(tags.length, path).toBeGreaterThan(0);
    for (const tag of tags) expect(tag, path).toContain(`nonce="${nonce}"`);
  }
  expect(nonces.size, 'a fresh nonce per page').toBe(4);
  expect(violations).toEqual([]);
});

test('the console sends the same CSP and nothing violates it', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text()))
      violations.push(m.text());
  });
  await adminLogin(page, `operator@${domain}`);
  const res = await page.goto(`${adminBase}/en/admin/operations`, { waitUntil: 'networkidle' });
  expect(res!.headers()['content-security-policy']).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
  // Hydrated: client navigation works (it would not if the CSP had blocked the scripts).
  await page.getByTestId('admin-nav-overview').click();
  await expect(page).toHaveURL(/\/admin$/);
  expect(violations).toEqual([]);
});
