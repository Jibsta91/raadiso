import { expect, test } from '@playwright/test';
import { adminBase, adminLogin, domain, login } from './support.js';

test('owner is notified in the app when a moderator removes their listing', async ({ browser }) => {
  // The owner creates a listing (through the API, with the browser session).
  const owner = await browser.newPage();
  await login(owner, `amina.hassan@${domain}`);
  const title = `Fjernes av moderator ${Date.now().toString(36)}`;
  const origin = new URL(owner.url()).origin;
  const created = await owner.request.post('/api/v1/listings', {
    headers: { origin },
    data: {
      category: 'torget',
      subcategory: 'hobby',
      title,
      description: 'Laget av e2e-testen for varsler.',
      priceNok: 100,
      attributes: { condition: 'good' },
      placeId: 'oslo',
      imageIds: [],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  // A moderator removes it in the admin console, with a reason (staff act only there, ADR-0030).
  const moderator = await browser.newPage();
  await adminLogin(moderator, `moderator@${domain}`);
  await moderator.goto(`${adminBase}/en/admin/listings/${id}`);
  await moderator.getByTestId('listing-remove').click();
  await moderator
    .getByTestId('listing-remove-dialog')
    .getByText('Fraud or scam', { exact: true })
    .click();
  await moderator.getByTestId('listing-remove-submit').click();
  await expect(moderator.getByTestId('toast').first()).toContainText('Listing removed');

  // The owner gets an in-app notification (via the event pipeline).
  await expect(async () => {
    await owner.goto('/en/notifications');
    await expect(owner.getByTestId('notification-item').filter({ hasText: title })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 90_000 });
  await expect(owner.getByTestId('nav-alerts')).toBeVisible();
  await owner.getByTestId('notification-item').filter({ hasText: title }).click();
  await expect(owner).toHaveURL(/\/en\/my\/listings$/);
  // The listing is still in their list, marked as removed, with the moderator's reason.
  const removed = owner.getByTestId('my-listings').getByRole('listitem').filter({ hasText: title });
  await expect(removed.getByTestId('my-listing-removed')).toHaveText('Removed by Raadiso');
  await expect(removed.getByTestId('my-listing-removal')).toContainText('fraud or a scam');

  // Message alert preferences save immediately.
  await owner.goto('/en/notifications');
  const toggle = owner.getByTestId('pref-email-messages');
  const before = await toggle.isChecked();
  await toggle.click();
  await expect(owner.getByTestId('pref-status')).toHaveText('Saved');
  await owner.reload();
  await expect(owner.getByTestId('pref-email-messages')).toBeChecked({ checked: !before });
  await owner.getByTestId('pref-email-messages').click(); // restore
  await expect(owner.getByTestId('pref-status')).toHaveText('Saved');

  // The app's push preference is saved the same way, independently of e-mail.
  const push = owner.getByTestId('pref-push-messages');
  const pushBefore = await push.isChecked();
  await push.click();
  await expect(owner.getByTestId('pref-status')).toHaveText('Saved');
  await owner.reload();
  await expect(owner.getByTestId('pref-push-messages')).toBeChecked({ checked: !pushBefore });
  await expect(owner.getByTestId('pref-email-messages')).toBeChecked({ checked: before });
  await owner.getByTestId('pref-push-messages').click(); // restore
  await expect(owner.getByTestId('pref-status')).toHaveText('Saved');

  await owner.close();
  await moderator.close();
});
