import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { adminBase, adminLogin, domain, login } from './support.js';

/**
 * Accessibility gate (ADR-0031): axe-core checks the main pages against WCAG 2.2 A and AA, in
 * light and dark mode. Serious and critical findings fail the run; the rest are reported.
 */
async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? ''),
  );
  const summary = blocking.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join('\n    ')}`,
  );
  expect.soft(summary, `${name}: accessibility problems`).toEqual([]);
}

const PUBLIC_PAGES = [
  ['front page', '/en'],
  ['search', '/en/search?q=sykkel'],
  ['category', '/en/bil'],
  ['status', '/en/status'],
  ['terms', '/en/terms'],
] as const;

for (const scheme of ['light', 'dark'] as const) {
  test(`public pages pass axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [name, path] of PUBLIC_PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await audit(page, `${name} (${scheme})`);
    }
    // A listing page, from the search results.
    await page.goto('/en/search');
    await page.getByTestId('listing-card').first().click();
    await page.waitForURL(/\/listings\//);
    await audit(page, `listing (${scheme})`);
  });
}

test('signed-in pages pass axe', async ({ page }) => {
  await login(page, `kari.nordmann@${domain}`);
  for (const [name, path] of [
    ['account', '/en/account'],
    ['security', '/en/account/security'],
    ['my listings', '/en/my/listings'],
    ['messages', '/en/messages'],
    ['new listing', '/en/listings/new'],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await audit(page, name);
  }
});

test('the admin console passes axe', async ({ page }) => {
  await adminLogin(page, `admin@${domain}`);
  for (const section of [
    '',
    '/users',
    '/listings',
    '/moderation',
    '/orders',
    '/operations',
    '/staff',
    '/audit',
  ]) {
    await page.goto(`${adminBase}/en/admin${section}`);
    await page.waitForLoadState('networkidle');
    await audit(page, `console${section || ' overview'}`);
  }
});
