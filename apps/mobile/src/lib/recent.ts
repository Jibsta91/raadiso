// Recently viewed listings (ADR-0047 on the website, ADR-0048 in the app): kept on this device only,
// newest first, and never sent anywhere.
import { addRecent, type Seen, type Stored, unpack, valid } from './recent-list';
import { getPreference, setPreference } from './storage';

export type { Seen } from './recent-list';

const KEY = 'raadi.recentlyViewed';

async function read(): Promise<Stored[]> {
  try {
    const list = JSON.parse((await getPreference(KEY)) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return [];
  }
}

export async function readRecent(): Promise<Seen[]> {
  return (await read()).map(unpack);
}

export async function recordSeen(seen: Seen): Promise<void> {
  await setPreference(KEY, JSON.stringify(addRecent(await read(), seen)));
}

export async function clearRecent(): Promise<void> {
  await setPreference(KEY, '[]');
}
