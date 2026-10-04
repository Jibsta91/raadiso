import { mkdirSync } from 'node:fs';
import { expect, test as setup } from '@playwright/test';
import {
  adminBase,
  adminSessionFile,
  domain,
  password,
  SESSION_DIR,
  sessionFile,
} from './support.js';

// Signs every demo user in once and keeps the session cookies. Specs reuse them through
// login(), so the suite stays under identity-bff's sign-in limit (20 a minute per address, and
// all workers share one address). Specs that sign out sign in by hand, with their own session.
const users = ['kari.nordmann', 'ola.nordmann', 'amina.hassan', 'moderator', 'admin'];

for (const user of users) {
  setup(`sign in ${user}`, async ({ page }) => {
    await page.goto('/en');
    await page.getByTestId('nav-login').click();
    await page.locator('#username').fill(`${user}@${domain}`);
    await page.locator('#password').fill(password);
    await page.locator('#kc-login').click();
    // Right after a cold start, a demo user's first login goes through the welcome page.
    const welcome = page.getByTestId('welcome-continue');
    await expect(page.getByTestId('nav-account').or(welcome)).toBeVisible();
    if (await welcome.isVisible()) await welcome.click();
    await expect(page.getByTestId('nav-account')).toBeVisible();
    mkdirSync(SESSION_DIR, { recursive: true });
    await page.context().storageState({ path: sessionFile(`${user}@${domain}`) });
  });
}

// Staff also get a session on the admin host (admin-bff, its own cookie and Keycloak client).
for (const user of ['moderator', 'support', 'admin']) {
  setup(`sign in ${user} to the admin console`, async ({ page }) => {
    await page.goto(`${adminBase}/en/admin`);
    await page.locator('#username').fill(`${user}@${domain}`);
    await page.locator('#password').fill(password);
    await page.locator('#kc-login').click();
    await expect(page.getByTestId('admin-console')).toBeVisible();
    mkdirSync(SESSION_DIR, { recursive: true });
    await page.context().storageState({ path: adminSessionFile(`${user}@${domain}`) });
  });
}
