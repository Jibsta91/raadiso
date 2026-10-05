import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { domain, password } from './support.js';

const fixture = fileURLToPath(new URL('../../fixtures/images/listing.jpg', import.meta.url));

// The Expo app's web build under /m (ADR-0021), at a phone's size.
test.use({ viewport: { width: 393, height: 852 } });

test('app: search, open a listing, sign in, my listings, log out back to the app', async ({
  page,
}) => {
  await page.goto('/m/');
  await expect(page.getByTestId('tab-bar')).toBeVisible();

  await page.getByTestId('tab-search').click();
  await expect(page).toHaveURL(/\/m\/search/);
  await page.getByTestId('search-input').fill('Kawasaki');
  await page.getByTestId('search-input').press('Enter');
  await expect(page).toHaveURL(/\/m\/search\?q=Kawasaki/);
  // Tab screens stay mounted: scope to the search screen, not the home tab underneath.
  const card = page.getByTestId('search-results').getByTestId('listing-card').first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/m\/listings\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('listing-title')).toContainText('Kawasaki');

  // Sign in through the BFF and Keycloak, and come back to the app.
  await page.goto('/m/account');
  await page.getByTestId('login').click();
  await page.locator('#username').fill(`kari.nordmann@${domain}`);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  // Right after a cold start, a demo user's first login goes through the welcome page.
  await expect(page).toHaveURL(/\/m\/account$|\/welcome/);
  if (/\/welcome/.test(page.url())) await page.getByTestId('welcome-continue').click();
  await expect(page).toHaveURL(/\/m\/account$/);
  await expect(page.getByTestId('signed-in-as')).toContainText(`kari.nordmann@${domain}`);

  // A route starting with "m" must keep its name under the /m base path.
  await page.getByTestId('my-listings').click();
  await expect(page).toHaveURL(/\/m\/my-listings$/);
  await expect(page.getByTestId('my-listing').first()).toBeVisible();

  await page.goto('/m/account');
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/m\/account$/);
  await expect(page.getByTestId('login')).toBeVisible();
});

test("app: unknown routes show the app's own not-found screen", async ({ page }) => {
  await page.goto('/m/does-not-exist');
  await expect(page.getByTestId('not-found')).toBeVisible();
});

test('app: sell something, with a photo, and land on the new listing', async ({ page }) => {
  const title = `App-sykkel e2e ${Date.now().toString(36)}`;
  await page.goto('/m/account');
  await page.getByTestId('login').click();
  await page.locator('#username').fill(`ola.nordmann@${domain}`);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(/\/m\/account$|\/welcome/);
  if (/\/welcome/.test(page.url())) await page.getByTestId('welcome-continue').click();

  await page.getByTestId('account-new-listing').click();
  await expect(page).toHaveURL(/\/m\/listings\/new$/);
  await page.getByTestId('pick-category-torget').click();
  await page.getByTestId('pick-subcategory-sport').click();
  await expect(page.getByTestId('picked-category')).toContainText('Sport');

  // The web build's picker opens a file chooser; the photo is scanned and re-encoded server-side.
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-photos').click();
  await (await chooser).setFiles(fixture);
  await expect(page.getByTestId('listing-form').getByRole('img').first()).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByTestId('publish')).toBeDisabled();
  await page.getByTestId('field-title').fill(title);
  await page
    .getByTestId('field-description')
    .fill('Lett racersykkel. Lagt ut fra appen av e2e-testen.');
  await page.getByTestId('field-attr-condition-good').click();
  await page.getByTestId('field-price').fill('3500');
  await page.getByTestId('field-place').fill('tromso');
  await page.getByTestId('place-tromso').click();
  await expect(page.getByTestId('field-place-selected')).toContainText('Tromsø');

  await page.getByTestId('publish').click();
  await expect(page).toHaveURL(/\/m\/listings\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('listing-title')).toHaveText(title);
  await expect(page.getByTestId('own-listing')).toBeVisible();
  // Clean up: test listings would otherwise pile up against the 50-listing quota.
  const id = page.url().split('/').pop()!;
  await page.request.delete(`/api/v1/listings/${id}`, {
    headers: { origin: new URL(page.url()).origin },
  });
});

test("app: a category's own filters narrow the results", async ({ page }) => {
  await page.goto('/m/search?category=bil');
  const results = page.getByTestId('search-results');
  const total = results.getByTestId('search-total');
  await expect(total).toBeVisible();
  const before = Number((await total.innerText()).replace(/\D/g, ''));

  await results.getByTestId('open-filters').click();
  await page.getByTestId('filter-fuel-electric').click();
  await page.getByTestId('filter-yearMin').fill('2015');
  await page.getByTestId('filters-apply').click();

  await expect(page).toHaveURL(/fuel=electric/);
  await expect(page).toHaveURL(/yearMin=2015/);
  await expect(results.getByTestId('open-filters')).toContainText('(2)');
  await expect
    .poll(async () => Number((await total.innerText()).replace(/\D/g, '')))
    .toBeLessThan(before);
});

test("app: a seller's profile from the listing, and the notifications inbox", async ({ page }) => {
  await page.goto('/m/search?q=Kawasaki');
  await page.getByTestId('search-results').getByTestId('listing-card').first().click();
  await expect(page).toHaveURL(/\/m\/listings\/[0-9a-f-]{36}$/);
  await page.getByTestId('seller').click();
  await expect(page).toHaveURL(/\/m\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('profile-name')).toBeVisible();
  await expect(page.getByTestId('profile-verification')).toBeVisible();

  await page.goto('/m/account');
  await page.getByTestId('login').click();
  await page.locator('#username').fill(`amina.hassan@${domain}`);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(/\/m\/account$|\/welcome/);
  if (/\/welcome/.test(page.url())) await page.getByTestId('welcome-continue').click();

  await page.getByTestId('open-notifications').click();
  await expect(page).toHaveURL(/\/m\/notifications$/);
  await expect(page.getByTestId('notifications')).toBeVisible();

  await page.goto('/m/account');
  await page.getByTestId('open-my-profile').click();
  await expect(page).toHaveURL(/\/m\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('profile-name')).toBeVisible();
});
