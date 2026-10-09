import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dropPercent, formatAge, formatPrice, pickLocale } from '../src/lib/format.ts';

describe('formatPrice', () => {
  it('formats kroner with a Norwegian thousands separator, dollars the English way', () => {
    const kroner = { amountMinor: 1_250_000, currency: 'NOK' };
    assert.match(formatPrice(kroner, 'nb', 'Pris på forespørsel'), /^12\s500\skr$/);
    assert.equal(formatPrice({ amountMinor: 125_050, currency: 'USD' }, 'en', ''), '$1,250.50');
  });
  it('uses the caller label when there is no price', () => {
    assert.equal(formatPrice(null, 'en', 'Price on request'), 'Price on request');
  });
  it('keeps zero as a price', () => {
    assert.match(formatPrice({ amountMinor: 0, currency: 'NOK' }, 'nb', 'n/a'), /^0\skr$/);
  });
});

describe('formatAge', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('says minutes for recent times', () => {
    assert.match(formatAge('2026-10-02T11:55:00Z', 'en', now), /5 min/);
  });
  it('says days within a week', () => {
    assert.match(formatAge('2026-09-30T12:00:00Z', 'en', now), /2 days ago|2 days/);
  });
  it('falls back to a date after a week', () => {
    assert.match(formatAge('2026-08-01T12:00:00Z', 'en', now), /2026/);
  });
});

describe('formatAge without Intl.RelativeTimeFormat (Hermes on iOS and Android)', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  const intl = Intl as { RelativeTimeFormat?: unknown };
  const saved = intl.RelativeTimeFormat;
  const withoutRtf = (run: () => void) => {
    intl.RelativeTimeFormat = undefined;
    try {
      run();
    } finally {
      intl.RelativeTimeFormat = saved;
    }
  };
  it('falls back to its own short wording in every language', () => {
    withoutRtf(() => {
      assert.equal(formatAge('2026-10-02T11:59:50Z', 'en', now), 'now');
      assert.equal(formatAge('2026-10-02T11:55:00Z', 'en', now), '5 min ago');
      assert.equal(formatAge('2026-10-02T09:00:00Z', 'nb', now), 'for 3 t siden');
      assert.equal(formatAge('2026-09-30T12:00:00Z', 'so', now), '2 maalmood ka hor');
      assert.match(formatAge('2026-08-01T12:00:00Z', 'en', now), /2026/);
    });
  });
});

describe('pickLocale', () => {
  it('maps Norwegian variants to nb', () => {
    assert.equal(pickLocale(['nn-NO']), 'nb');
    assert.equal(pickLocale(['no']), 'nb');
  });
  it('takes the first supported language', () => {
    assert.equal(pickLocale(['de-DE', 'so-SO', 'en-US']), 'so');
  });
  it('defaults to nb', () => {
    assert.equal(pickLocale(['fr-FR']), 'nb');
    assert.equal(pickLocale([]), 'nb');
  });
  it("keeps to the country's languages, its default first (Somaliland: English, then Somali)", () => {
    assert.equal(pickLocale(['nb-NO'], ['en', 'so']), 'en');
    assert.equal(pickLocale(['so-SO', 'en-US'], ['en', 'so']), 'so');
    assert.equal(pickLocale(['fr-FR'], ['en', 'so']), 'en');
  });
});

describe('dropPercent', () => {
  const nok = (amountMinor: number) => ({ amountMinor, currency: 'NOK' });
  it('says how much a drop took off, rounded', () => {
    assert.equal(dropPercent({ price: nok(8_000), priceDrop: { previous: nok(10_000) } }), 20);
  });
  it('stays quiet below 5% and without a drop or a price', () => {
    assert.equal(
      dropPercent({ price: nok(9_700), priceDrop: { previous: nok(10_000) } }),
      undefined,
    );
    assert.equal(dropPercent({ price: nok(9_700) }), undefined);
    assert.equal(dropPercent({ price: null, priceDrop: { previous: nok(10_000) } }), undefined);
  });
});
