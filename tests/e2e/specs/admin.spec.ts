import { expect, test } from '@playwright/test';
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
  await expect(page.getByText('Please re-authenticate to continue')).toBeVisible();
});

test('each role sees its own sections', async ({ browser }) => {
  const admin = await browser.newPage();
  await adminLogin(admin, `admin@${domain}`);
  for (const section of ['overview', 'moderation', 'audit'])
    await expect(admin.getByTestId(`admin-nav-${section}`)).toBeVisible();
  await admin.close();

  const support = await browser.newPage();
  await adminLogin(support, `support@${domain}`);
  await expect(support.getByTestId('admin-nav-overview')).toBeVisible();
  await expect(support.getByTestId('admin-nav-moderation')).toHaveCount(0);
  await expect(support.getByTestId('admin-nav-audit')).toHaveCount(0);
  const res = await support.goto(`${adminBase}/en/admin/audit`);
  expect(res?.status()).toBe(404);
  await support.close();
});

test('the admin host serves only the console, and the audit log filters', async ({ page }) => {
  await adminLogin(page, `admin@${domain}`);
  await page.goto(`${adminBase}/en/search`);
  await expect(page).toHaveURL(new RegExp(`${adminBase}/en/admin$`));

  await page.getByTestId('admin-nav-audit').click();
  await expect(page).toHaveURL(new RegExp(`${adminBase}/en/admin/audit$`));
  await page
    .getByTestId('audit-filters')
    .locator('select[name="targetType"]')
    .selectOption('order');
  await page.getByTestId('audit-filters').getByRole('button').click();
  await expect(page).toHaveURL(/targetType=order/);
  // Either refunds are listed (all about orders) or none match yet.
  const entries = page.getByTestId('audit-entry');
  if (await entries.count()) {
    for (const row of await entries.all()) await expect(row).toContainText('Order');
  } else {
    await expect(page.getByTestId('audit-empty')).toBeVisible();
  }
});
