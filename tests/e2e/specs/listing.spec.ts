import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createListing, domain, login, openAccountMenu } from './support.js';

const fixture = fileURLToPath(new URL('../../fixtures/images/listing.jpg', import.meta.url));

test.describe.configure({ mode: 'serial' });

test('a seller creates a listing with an image, marks it sold and deletes it', async ({ page }) => {
  const title = `Racersykkel e2e ${Date.now().toString(36)}`;
  await login(page, `amina.hassan@${domain}`);

  await page.getByTestId('nav-new-listing').click();
  await expect(page).toHaveURL(/\/en\/listings\/new$/);
  const form = page.getByTestId('listing-form');
  // FINN-style pickers: category tile, then subcategory tile, then the form.
  await form.getByTestId('pick-category-torget').click();
  await form.getByTestId('pick-subcategory-sport').click();
  await expect(form.getByTestId('picked-category')).toContainText('Sports & outdoors');
  await form.getByTestId('field-title').fill(title);
  await form
    .getByTestId('field-description')
    .fill('Lett racersykkel, nylig service. Laget av e2e-testen.');
  await form.getByTestId('field-attr-condition').selectOption('good');
  await form.getByTestId('field-price').fill('4500');
  await form.getByTestId('field-place').selectOption('trondheim');

  // Upload: virus scan and re-encode happen server-side before the thumbnail appears.
  await form.getByTestId('field-images').setInputFiles(fixture);
  await expect(form.getByTestId('uploaded-images').locator('img')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(form.getByTestId('image-error')).toHaveCount(0);

  await form.getByTestId('submit-listing').click();
  await expect(page).toHaveURL(/\/en\/listings\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('listing-title')).toHaveText(title);
  await expect(page.getByTestId('gallery-main')).toBeVisible();
  const actions = page.getByTestId('listing-actions');
  await expect(actions).toContainText('Your listing');
  const detailUrl = page.url();

  // The listing reaches search through the outbox → Debezium → Kafka pipeline.
  await expect(async () => {
    await page.goto(`/en/search?q=${encodeURIComponent(title)}`);
    await expect(page.getByTestId('listing-card-title').first()).toHaveText(title, {
      timeout: 1_000,
    });
  }).toPass({ timeout: 90_000 });

  await openAccountMenu(page);
  await page.getByTestId('nav-my-listings').click();
  const mine = page.getByTestId('my-listings').getByRole('link', { name: title });
  await expect(mine).toContainText('Active');

  await page.goto(detailUrl);
  await actions.getByTestId('toggle-sold').click();
  await expect(actions.getByTestId('toggle-sold')).toHaveText('Relist');
  await expect(page.getByText('Sold', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await actions.getByTestId('delete-listing').click();
  await expect(page).toHaveURL(/\/en\/my\/listings$/);
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
});

test('another user sees no owner actions', async ({ browser }) => {
  const owner = await browser.newPage();
  await login(owner, `ola.nordmann@${domain}`);
  const listing = await createListing(owner, `Eiers annonse e2e ${Date.now().toString(36)}`);
  try {
    await owner.goto(listing.href);
    await expect(owner.getByTestId('listing-actions')).toContainText('Your listing');

    const other = await browser.newPage();
    await login(other, `kari.nordmann@${domain}`);
    await other.goto(listing.href);
    await expect(other.getByTestId('listing-title')).toBeVisible();
    await expect(other.getByTestId('listing-actions')).toHaveCount(0);
    await other.close();
  } finally {
    await listing.remove();
    await owner.close();
  }
});

test('a lower price shows as reduced: on the listing, its history, and the reduced filter', async ({
  page,
}) => {
  // ADR-0044. Kari lowers the price of a new listing from 100 kr to 80 kr.
  await login(page, `kari.nordmann@${domain}`);
  const title = `Prisfall e2e ${Date.now().toString(36)}`;
  const listing = await createListing(page, title);
  try {
    const origin = new URL(page.url()).origin;
    const res = await page.request.patch(`/api/v1/listings/${listing.id}`, {
      headers: { origin },
      data: { price: { amountMinor: 8000, currency: 'NOK' } },
    });
    expect(res.status()).toBe(200);

    await page.goto(listing.href);
    await expect(page.getByTestId('listing-reduced')).toContainText('100');
    await page.getByTestId('price-history').locator('summary').click();
    await expect(page.getByTestId('price-history').locator('tr')).toHaveCount(2);

    // Search learns it through the listing's event.
    await expect(async () => {
      await page.goto(
        `/en/search?priceDropped=true&sort=price_drop&q=${encodeURIComponent(title)}`,
      );
      const card = page.getByTestId('listing-card').filter({ hasText: title });
      await expect(card.getByTestId('listing-card-reduced')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByTestId('chip-priceDropped')).toBeVisible();
  } finally {
    await listing.remove();
  }
});

test('the form shows how complete the listing is, and keeps an unfinished one as a draft', async ({
  page,
}) => {
  // ADR-0045.
  await login(page, `kari.nordmann@${domain}`);
  await page.goto('/en/listings/new');
  const form = page.getByTestId('listing-form');
  if (await form.getByTestId('draft-discard').isVisible())
    await form.getByTestId('draft-discard').click();
  await form.getByTestId('pick-category-torget').click();
  await form.getByTestId('pick-subcategory-sport').click();
  const meter = form.getByTestId('quality-meter');
  await expect(meter).toBeVisible();
  await expect(form.getByTestId('quality-next')).toContainText(/photo/i);
  const before = Number(await meter.getAttribute('data-score'));
  await form.getByTestId('field-attr-condition').selectOption('good');
  await form.getByTestId('field-title').fill('Utkast e2e');
  await expect
    .poll(async () => Number(await meter.getAttribute('data-score')))
    .toBeGreaterThan(before);

  // Come back later: the draft is offered, and continuing restores it.
  await page.waitForTimeout(800);
  await page.goto('/en/listings/new');
  await expect(form.getByTestId('draft-banner')).toBeVisible();
  await form.getByTestId('draft-continue').click();
  await expect(form.getByTestId('field-title')).toHaveValue('Utkast e2e');
  await expect(form.getByTestId('field-attr-condition')).toHaveValue('good');
  await page.goto('/en/listings/new');
  await form.getByTestId('draft-discard').click();
  await expect(form.getByTestId('draft-banner')).toHaveCount(0);
});

test('owners see views, and renew a listing only after a week', async ({ page, browser }) => {
  // ADR-0045. A fresh listing can't be renewed yet; a view by someone else counts.
  await login(page, `kari.nordmann@${domain}`);
  const listing = await createListing(page, `Visninger e2e ${Date.now().toString(36)}`);
  try {
    const visitor = await browser.newPage();
    await visitor.goto(listing.href);
    await expect(visitor.getByTestId('listing-title')).toBeVisible();
    await visitor.close();

    await page.goto('/en/my/listings');
    const row = page.getByTestId('my-listings').locator('li').filter({ hasText: 'Visninger e2e' });
    await expect(row.getByTestId('renew-later')).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(row.getByTestId('my-listing-views')).toContainText('1 view', { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  } finally {
    await listing.remove();
  }
});

test('"what are you selling?" suggests the category and starts the title', async ({ page }) => {
  // ADR-0046: the words go through search's lexicon.
  await login(page, `kari.nordmann@${domain}`);
  await page.goto('/en/listings/new');
  const form = page.getByTestId('listing-form');
  if (await form.getByTestId('draft-discard').isVisible())
    await form.getByTestId('draft-discard').click();
  await form.getByTestId('what-selling').fill('sofa');
  await form.getByTestId('guess-mobler').click();
  await expect(form.getByTestId('picked-category')).toContainText('Furniture');
  await expect(form.getByTestId('field-title')).toHaveValue('sofa');
  await page.goto('/en/listings/new');
  if (await form.getByTestId('draft-discard').isVisible())
    await form.getByTestId('draft-discard').click();
});
