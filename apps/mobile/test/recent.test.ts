import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addRecent, unpack, type Seen } from '../src/lib/recent-list.ts';

const listing = (n: number, title = `Listing ${n}`): Seen => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title,
  price: { amountMinor: n * 10_000, currency: 'NOK' },
  category: 'torget',
  location: { name: 'Oslo' },
  image: { card: `/media/images/${n}/card.webp` },
});

describe('addRecent', () => {
  it('puts the newest first and keeps each listing once', () => {
    let list = addRecent([], listing(1));
    list = addRecent(list, listing(2));
    list = addRecent(list, listing(1));
    assert.deepEqual(
      list.map((x) => unpack(x).id),
      [listing(1).id, listing(2).id],
    );
  });
  it('keeps at most eight', () => {
    let list = addRecent([], listing(0));
    for (let n = 1; n < 20; n++) list = addRecent(list, listing(n));
    assert.equal(list.length, 8);
    assert.equal(unpack(list[0]!).id, listing(19).id);
  });
  it('stays under the keychain limit of about 2 KB, cutting long titles', () => {
    let list = addRecent([], listing(0));
    for (let n = 1; n < 20; n++) list = addRecent(list, listing(n, 'x'.repeat(300)));
    assert.ok(JSON.stringify(list).length <= 1900);
    assert.ok(unpack(list[0]!).title.length <= 48);
  });
  it('round-trips what a card needs', () => {
    const [stored] = addRecent([], listing(3));
    assert.deepEqual(unpack(stored!), listing(3));
  });
});
