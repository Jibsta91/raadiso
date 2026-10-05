import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { domain, login, password } from './support.js';

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

  // Edit it: the form opens filled in, and saving goes back to the updated listing.
  await page.getByTestId('edit-listing').click();
  await expect(page).toHaveURL(/\/m\/listings\/edit\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('field-title')).toHaveValue(title);
  await expect(page.getByTestId('change-category')).toHaveCount(0);
  await page.getByTestId('field-title').fill(`${title} (redigert)`);
  await page.getByTestId('field-price').fill('3200');
  await page.getByTestId('save').click();
  await expect(page).toHaveURL(/\/m\/listings\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('listing-title')).toHaveText(`${title} (redigert)`);
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

test('app: the buyer reviews the seller from the conversation after a sale', async ({
  browser,
}) => {
  const seller = await browser.newPage();
  await login(seller, `ola.nordmann@${domain}`);
  const origin = new URL(seller.url()).origin;
  const title = `App-omtale e2e ${Date.now().toString(36)}`;
  const created = await seller.request.post('/api/v1/listings', {
    headers: { origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title,
      description: 'Laget av e2e-testen for omtaler i appen.',
      priceNok: 150,
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const { id: listingId } = (await created.json()) as { id: string };

  // The buyer asks, the seller answers and marks the listing sold.
  const buyer = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await login(buyer, `kari.nordmann@${domain}`);
  const started = await buyer.request.post('/api/v1/messaging/conversations', {
    headers: { origin },
    data: { listingId, body: 'Er den fortsatt ledig?' },
  });
  expect(started.ok()).toBe(true);
  const conversationId = ((await started.json()) as { conversation: { id: string } }).conversation
    .id;
  expect(
    (
      await seller.request.post(`/api/v1/messaging/conversations/${conversationId}/messages`, {
        headers: { origin },
        data: { body: 'Ja, den er din.' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await seller.request.patch(`/api/v1/listings/${listingId}`, {
        headers: { origin },
        data: { status: 'sold' },
      })
    ).status(),
  ).toBe(200);

  // Once trust has seen the sale, the app offers the review in the conversation.
  await expect(async () => {
    await buyer.goto(`/m/messages/${conversationId}`);
    await expect(buyer.getByTestId('review-open')).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 60_000 });
  await buyer.getByTestId('review-open').click();
  await buyer.getByTestId('review-submit').click();
  await expect(buyer.getByTestId('review-error')).toBeVisible();
  await buyer.getByTestId('review-star-4').click();
  await buyer.getByTestId('review-comment').fill(`Grei handel (${title})`);
  await buyer.getByTestId('review-submit').click();
  await expect(buyer.getByTestId('review-done')).toBeVisible();

  await buyer.reload();
  await expect(buyer.getByTestId('review-done')).toBeVisible();
  await buyer.close();
  await seller.close();
});
