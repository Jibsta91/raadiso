import { expect, test } from '@playwright/test';
import { adminBase, adminLogin, domain, login, openAccountMenu } from './support.js';

test('a buyer reports a listing; a moderator removes it from the queue', async ({ browser }) => {
  // Amina's listing, made through the API with her browser session.
  const owner = await browser.newPage();
  await login(owner, `amina.hassan@${domain}`);
  const title = `Rapporteres e2e ${Date.now().toString(36)}`;
  const created = await owner.request.post('/api/v1/listings', {
    headers: { origin: new URL(owner.url()).origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title,
      description: 'Laget av e2e-testen for rapporter.',
      price: { amountMinor: 10000, currency: 'NOK' },
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await owner.close();

  const buyer = await browser.newPage();
  await login(buyer, `ola.nordmann@${domain}`);
  await buyer.goto(`/en/listings/${id}`);
  await buyer.getByTestId('report-open').click();
  await expect(buyer.getByTestId('report-send')).toBeDisabled();
  await buyer.getByTestId('report-reason-fraud').check();
  await buyer.getByTestId('report-comment').fill('Wants payment up front.');
  await buyer.getByTestId('report-send').click();
  await expect(buyer.getByTestId('report-sent')).toBeVisible();
  await buyer.close();

  // The moderator works the queue in the admin console (its own host and session).
  const moderator = await browser.newPage();
  await adminLogin(moderator, `moderator@${domain}`);
  await moderator.getByTestId('admin-nav-moderation').click();
  await expect(moderator).toHaveURL(new RegExp(`${adminBase}/en/admin/moderation$`));
  // The workbench: pick the listing, read why it was reported, remove it with a reason.
  await moderator.getByTestId('moderation-item').filter({ hasText: title }).click();
  const detail = moderator.getByTestId('moderation-detail');
  await expect(detail.getByRole('heading', { name: title })).toBeVisible();
  await expect(detail).toContainText('Fraud or a scam attempt');
  await expect(detail).toContainText('Wants payment up front.');
  await moderator.keyboard.press('x');
  const dialog = moderator.getByTestId('moderation-remove-dialog');
  await expect(dialog).toBeVisible();
  await expect(moderator.getByTestId('moderation-remove-submit')).toBeDisabled();
  await dialog.getByText('Fraud or scam', { exact: true }).click();
  await moderator.getByTestId('moderation-remove-submit').click();
  await expect(moderator.getByTestId('toast').first()).toContainText('Listing removed');
  await expect(moderator.getByTestId('moderation-item').filter({ hasText: title })).toHaveCount(0);
  await moderator.close();
});

test('people without a staff role get no admin link, and the website has no admin pages', async ({
  page,
}) => {
  await login(page, `kari.nordmann@${domain}`);
  await openAccountMenu(page);
  await expect(page.getByTestId('nav-admin')).toHaveCount(0);
  const res = await page.goto('/en/admin');
  expect(res?.status()).toBe(404);
});

test('blocking closes a conversation for both, and unblocking opens it again', async ({
  browser,
}) => {
  // Blocking is between two people, everywhere: use a pair no other spec messages with, so
  // specs running in parallel are not affected. The admin sells; the moderator writes.
  const seller = await browser.newPage();
  await login(seller, `admin@${domain}`);
  const title = `Blokkering e2e ${Date.now().toString(36)}`;
  const created = await seller.request.post('/api/v1/listings', {
    headers: { origin: new URL(seller.url()).origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title,
      description: 'Laget av e2e-testen for blokkering.',
      price: { amountMinor: 10000, currency: 'NOK' },
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const buyer = await browser.newPage();
  await login(buyer, `moderator@${domain}`);
  await buyer.goto(`/en/listings/${id}`);
  await buyer.getByTestId('contact-message').fill('Is it still available?');
  await buyer.getByTestId('contact-submit').click();
  await expect(buyer).toHaveURL(/\/en\/messages\/[0-9a-f-]{36}$/);
  const conversation = buyer.url();

  // The seller blocks the buyer from the conversation.
  await seller.goto('/en/messages');
  await seller.getByTestId('conversation-item').filter({ hasText: title }).click();
  seller.once('dialog', (dialog) => void dialog.accept());
  await seller.getByTestId('thread-block').click();
  await expect(seller.getByTestId('thread-closed')).toContainText('You blocked');
  await expect(seller.getByTestId('compose-input')).toHaveCount(0);

  // The buyer sees a closed conversation without being told who closed it.
  await buyer.goto(conversation);
  await expect(buyer.getByTestId('thread-closed')).toContainText('no longer send messages');
  await expect(buyer.getByTestId('thread-unblock')).toHaveCount(0);

  await seller.getByTestId('thread-unblock').click();
  await expect(seller.getByTestId('compose-input')).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByTestId('compose-input')).toBeVisible();
  await buyer.close();
  await seller.request.delete(`/api/v1/listings/${id}`, {
    headers: { origin: new URL(seller.url()).origin },
  });
  await seller.close();
});
