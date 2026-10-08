// The event-to-e-mail pipeline against the platform's PostgreSQL image, with a
// fake mail transport and user directory. Run: ./raadi test-integration
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { buildEvent } from '@raadi/events';
import type { ReceivedEvent } from '@raadi/service-kit/kafka';
import type { Transporter } from 'nodemailer';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { AppConfig } from '../../src/config.js';
import type { UserDirectory } from '../../src/notifications/directory.js';
import { NotificationsRepository } from '../../src/notifications/notifications.repository.js';
import { NotificationsService } from '../../src/notifications/notifications.service.js';
import type { PushClient, PushMessage } from '../../src/notifications/push.js';

let container: StartedTestContainer;
let pool: pg.Pool;
let repo: NotificationsRepository;
let service: NotificationsService;
const sent: Array<{ to: string; subject: string; text: string }> = [];
let failSends = 0;

const directory = {
  recipient: async (userId: string) =>
    userId === GONE ? null : { email: `${userId}@example.test`, locale: 'nb' as const },
  locale: async (userId: string) => (userId === GONE ? null : ('nb' as const)),
} as unknown as UserDirectory;
const pushed: PushMessage[] = [];
let failPushes = 0;
/** Like Expo: tokens with "Unregistered" belong to uninstalled apps. */
const pusher = {
  send: async (messages: PushMessage[]) => {
    if (failPushes > 0) {
      failPushes--;
      throw new Error('push service returned 503');
    }
    const ok = messages.filter((m) => !m.to.includes('Unregistered'));
    pushed.push(...ok);
    return {
      sent: ok.length,
      unregistered: messages.filter((m) => m.to.includes('Unregistered')).map((m) => m.to),
      errors: [],
    };
  },
} as unknown as PushClient;
const mailer = {
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    if (failSends > 0) {
      failSends--;
      throw new Error('SMTP down');
    }
    sent.push(m);
    return {};
  },
} as unknown as Transporter;
const GONE = randomUUID();

before(async () => {
  const image = await GenericContainer.fromDockerfile(
    new URL('../../../../../deploy/postgres', import.meta.url).pathname,
  ).build('raadi-postgres-test', { deleteOnExit: false });
  container = await image
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'notifications' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: 'postgres',
    password: 'test',
    database: 'notifications',
  });
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    await pool.query(sql.split('-- migrate:down')[0]!.replace('-- migrate:up', ''));
  }
  repo = new NotificationsRepository(pool);
  const cfg = {
    env: {
      PUBLIC_BASE_URL: 'http://raadi.localhost',
      SMTP_FROM: 'Raadi <no-reply@raadi.localhost>',
      EMAIL_THROTTLE_MINUTES: 30,
      EMAIL_MAX_ATTEMPTS: 2,
      PUSH_THROTTLE_SECONDS: 60,
      PUSH_MAX_ATTEMPTS: 2,
    },
  } as unknown as AppConfig;
  service = new NotificationsService(repo, directory, mailer, pusher, cfg);
});

after(async () => {
  await pool?.end();
  await container?.stop();
});

const received = (value: unknown): ReceivedEvent => ({
  topic: 't',
  partition: 0,
  offset: 0n,
  key: undefined,
  headers: {},
  value,
});
const messageSent = (recipientId: string, conversationId: string, body = 'secret text') => ({
  event: buildEvent('no.raadi.messaging.conversation.message_sent.v1', {
    source: 'urn:raadi:messaging',
    subject: conversationId,
    data: {
      conversationId,
      messageId: randomUUID(),
      listingId: randomUUID(),
      senderId: randomUUID(),
      recipientId,
      sentAt: new Date().toISOString(),
    },
  }),
  body,
});
const drain = async () => {
  while ((await service.sendDuePushes()) + (await service.sendDue()) > 0) {
    /* drain */
  }
};
const token = (name: string) => `ExponentPushToken[${name}-${randomUUID().slice(0, 8)}]`;

describe('notifications pipeline', () => {
  it('e-mails the recipient once per conversation per window, and once per event', async () => {
    const user = randomUUID();
    const conversation = randomUUID();
    const first = messageSent(user, conversation);
    await service.onEvent(received(first.event));
    await service.onEvent(received(first.event)); // redelivery
    await service.onEvent(received(messageSent(user, conversation).event)); // throttled
    await drain();
    const mine = sent.filter((m) => m.to === `${user}@example.test`);
    assert.equal(mine.length, 1);
    assert.match(mine[0]!.text, new RegExp(`/nb/messages/${conversation}`));
    assert.ok(!mine[0]!.text.includes('secret text'));
  });

  it('respects the opt-out for message e-mails', async () => {
    const user = randomUUID();
    await repo.savePreferences(user, { emailMessages: false });
    await service.onEvent(received(messageSent(user, randomUUID()).event));
    await drain();
    assert.equal(sent.filter((m) => m.to === `${user}@example.test`).length, 0);
  });

  it('notifies and e-mails owners when a moderator removes their listing, not when they delete it', async () => {
    const owner = randomUUID();
    const deleted = (reason: 'owner' | 'moderation') =>
      buildEvent('no.raadi.listings.listing.deleted.v1', {
        source: 'urn:raadi:listings',
        subject: randomUUID(),
        data: {
          listingId: randomUUID(),
          version: 2,
          imageIds: [],
          ownerId: owner,
          title: 'Sykkel',
          reason,
        },
      });
    await service.onEvent(received(deleted('owner')));
    await service.onEvent(received(deleted('moderation')));
    await drain();
    const list = await repo.list(owner, 10);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.kind, 'listing_removed');
    assert.equal(await repo.unread(owner), 1);
    const mail = sent.filter((m) => m.to === `${owner}@example.test`);
    assert.equal(mail.length, 1);
    assert.match(mail[0]!.text, /Sykkel/);
    await repo.markAllRead(owner);
    assert.equal(await repo.unread(owner), 0);
  });

  it('retries failed sends with backoff, skips users without an address, then gives up', async () => {
    const user = randomUUID();
    failSends = 1;
    await service.onEvent(received(messageSent(user, randomUUID()).event));
    await drain();
    let row = (await pool.query('SELECT * FROM emails WHERE user_id = $1', [user])).rows[0];
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 1);
    await pool.query('UPDATE emails SET next_attempt_at = now() WHERE id = $1', [row.id]);
    await drain();
    row = (await pool.query('SELECT * FROM emails WHERE id = $1', [row.id])).rows[0];
    assert.equal(row.status, 'sent');

    await service.onEvent(received(messageSent(GONE, randomUUID()).event));
    await drain();
    const gone = (await pool.query('SELECT status FROM emails WHERE user_id = $1', [GONE])).rows[0];
    assert.equal(gone.status, 'skipped');

    const unlucky = randomUUID();
    failSends = 10;
    await service.onEvent(received(messageSent(unlucky, randomUUID()).event));
    for (let i = 0; i < 2; i++) {
      await pool.query('UPDATE emails SET next_attempt_at = now() WHERE user_id = $1', [unlucky]);
      await drain();
    }
    failSends = 0;
    const failed = (await pool.query('SELECT status FROM emails WHERE user_id = $1', [unlucky]))
      .rows[0];
    assert.equal(failed.status, 'failed');
  });

  it('tells people in the app when they are reviewed, without e-mail', async () => {
    const subject = randomUUID();
    const event = buildEvent('no.raadi.trust.review.published.v1', {
      source: 'urn:raadi:trust',
      subject: randomUUID(),
      data: {
        reviewId: randomUUID(),
        listingId: randomUUID(),
        reviewerId: randomUUID(),
        subjectId: subject,
        subjectRole: 'seller',
        rating: 4,
        publishedAt: new Date().toISOString(),
      },
    });
    await service.onEvent(received(event));
    await service.onEvent(received(event));
    const list = await repo.list(subject, 10);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.kind, 'review_received');
    assert.deepEqual(list[0]!.params, { rating: '4' });
    const queued = await pool.query('SELECT 1 FROM emails WHERE user_id = $1', [subject]);
    assert.equal(queued.rowCount, 0);
  });

  it('pushes new messages to every device of the recipient, without the message text', async () => {
    const user = randomUUID();
    const conversation = randomUUID();
    const phone = token('phone');
    const tablet = token('tablet');
    await repo.registerDevice(user, { token: phone, platform: 'ios' });
    await repo.registerDevice(user, { token: tablet, platform: 'android' });
    const first = messageSent(user, conversation);
    await service.onEvent(received(first.event));
    await service.onEvent(received(first.event)); // redelivery
    await service.onEvent(received(messageSent(user, conversation).event)); // throttled
    await drain();
    const mine = pushed.filter((m) => m.to === phone || m.to === tablet);
    assert.equal(mine.length, 2);
    for (const m of mine) {
      assert.equal(m.title, 'Ny melding');
      assert.deepEqual(m.data, { url: `/messages/${conversation}` });
      assert.ok(!JSON.stringify(m).includes('secret text'));
    }
  });

  it('queues no push without a device, and none after opting out', async () => {
    const lonely = randomUUID();
    await service.onEvent(received(messageSent(lonely, randomUUID()).event));
    const queued = await pool.query('SELECT 1 FROM pushes WHERE user_id = $1', [lonely]);
    assert.equal(queued.rowCount, 0);

    const quiet = randomUUID();
    const device = token('quiet');
    await repo.registerDevice(quiet, { token: device, platform: 'ios' });
    await repo.savePreferences(quiet, { emailMessages: true, pushMessages: false });
    // An older client saving only emailMessages keeps the push opt-out.
    await repo.savePreferences(quiet, { emailMessages: true });
    assert.deepEqual(await repo.preferences(quiet), { emailMessages: true, pushMessages: false });
    await service.onEvent(received(messageSent(quiet, randomUUID()).event));
    await drain();
    assert.equal(pushed.filter((m) => m.to === device).length, 0);
  });

  it('forgets uninstalled apps, moves a token to the next user, and retries outages', async () => {
    const user = randomUUID();
    const gone = token('Unregistered');
    const live = token('live');
    await repo.registerDevice(user, { token: gone, platform: 'android' });
    await repo.registerDevice(user, { token: live, platform: 'ios' });
    failPushes = 1;
    await service.onEvent(received(messageSent(user, randomUUID()).event));
    await drain();
    let row = (await pool.query('SELECT * FROM pushes WHERE user_id = $1', [user])).rows[0];
    assert.equal(row.status, 'pending');
    await pool.query('UPDATE pushes SET next_attempt_at = now() WHERE id = $1', [row.id]);
    await drain();
    row = (await pool.query('SELECT * FROM pushes WHERE id = $1', [row.id])).rows[0];
    assert.equal(row.status, 'sent');
    assert.deepEqual(await repo.deviceTokens(user), [live]);

    // Someone else signs in on the same phone: the token follows them.
    const next = randomUUID();
    await repo.registerDevice(next, { token: live, platform: 'ios' });
    assert.deepEqual(await repo.deviceTokens(user), []);
    assert.equal(await repo.removeDevice(user, live), false);
    assert.equal(await repo.removeDevice(next, live), true);
  });

  it('pushes service notices that also appear in the app', async () => {
    const owner = randomUUID();
    const device = token('owner');
    await repo.registerDevice(owner, { token: device, platform: 'ios' });
    await service.onEvent(
      received(
        buildEvent('no.raadi.listings.listing.deleted.v1', {
          source: 'urn:raadi:listings',
          subject: randomUUID(),
          data: {
            listingId: randomUUID(),
            version: 2,
            imageIds: [],
            ownerId: owner,
            title: 'Hemmelig sykkel',
            reason: 'moderation',
          },
        }),
      ),
    );
    await drain();
    const [push] = pushed.filter((m) => m.to === device);
    assert.equal(push?.title, 'Annonse fjernet');
    assert.deepEqual(push?.data, { url: '/my-listings' });
    assert.ok(!JSON.stringify(push).includes('Hemmelig'), 'no listing title on the lock screen');
  });

  it('turns saved alerts into notices, pushes and a daily e-mail per saved search', async () => {
    const user = randomUUID();
    const device = token('saved');
    await repo.registerDevice(user, { token: device, platform: 'ios' });
    const search = randomUUID();
    const listing = randomUUID();
    const alert = (data: Record<string, unknown>) =>
      buildEvent('no.raadi.saved.alert.v1', {
        source: 'urn:raadi:saved',
        subject: user,
        data: { alertId: randomUUID(), userId: user, ...data } as never,
      });
    await service.onEvent(
      received(alert({ kind: 'search_match', savedSearchId: search, count: 2 })),
    );
    await service.onEvent(
      received(alert({ kind: 'search_match', savedSearchId: search, count: 3 })),
    );
    await service.onEvent(
      received(
        alert({
          kind: 'price_drop',
          listingId: listing,
          price: { amountMinor: 24000, currency: 'USD' },
          previousPrice: { amountMinor: 30000, currency: 'USD' },
        }),
      ),
    );
    await drain();

    const list = await repo.list(user, 10);
    const match = list.find((n) => n.kind === 'saved_search_match');
    assert.equal(match?.params.count, '5', 'one growing notice per saved search');
    assert.deepEqual(list.find((n) => n.kind === 'favourite_price_drop')?.params, {
      amountMinor: '24000',
      currency: 'USD',
      previousAmountMinor: '30000',
    });
    const mine = pushed.filter((m) => m.to === device);
    assert.deepEqual(
      mine.map((m) => m.data.url).sort(),
      [`/listings/${listing}`, `/saved-searches/${search}`],
      'the second match within the hour is not pushed again',
    );
    const mail = sent.filter((m) => m.to === `${user}@example.test`);
    assert.equal(mail.length, 1);
    assert.match(mail[0]!.text, new RegExp(`/nb/my/saved-searches\\?open=${search}`));
  });

  it('writes in the language the user chose on the website or in the app', async () => {
    const user = randomUUID();
    const device = token('locale');
    await repo.registerDevice(user, { token: device, platform: 'ios' });
    const changed = buildEvent('no.raadi.identity.user.preferences_changed.v1', {
      source: 'urn:raadi:identity',
      subject: user,
      data: { userId: user, changed: ['locale'], locale: 'en' },
    });
    await service.onEvent(received(changed));
    await service.onEvent(received(messageSent(user, randomUUID()).event));
    await drain();
    assert.equal(pushed.find((m) => m.to === device)?.title, 'New message');
    const mail = sent.find((m) => m.to === `${user}@example.test`);
    assert.equal(mail?.subject, 'You have a new message on Raadiso');
    assert.match(mail!.text, /\/en\/messages\//);
  });
});
