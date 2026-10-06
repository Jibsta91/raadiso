import { expect, test } from '@playwright/test';
import { createListing, domain, login } from './support.js';

test('buyer contacts a seller and both see new messages live', async ({ browser }) => {
  const seller = await browser.newPage();
  await login(seller, `kari.nordmann@${domain}`);
  const listing = await createListing(seller, `Ledig e2e ${Date.now().toString(36)}`);
  try {
    const listingHref = listing.href;

    // Buyer: contact the seller from the listing page.
    const buyer = await browser.newPage();
    await login(buyer, `ola.nordmann@${domain}`);
    await buyer.goto(listingHref);
    const question = `Er denne ledig? (e2e ${Date.now().toString(36)})`;
    await buyer.getByTestId('contact-message').fill(question);
    await buyer.getByTestId('contact-submit').click();
    await expect(buyer).toHaveURL(/\/en\/messages\/[0-9a-f-]{36}$/);
    await expect(buyer.getByTestId('thread-counterpart')).toHaveText('Kari N.');
    await expect(buyer.getByTestId('thread-message').filter({ hasText: question })).toHaveAttribute(
      'data-from',
      'me',
    );
    const conversationUrl = buyer.url();

    // Seller: unread badge, inbox entry, then the thread.
    await seller.goto('/en/messages');
    await expect(seller.getByTestId('nav-unread')).toBeVisible();
    await seller.getByTestId('conversation-item').filter({ hasText: question }).click();
    await expect(seller).toHaveURL(conversationUrl);
    await expect(
      seller.getByTestId('thread-message').filter({ hasText: question }),
    ).toHaveAttribute('data-from', 'them');
    await expect(seller.getByTestId('thread')).toHaveAttribute('data-live', 'true');
    await expect(buyer.getByTestId('thread')).toHaveAttribute('data-live', 'true');

    // Seller replies: it appears on the buyer's open page without a reload.
    await seller.getByTestId('compose-input').fill('Ja, den er ledig!');
    await seller.getByTestId('compose-send').click();
    await expect(
      buyer.getByTestId('thread-message').filter({ hasText: 'Ja, den er ledig!' }).last(),
    ).toHaveAttribute('data-from', 'them');

    // And the other way round, sent with Enter.
    await buyer.getByTestId('compose-input').fill('Supert, jeg kommer i morgen.');
    await buyer.getByTestId('compose-input').press('Enter');
    await expect(
      seller
        .getByTestId('thread-message')
        .filter({ hasText: 'Supert, jeg kommer i morgen.' })
        .last(),
    ).toBeVisible();

    await buyer.close();
  } finally {
    await listing.remove();
    await seller.close();
  }
});

test('sellers are not offered to message themselves; visitors are asked to log in', async ({
  page,
}) => {
  // Seeded cars: no other spec creates or deletes listings in this category.
  await page.goto('/en/search?category=bil');
  await page.getByTestId('listing-card').first().click();
  await expect(page.getByTestId('contact-login')).toBeVisible();
  await expect(page.getByTestId('contact-seller')).toHaveCount(0);

  await login(page, `kari.nordmann@${domain}`);
  await page.goto('/en/my/listings');
  await page.getByTestId('my-listings').getByRole('link').first().click();
  await expect(page.getByTestId('listing-actions')).toBeVisible();
  await expect(page.getByTestId('contact-seller')).toHaveCount(0);
});
