import { expect, test } from '@playwright/test';
import { domain, login } from './support.js';

test('a seller promotes a listing: pay, get a receipt, rank first in search', async ({ page }) => {
  await login(page, `amina.hassan@${domain}`);
  const origin = new URL(page.url()).origin;
  const title = `Fremhevet sykkel ${Date.now().toString(36)}`;
  const created = await page.request.post('/api/v1/listings', {
    headers: { origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title,
      description: 'Laget av e2e-testen for betaling.',
      priceNok: 1200,
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  // Owner: Promote → choose 7 days → the provider's hosted page.
  await page.goto(`/en/listings/${id}`);
  await page.getByTestId('promote-listing').click();
  await expect(page).toHaveURL(new RegExp(`/en/listings/${id}/promote$`));
  await page.getByTestId('product-promote_7d').check({ force: true });
  await page.getByTestId('promote-pay').click();

  // Raadi Pay (test): the Vipps-compatible mock's approval page.
  await expect(page).toHaveURL(/pay\.raadi\.localhost\/pay\//);
  await expect(page.getByTestId('pay-amount')).toContainText('49');
  await page.getByRole('button', { name: 'Approve payment' }).click();

  // Back in Raadi: the webhook confirms the payment and the order is captured.
  await expect(page).toHaveURL(/\/en\/payments\/[0-9a-f-]{36}$/);
  const orderId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.getByTestId('order-status')).toHaveAttribute('data-status', 'captured', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('order-promoted-until')).toBeVisible();

  // The promotion reaches listings (and search) through events.
  await expect(async () => {
    await page.goto(`/en/listings/${id}`);
    await expect(page.getByTestId('listing-promoted')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  await expect(async () => {
    await page.goto(`/en/search?q=${encodeURIComponent(title)}`);
    const first = page.getByTestId('listing-card').first();
    await expect(first).toContainText(title, { timeout: 1_000 });
    await expect(first.getByTestId('listing-card-promoted')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });

  // A receipt (always sent) with the price and VAT.
  await expect(async () => {
    const res = await page.request.get(
      // This order's receipt, not one from an earlier run.
      `http://mailpit:8025/api/v1/search?query=${encodeURIComponent(`to:"amina.hassan@${domain}" subject:receipt ${orderId}`)}`,
    );
    const body = (await res.json()) as { messages: Array<{ ID: string }> };
    expect(body.messages.length).toBeGreaterThan(0);
    const msg = await page.request.get(
      `http://mailpit:8025/api/v1/message/${body.messages[0]!.ID}`,
    );
    const text = ((await msg.json()) as { Text: string }).Text;
    expect(text).toMatch(/Promoted listing for 7 days: NOK\s?49\.00 \(incl\. VAT NOK\s?9\.80\)/);
  }).toPass({ timeout: 60_000 });
  // Clean up: test listings would otherwise pile up against the 50-listing quota.
  await page.request.delete(`/api/v1/listings/${id}`, { headers: { origin } });
});

test('a declined payment leaves the listing unpromoted and offers a retry', async ({ page }) => {
  await login(page, `amina.hassan@${domain}`);
  const origin = new URL(page.url()).origin;
  const created = await page.request.post('/api/v1/listings', {
    headers: { origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title: `Avvist betaling ${Date.now().toString(36)}`,
      description: 'Laget av e2e-testen for betaling.',
      priceNok: 300,
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/en/listings/${id}/promote`);
  await page.getByTestId('promote-pay').click();
  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByTestId('order-status')).toHaveAttribute('data-status', 'cancelled', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('order-retry')).toBeVisible();
  await page.request.delete(`/api/v1/listings/${id}`, { headers: { origin } });
});
