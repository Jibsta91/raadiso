import { expect, test } from '@playwright/test';

test('front page shows the latest listings', async ({ page }) => {
  await page.goto('/en');
  await expect(page.getByTestId('latest-listings').getByTestId('listing-card')).toHaveCount(8);
});

test('browse: home → category page → subcategory → listing detail', async ({ page }) => {
  await page.goto('/en');
  await page.getByTestId('category-bil').click();

  // The category's own front page (FINN-style): subcategory tiles with counts.
  await expect(page).toHaveURL(/\/en\/bil$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cars');
  const tile = page.getByTestId('subcategory-tiles').getByRole('link').first();
  const tileCount = Number((await tile.innerText()).match(/(\d+) listings?/)?.[1]);
  expect(tileCount).toBeGreaterThan(0);
  await tile.click();

  await expect(page).toHaveURL(/\/en\/search\?category=bil&subcategory=/);
  await expect(page.getByTestId('facet-category-bil')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('result-count')).toHaveText(new RegExp(`^${tileCount} results?$`));
  await expect(page.getByTestId('crumb-category')).toHaveText('Cars');

  const card = page.getByTestId('listing-card').first();
  const title = await card.getByTestId('listing-card-title').innerText();
  await card.click();

  await expect(page).toHaveURL(/\/en\/listings\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('listing-title')).toHaveText(title);
  await expect(page.getByTestId('listing-price')).not.toBeEmpty();
  await expect(page.getByTestId('gallery-main')).toBeVisible();
  // Anonymous visitors get no owner actions.
  await expect(page.getByTestId('listing-actions')).toHaveCount(0);
});

test('listing page: title and price first; the photo opens full screen and Escape closes it', async ({
  page,
}) => {
  await page.goto('/en/search?q=sykkel');
  // A listing with photos (listings made by other tests may have none).
  await page
    .getByTestId('listing-card')
    .filter({ has: page.locator('img') })
    .first()
    .click();
  // Title and price come before the photos in the page (phones, screen readers).
  const order = await page
    .getByTestId('listing-detail')
    .evaluate((el) =>
      ['listing-title', 'listing-price', 'gallery-main'].map((id) =>
        Array.from(el.querySelectorAll('[data-testid]')).findIndex(
          (n) => n.getAttribute('data-testid') === id,
        ),
      ),
    );
  expect(order[0]).toBeLessThan(order[2]!);
  expect(order[1]).toBeLessThan(order[2]!);

  await page.getByTestId('gallery-open').click();
  await expect(page.getByTestId('gallery-dialog')).toBeVisible();
  await expect(page.getByTestId('gallery-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gallery-dialog')).toBeHidden();
});

test('a price check against similar listings, and good deals marked in the results', async ({
  page,
}) => {
  // ADR-0043: cars compare by make and model, then within their subcategory.
  await page.goto('/en/search?category=bil&subcategory=personbil');
  await expect(page.getByTestId('listing-card-deal').first()).toBeVisible();
  await page.getByTestId('listing-card').first().click();
  const insight = page.getByTestId('price-insight');
  await expect(insight).toBeVisible();
  await expect(insight).toHaveAttribute('data-rating', /^(unusually_low|great|good|fair|high)$/);
  await expect(insight).toContainText(/similar listing/);
});
