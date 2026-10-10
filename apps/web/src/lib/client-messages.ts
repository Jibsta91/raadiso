/**
 * Which messages reach the browser. Server components translate on the server and send no message
 * catalogue; client components need theirs in the page. The layout provides GLOBAL (what the frame's
 * client components and the error boundary use), and a page adds its own set with <ClientMessages>.
 * test/client-messages.test.ts checks that every client component a page renders finds its keys here.
 */
export const GLOBAL = ['errors', 'theme'] as const;

const TAXONOMY_NAMES = ['taxonomy.categories', 'taxonomy.subcategories'] as const;
const SEARCH = ['search', 'favourites', ...TAXONOMY_NAMES] as const;

export const CLIENT_MESSAGES = {
  home: [...SEARCH, 'home.recentTitle', 'home.recentClear'],
  category: SEARCH,
  search: [...SEARCH, 'savedSearches'],
  listing: ['listing', 'favourites', 'messages', 'report', 'home.recentTitle', 'home.recentClear'],
  listingForm: ['form', 'price', 'listing', 'taxonomy', 'home.categories'],
  promote: ['payments'],
  payment: ['payments'],
  thread: ['messages', 'trust'],
  favourites: ['favourites'],
  myListings: ['my'],
  savedSearches: ['savedSearches'],
  notifications: ['notifications'],
  security: ['security'],
  trust: ['trust'],
  admin: ['admin', 'report'],
} as const satisfies Record<string, readonly string[]>;

export type ClientMessageSet = keyof typeof CLIENT_MESSAGES;

type Tree = { [key: string]: string | Tree };

/** The parts of a catalogue at the given dotted paths ('search', 'taxonomy.categories'). */
export function pickMessages(messages: Tree, paths: readonly string[]): Tree {
  const out: Tree = {};
  for (const path of paths) {
    const parts = path.split('.');
    let from: Tree | string | undefined = messages;
    for (const part of parts) from = typeof from === 'object' ? from[part] : undefined;
    if (from === undefined) continue;
    let into = out;
    for (const part of parts.slice(0, -1)) {
      const next = into[part];
      into = (typeof next === 'object' ? next : (into[part] = {})) as Tree;
    }
    into[parts.at(-1)!] = from;
  }
  return out;
}
