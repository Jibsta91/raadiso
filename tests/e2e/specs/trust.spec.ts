import { expect, test } from '@playwright/test';
import { domain, login, password } from './support.js';

test('buyer and seller review each other after a sale', async ({ browser }) => {
  // Seller (Ola) puts something up for sale.
  const seller = await browser.newPage();
  await login(seller, `ola.nordmann@${domain}`);
  const origin = new URL(seller.url()).origin;
  const title = `Vurderes etter salg ${Date.now().toString(36)}`;
  const created = await seller.request.post('/api/v1/listings', {
    headers: { origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title,
      description: 'Laget av e2e-testen for omtaler.',
      price: { amountMinor: 25000, currency: 'NOK' },
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const { id: listingId } = (await created.json()) as { id: string };

  // Buyer (Kari) contacts the seller; no review is possible yet.
  const buyer = await browser.newPage();
  await login(buyer, `kari.nordmann@${domain}`);
  await buyer.goto(`/en/listings/${listingId}`);
  await buyer.getByTestId('contact-message').fill('Kan jeg hente i kveld?');
  await buyer.getByTestId('contact-submit').click();
  await expect(buyer).toHaveURL(/\/en\/messages\/[0-9a-f-]{36}$/);
  const conversationPath = new URL(buyer.url()).pathname;
  const conversationId = conversationPath.split('/').pop()!;
  await expect(buyer.getByTestId('review-form')).toHaveCount(0);

  // The seller answers and marks the listing sold.
  const reply = await seller.request.post(
    `/api/v1/messaging/conversations/${conversationId}/messages`,
    { headers: { origin }, data: { body: 'Ja, kom etter 18.' } },
  );
  expect(reply.ok()).toBe(true);
  const sold = await seller.request.patch(`/api/v1/listings/${listingId}`, {
    headers: { origin },
    data: { status: 'sold' },
  });
  expect(sold.status()).toBe(200);

  // Once the events reach the trust service, the buyer is offered a review.
  await expect(async () => {
    await buyer.goto(conversationPath);
    await expect(buyer.getByTestId('review-form')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  const comment = `Hyggelig og rask handel (${title})`;
  await buyer.getByTestId('review-star-5').click();
  await buyer.getByTestId('review-comment').fill(comment);
  await buyer.getByTestId('review-submit').click();
  await expect(buyer.getByTestId('review-done')).toBeVisible();

  // The review is on the seller's public profile, linked from the listing.
  await buyer.goto(`/en/listings/${listingId}`);
  await buyer.getByTestId('seller-rating').click();
  await expect(buyer).toHaveURL(/\/en\/users\/[0-9a-f-]{36}$/);
  await expect(buyer.getByTestId('profile-name')).toHaveText('Ola N.');
  await expect(buyer.getByTestId('review-item').filter({ hasText: comment })).toBeVisible();

  // The seller reviews the buyer back from the same conversation.
  await seller.goto(conversationPath);
  await seller.getByTestId('review-star-4').click();
  await seller.getByTestId('review-submit').click();
  await expect(seller.getByTestId('review-done')).toBeVisible();

  await buyer.close();
  await seller.close();
});

test('a user verifies their identity with BankID (mock) and can remove it', async ({ page }) => {
  await login(page, `amina.hassan@${domain}`);
  await page.goto('/en/account');
  // Start from "not verified" (an earlier run may have verified Amina).
  if (await page.getByTestId('verification-remove').isVisible()) {
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('verification-remove').click();
  }
  await page.getByTestId('verify-bankid').click();

  // The mock BankID provider's login page (synthetic test person).
  await expect(page).toHaveURL(/\/realms\/bankid-mock\//);
  await page.locator('#username').fill('03897000033');
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();

  await expect(page).toHaveURL(/\/en\/account\?verification=ok$/);
  await expect(page.getByTestId('verification-outcome')).toHaveAttribute('data-outcome', 'ok');
  await expect(page.getByTestId('verification-card').getByTestId('verified-badge')).toBeVisible();

  // The badge is public.
  await page.getByTestId('my-profile-link').click();
  await expect(page.getByTestId('verified-badge')).toBeVisible();
});
