import { expect, type Page, test } from '@playwright/test';
import { adminBase, adminLogin, domain, login, openAccountMenu } from './support.js';

test('staff reach the admin console from the account menu; it has its own sign-in', async ({
  page,
}) => {
  await login(page, `moderator@${domain}`);
  await openAccountMenu(page);
  await expect(page.getByTestId('nav-admin')).toHaveAttribute('href', `${adminBase}/en/admin`);
  // The website's session does not carry over: Keycloak asks for the password again
  // (prompt=login), even though the moderator is signed in to the website.
  await page.goto(`${adminBase}/en/admin`);
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.getByTestId('admin-console')).toHaveCount(0);
});

const ALL = [
  'overview',
  'moderation',
  'users',
  'listings',
  'orders',
  'reviews',
  'operations',
  'tools',
  'staff',
  'audit',
] as const;

async function sections(page: Page) {
  const shown: string[] = [];
  for (const s of ALL) if (await page.getByTestId(`admin-nav-${s}`).count()) shown.push(s);
  return shown;
}

test('each role sees its own sections, and nothing else opens', async ({ browser }) => {
  const expected: Record<string, string[]> = {
    admin: [...ALL],
    moderator: ['overview', 'moderation', 'listings', 'reviews'],
    support: ['overview', 'users', 'listings', 'orders', 'reviews'],
    operator: ['overview', 'operations', 'tools'],
  };
  for (const [who, want] of Object.entries(expected)) {
    const page = await browser.newPage();
    await adminLogin(page, `${who}@${domain}`);
    expect(await sections(page), who).toEqual(want);
    for (const hidden of ALL.filter((s) => !want.includes(s) && s !== 'overview')) {
      const res = await page.goto(`${adminBase}/en/admin/${hidden}`);
      expect(res?.status(), `${who} → ${hidden}`).toBe(404);
    }
    await page.close();
  }
});

test('the admin host serves only the console, and the audit log filters', async ({
  browser,
  page,
}) => {
  // Something to find: a listing a moderator removes (an audited action) in this test.
  const owner = await browser.newPage();
  await login(owner, `amina.hassan@${domain}`);
  const created = await owner.request.post('/api/v1/listings', {
    headers: { origin: new URL(owner.url()).origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title: `Revisjon e2e ${Date.now().toString(36)}`,
      description: 'Laget av e2e-testen for revisjonsloggen.',
      priceNok: 10,
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await owner.close();

  await adminLogin(page, `admin@${domain}`);
  await page.goto(`${adminBase}/en/search`);
  await expect(page).toHaveURL(new RegExp(`${adminBase}/en/admin$`));
  await page.goto(`${adminBase}/en/admin/listings/${id}`);
  await page.getByTestId('listing-remove').click();
  await page.getByTestId('listing-remove-dialog').getByText('Duplicate', { exact: true }).click();
  await page.getByTestId('listing-remove-submit').click();
  await expect(page.getByTestId('toast').first()).toContainText('Listing removed');

  await page.getByTestId('admin-nav-audit').click();
  await expect(page).toHaveURL(new RegExp(`${adminBase}/en/admin/audit$`));
  await page
    .getByTestId('audit-filters')
    .locator('select[name="targetType"]')
    .selectOption('listing');
  await page.getByTestId('audit-filters').getByRole('button').click();
  await expect(page).toHaveURL(/targetType=listing/);
  // The removal arrives through the outbox and Kafka; every row shown is about a listing.
  const entries = page.getByTestId('audit-entry');
  await expect(async () => {
    await page.reload();
    await expect(entries.filter({ hasText: id.slice(0, 8) }).first()).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 60_000 });
  for (const row of await entries.all()) await expect(row).toContainText('listing');
  // The export keeps the filter.
  await expect(page.getByTestId('audit-export')).toHaveAttribute('href', /targetType=listing/);
});

test('⌘K finds an account and opens it; g then a letter switches sections', async ({ page }) => {
  await adminLogin(page, `support@${domain}`);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('command-palette')).toBeVisible();
  await page.getByTestId('palette-input').fill('amina');
  const hit = page.getByTestId('palette-item').filter({ hasText: `amina.hassan@${domain}` });
  await expect(hit).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/en\/admin\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('user-email')).toHaveText(`amina.hassan@${domain}`);

  await page.keyboard.press('g');
  await page.keyboard.press('l');
  await expect(page).toHaveURL(new RegExp(`${adminBase}/en/admin/listings$`));
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
});

test('support keeps a note on an account; it is in the account history', async ({ page }) => {
  await adminLogin(page, `support@${domain}`);
  await page.goto(`${adminBase}/en/admin/users?q=amina`);
  await page.getByTestId('user-row').first().locator('a').click();
  await page.getByTestId('tab-notes').click();
  await expect(page).toHaveURL(/tab=notes/);
  await expect(page.getByTestId('user-notes')).toBeVisible();
  const text = `Called about a missing payout ${Date.now().toString(36)}`;
  await page.getByTestId('note-body').fill(text);
  await page.getByTestId('note-submit').click();
  await expect(page.getByTestId('toast').first()).toContainText('Note added');
  await expect(page.getByTestId('user-note').filter({ hasText: text })).toBeVisible();
  // Support cannot change staff roles, and sees no such button.
  await expect(page.getByTestId('user-roles')).toHaveCount(0);
  // The audit entry arrives through the outbox and Kafka, so reload until it is there.
  await page.getByTestId('tab-history').click();
  await expect(page).toHaveURL(/tab=history/);
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('user-history')).toContainText('Note written', { timeout: 2000 });
  }).toPass({ timeout: 90_000 });
});

test('operators see the platform health, not people', async ({ page }) => {
  await adminLogin(page, `operator@${domain}`);
  await page.getByTestId('admin-nav-operations').click();
  await expect(page.getByTestId('ops-ready')).toBeVisible();
  await expect(page.getByTestId('ops-service').filter({ hasText: 'listings' })).toContainText(
    'Ready',
  );
  await expect(page.getByTestId('ops-delivery')).toBeVisible();
  await expect(page.getByTestId('ops-search')).toBeVisible();
});

test('operators find every tool with its sign-in and live status', async ({ page }) => {
  await adminLogin(page, `operator@${domain}`);
  await page.getByTestId('admin-nav-tools').click();
  await expect(page).toHaveURL(/\/admin\/tools$/);
  // Grafana: single sign-on, answers, and the link points at grafana.<domain>.
  const grafana = page.getByTestId('tool-grafana');
  await expect(grafana).toHaveAttribute('data-status', 'up');
  await expect(page.getByTestId('tool-grafana-open')).toHaveAttribute(
    'href',
    new RegExp(`//grafana\\.${domain.replaceAll('.', '\\.')}`),
  );
  // Keycloak's admin console: a generated secret, with the command that prints it.
  await expect(page.getByTestId('tool-keycloak')).toContainText(
    './raadi secret keycloak_admin_password',
  );
  // Every tool the gateway serves here answers (development mode routes them all).
  for (const id of ['errors', 'prometheus', 'openbao', 'traefik', 'mailpit', 'push']) {
    await expect(page.getByTestId(`tool-${id}`), id).toHaveAttribute('data-status', 'up');
  }
});
