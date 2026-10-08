import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deviceSchema, pushPath } from '../../src/notifications/model.js';
import { renderPush } from '../../src/notifications/push.js';

describe('push', () => {
  it('has short, discreet text in every language', () => {
    for (const locale of ['nb', 'en', 'so'] as const) {
      for (const kind of [
        'new_message',
        'listing_removed',
        'review_received',
        'listing_promoted',
        'favourite_price_drop',
        'favourite_sold',
        'saved_search_match',
      ] as const) {
        const copy = renderPush(kind, locale, {
          days: '7',
          count: '3',
          amountMinor: '80000',
          currency: 'NOK',
        });
        assert.ok(copy.title.length > 0 && copy.title.length <= 40, `${kind}/${locale} title`);
        assert.ok(copy.body.length > 0 && copy.body.length <= 120, `${kind}/${locale} body`);
        assert.ok(!copy.body.includes('{'), `${kind}/${locale}: placeholder left`);
      }
    }
    assert.match(renderPush('listing_promoted', 'nb', { days: '7' }).body, /7 dager/);
  });

  it('formats prices in the reader’s language and the listing’s currency (ADR-0040)', () => {
    const dollars = { amountMinor: '24000', currency: 'USD' };
    assert.match(renderPush('favourite_price_drop', 'en', dollars).body, /costs \$240\.$/);
    const kroner = { amountMinor: '80000', currency: 'NOK' };
    assert.match(renderPush('favourite_price_drop', 'nb', kroner).body, /koster nå 800\skr\.$/);
    // A notice stored before money had a currency.
    assert.match(renderPush('favourite_price_drop', 'en', { priceNok: '800' }).body, /NOK|kr/);
  });

  it('opens app paths only', () => {
    assert.equal(pushPath('new_message', 'c1', 'u1'), '/messages/c1');
    assert.equal(pushPath('listing_removed', 'l1', 'u1'), '/my-listings');
    assert.equal(pushPath('listing_promoted', 'l1', 'u1'), '/listings/l1');
    assert.equal(pushPath('review_received', 'r1', 'u1'), '/users/u1');
    assert.equal(pushPath('favourite_price_drop', 'l1', 'u1'), '/listings/l1');
    assert.equal(pushPath('saved_search_match', 's1', 'u1'), '/saved-searches/s1');
  });

  it('accepts Expo push tokens only', () => {
    assert.ok(deviceSchema.safeParse({ token: 'ExponentPushToken[xyz]', platform: 'ios' }).success);
    assert.ok(deviceSchema.safeParse({ token: 'ExpoPushToken[xyz]', platform: 'android' }).success);
    for (const token of ['', 'fcm-token', 'ExponentPushToken[]', 'ExponentPushToken[a]b'])
      assert.ok(!deviceSchema.safeParse({ token, platform: 'ios' }).success, token);
    assert.ok(!deviceSchema.safeParse({ token: 'ExponentPushToken[x]', platform: 'web' }).success);
  });
});
