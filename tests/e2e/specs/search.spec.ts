import { expect, test } from '@playwright/test';
import { cardPrices } from './support.js';

test('full-text search from the front page tolerates typos', async ({ page }) => {
  await page.goto('/en');
  await page.getByTestId('home-search-input').fill('langrennski');
  await page.getByTestId('home-search-input').press('Enter');

  await expect(page).toHaveURL(/\/en\/search\?q=langrennski$/);
  await expect(page.getByTestId('search-input')).toHaveValue('langrennski');
  await expect(page.getByTestId('listing-card-title').first()).toContainText(/langrenn/i);
});

test('a word finds the compounds it ends; an empty search shows a way on', async ({ page }) => {
  // Norwegian compounds put the main word last: "sykkel" finds "Terrengsykkel" (seed data).
  await page.goto('/nb/search?q=sykkel');
  await expect(
    page
      .getByTestId('listing-card-title')
      .filter({ hasText: /sykkel/i })
      .first(),
  ).toBeVisible();

  // Nothing matches in this category: search everywhere, or pick a category.
  await page.goto('/en/search?q=sykkel&category=jobb');
  await expect(page.getByTestId('result-count')).toHaveText('No results');
  await page.getByTestId('search-everywhere').click();
  await expect(page).toHaveURL(/\/en\/search\?q=sykkel$/);
  await expect(page.getByTestId('listing-card-title').first()).toBeVisible();
});

test('sorting by price orders the results', async ({ page }) => {
  await page.goto('/en/search?category=torget');
  await page.getByTestId('sort').selectOption('price_asc');
  await expect(page).toHaveURL(/sort=price_asc/);
  const cards = page.getByTestId('listing-card');
  await expect(cards.first()).toBeVisible();
  await expect
    .poll(async () => {
      const asc = await cardPrices(cards);
      return asc.length > 1 && asc.every((p, i) => i === 0 || asc[i - 1]! <= p);
    })
    .toBe(true);

  await page.getByTestId('sort').selectOption('price_desc');
  await expect(page).toHaveURL(/sort=price_desc/);
  await expect
    .poll(async () => {
      const desc = await cardPrices(cards);
      return desc.length > 1 && desc.every((p, i) => i === 0 || desc[i - 1]! >= p);
    })
    .toBe(true);
});

test('geo search: near a place, within a radius, sorted by distance', async ({ page }) => {
  await page.goto('/en/search');
  await page.getByTestId('filter-near').selectOption('bergen');
  await expect(page).toHaveURL(/near=bergen/);
  await page.getByTestId('filter-radius').selectOption('100');
  await expect(page).toHaveURL(/radiusKm=100/);
  await page.getByTestId('sort').selectOption('distance');
  await expect(page).toHaveURL(/sort=distance/);

  const locations = page.getByTestId('listing-card-location');
  await expect(locations.first()).toContainText('km');
  const distances = (await locations.allInnerTexts()).map((t) =>
    Number(/·\s*(\d+)\s*km/.exec(t)?.[1]),
  );
  expect(distances.length).toBeGreaterThan(0);
  expect(distances.every((d) => d <= 100)).toBe(true);
  expect(distances).toEqual([...distances].sort((a, b) => a - b));
});

test('search reads categories and "cheap" out of the words, and each part can be removed', async ({
  page,
}) => {
  // ADR-0041: "billig sykkel" is Sport, cheapest first, with nothing left to match as text.
  await page.goto('/en/search?q=billig%20sykkel');
  await expect(page.getByTestId('search-understood')).toBeVisible();
  await expect(page.getByTestId('chip-subcategory-sport')).toBeVisible();
  await expect(page.getByTestId('sort')).toHaveValue('price_asc');
  await expect(page.getByTestId('listing-card').first()).toBeVisible();

  // Removing the chip keeps the rest, and the words are no longer read again.
  await page.getByTestId('chip-subcategory-sport').click();
  await expect(page).toHaveURL(/understand=false/);
  await expect(page).not.toHaveURL(/subcategory=sport/);

  // The way out: search for the exact words.
  await page.goto('/en/search?q=billig%20sykkel');
  await page.getByTestId('search-exact-words').click();
  await expect(page).toHaveURL(/q=billig\+sykkel&understand=false|understand=false&q=billig/);
  await expect(page.getByTestId('search-understood')).toHaveCount(0);
});

test('suggestions while typing: a category, chosen with the keyboard', async ({ page }) => {
  await page.goto('/en');
  const box = page.getByTestId('home-search-input');
  await box.fill('sof');
  const category = page.getByTestId('suggestion-category').first();
  await expect(category).toContainText('Furniture');
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await box.press('ArrowDown');
  await expect(box).toHaveAttribute('aria-activedescendant', /.+/);
  await box.press('Enter');
  await expect(page).toHaveURL(/\/en\/search\?category=torget&subcategory=mobler/);
  await expect(page.getByTestId('listing-card').first()).toBeVisible();
});
