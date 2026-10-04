import { expect, test } from '@playwright/test';
import { domain, enterOtp, password } from './support.js';

const grafana = process.env.GRAFANA_BASE_URL ?? `http://grafana.${domain}`;

test('platform admin opens the provisioned Marketplace dashboard through Raadi SSO', async ({
  page,
}) => {
  await page.goto(`${grafana}/login`);
  await page.getByRole('link', { name: /Raadi SSO/ }).click();
  await page.locator('#username').fill(`admin@${domain}`);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  // The admin has an authenticator (ADR-0028), so Keycloak asks for a one-time code.
  await enterOtp(page);
  await expect(page).toHaveURL(new RegExp(`^${grafana.replaceAll('.', '\\.')}/`));

  await page.goto(`${grafana}/d/raadi-marketplace`);
  await expect(page.getByText('Raadi · Marketplace').first()).toBeVisible({ timeout: 30_000 });
  for (const panel of ['Listing writes/s', 'Consumer lag (messages)', 'Search index lag']) {
    await expect(page.getByText(panel, { exact: true }).first()).toBeVisible();
  }
});
