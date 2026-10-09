// The recently viewed list itself, without storage (pure, unit-tested in test/recent.test.ts).
import type { TileListing } from '../components/listing-card';

const MAX = 8;
// The native store is the keychain (storage.native.ts), which warns above 2 KB a value: entries are
// kept short and the oldest go first until the list fits.
const BUDGET = 1900;
const TITLE = 48;

export type Seen = Pick<TileListing, 'id' | 'title' | 'price' | 'category' | 'location'> & {
  image?: { card: string };
};

/** What is stored: short keys, as the list has to fit in about 2 KB. */
export interface Stored {
  i: string;
  t: string;
  p: Seen['price'];
  c: string;
  l: string;
  img?: string;
}

const pack = (s: Seen): Stored => ({
  i: s.id,
  t: s.title.length > TITLE ? `${s.title.slice(0, TITLE - 1)}…` : s.title,
  p: s.price,
  c: s.category,
  l: s.location.name,
  ...(s.image ? { img: s.image.card } : {}),
});

export const unpack = (s: Stored): Seen => ({
  id: s.i,
  title: s.t,
  price: s.p,
  category: s.c,
  location: { name: s.l },
  ...(s.img ? { image: { card: s.img } } : {}),
});

export function valid(x: unknown): x is Stored {
  const s = x as Stored | null;
  return !!s && typeof s.i === 'string' && typeof s.t === 'string' && typeof s.l === 'string';
}

/** Puts a listing first; the list keeps at most MAX entries and fits the store's budget. */
export function addRecent(list: readonly Stored[], seen: Seen): Stored[] {
  const next = [pack(seen), ...list.filter((x) => x.i !== seen.id)].slice(0, MAX);
  while (next.length > 1 && JSON.stringify(next).length > BUDGET) next.pop();
  return next;
}
