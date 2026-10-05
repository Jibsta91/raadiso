import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { domain, login, signIn } from './support.js';

/** A platform authenticator inside Chromium (WebAuthn over CDP): passkeys without a phone. */
async function virtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

test('the security page shows where I am signed in, and signs out the others', async ({
  browser,
}) => {
  // A second session for the same person, as on another computer.
  const other = await browser.newPage();
  await signIn(other, `ola.nordmann@${domain}`);
  await other.close();

  const page = await browser.newPage();
  await login(page, `ola.nordmann@${domain}`);
  await page.goto('/en/account');
  await page.getByTestId('open-security').click();
  await expect(page.getByTestId('security-page')).toBeVisible();
  await expect(page.getByTestId('security-checkup')).toContainText('/ 100');
  const sessions = page.getByTestId('security-session');
  await expect(sessions.filter({ has: page.getByTestId('this-device') })).toHaveCount(1);
  expect(await sessions.count()).toBeGreaterThan(1);

  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('sign-out-others').click();
  await expect(sessions).toHaveCount(1);
  await expect(sessions.first().getByTestId('this-device')).toBeVisible();
  await expect(page.getByTestId('add-passkey')).toHaveAttribute(
    'href',
    /action=webauthn-register-passwordless/,
  );
  await page.close();
});

test('add a passkey, sign in with it, and remove it again', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await virtualAuthenticator(page);
  await signIn(page, `amina.hassan@${domain}`);
  await page.goto('/en/account/security');

  // Keycloak's registration page, then back to the security page with the new passkey.
  const name = `e2e passkey ${Date.now().toString(36)}`;
  await page.getByTestId('add-passkey').click();
  page.once('dialog', (d) => void d.accept(name));
  await page.getByRole('button', { name: /register/i }).click();
  await expect(page).toHaveURL(/\/en\/account\/security/);
  const passkeys = page.getByTestId('passkeys').locator('li');
  await expect(passkeys.filter({ hasText: name })).toHaveCount(1);

  // Sign out, then sign in with the passkey: no password. Keycloak's login page offers the
  // passkey through conditional UI, which the virtual authenticator answers at once (otherwise
  // its "Sign in with Passkey" button does it).
  await page.goto('/en/account');
  await page.getByRole('button', { name: 'Log out' }).last().click();
  await expect(page.getByTestId('nav-login')).toBeVisible();
  await page.goto('/auth/login?returnTo=/en/account/security&locale=en');
  const passkeyButton = page.getByRole('button', { name: /passkey/i });
  await Promise.race([
    page.waitForURL(/\/en\/account\/security/),
    passkeyButton.click().catch(() => undefined),
  ]);
  await expect(page).toHaveURL(/\/en\/account\/security/);
  await expect(page.locator('#password')).toHaveCount(0);
  await expect(page.getByTestId('security-level')).toBeVisible();

  // Removing needs a recent sign-in: we just signed in. Also clears passkeys earlier runs left.
  page.on('dialog', (d) => void d.accept());
  const ours = passkeys.filter({ hasText: 'e2e passkey' });
  while ((await ours.count()) > 0) {
    const before = await ours.count();
    await ours.first().getByRole('button', { name: 'Remove' }).click();
    await expect(ours).toHaveCount(before - 1);
  }
  await context.close();
});
