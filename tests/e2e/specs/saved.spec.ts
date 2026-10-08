import { expect, test } from '@playwright/test';
import { domain, login, openAccountMenu } from './support.js';

test.describe.configure({ mode: 'serial' });

test('favourites: heart a listing, find it under Favourites, remove it', async ({ browser }) => {
  // Kari sells something (through the API with her session); Amina favourites it.
  const seller = await browser.newPage();
  await login(seller, `kari.nordmann@${domain}`);
  const title = `Favoritt e2e ${Date.now().toString(36)}`;
  const created = await seller.request.post('/api/v1/listings', {
    headers: { origin: new URL(seller.url()).origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title,
      description: 'Laget av e2e-testen for favoritter.',
      price: { amountMinor: 25000, currency: 'NOK' },
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const page = await browser.newPage();
  await login(page, `amina.hassan@${domain}`);
  // New listings are searchable a moment after publishing (Kafka -> OpenSearch).
  await expect(async () => {
    await page.goto(`/en/search?q=${encodeURIComponent(title)}`);
    await expect(page.getByTestId('listing-card')).toHaveCount(1, { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const heart = page.getByTestId('favourite-toggle').first();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  // The heart turns red at once; wait for the server before reloading.
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/v1/saved/favourites/') && r.request().method() === 'PUT',
  );
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  expect((await saved).status()).toBe(204);
  await page.reload();
  await expect(page.getByTestId('favourite-toggle').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await openAccountMenu(page);
  await page.getByTestId('nav-favourites').click();
  await expect(page).toHaveURL(/\/en\/my\/favourites$/);
  const favourite = page
    .getByTestId('favourites')
    .getByTestId('listing-card')
    .filter({ hasText: title });
  await expect(favourite).toHaveCount(1);

  // The heart on the listing page shows the same state; removing it empties the list again.
  await favourite.click();
  await expect(page).toHaveURL(/\/en\/listings\/[0-9a-f-]{36}$/);
  const inline = page.getByTestId('listing-detail').getByTestId('favourite-toggle');
  await expect(inline).toHaveAttribute('aria-pressed', 'true');
  const removed = page.waitForResponse(
    (r) => r.url().includes('/api/v1/saved/favourites/') && r.request().method() === 'DELETE',
  );
  await inline.click();
  await expect(inline).toHaveAttribute('aria-pressed', 'false');
  expect((await removed).status()).toBe(204);
  await page.goto('/en/my/favourites');
  await expect(page.getByTestId('favourites').getByText(title, { exact: true })).toHaveCount(0);
  await page.close();
  // Clean up: test listings would otherwise pile up against the 50-listing quota.
  await seller.request.delete(`/api/v1/listings/${id}`, {
    headers: { origin: new URL(seller.url()).origin },
  });
  await seller.close();
});

test('saved searches: save a search, see it listed with its filters, open and delete it', async ({
  page,
}) => {
  await login(page, `amina.hassan@${domain}`);
  const q = `e2e${Date.now().toString(36)}`;
  await page.goto(`/en/search?q=${q}&category=torget&sort=price_asc`);
  await page.getByTestId('save-search').click();
  await expect(page.getByTestId('search-saved')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('search-saved')).toBeVisible();

  await page.getByTestId('search-saved').click();
  await expect(page).toHaveURL(/\/en\/my\/saved-searches$/);
  const row = page.getByTestId('saved-search').filter({ hasText: q });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Marketplace');

  // Alerts can be switched off and on.
  const notify = row.getByTestId('saved-search-notify');
  await expect(notify).toHaveAttribute('aria-pressed', 'true');
  await notify.click();
  await expect(notify).toHaveAttribute('aria-pressed', 'false');

  // Opening it shows the results (sorting is not part of a saved search).
  await row.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/en/search\\?.*q=${q}`));
  await expect(page).not.toHaveURL(/price_asc/);

  await page.goto('/en/my/saved-searches');
  await page
    .getByTestId('saved-search')
    .filter({ hasText: q })
    .getByTestId('saved-search-delete')
    .click();
  await expect(page.getByTestId('saved-search').filter({ hasText: q })).toHaveCount(0);
});
