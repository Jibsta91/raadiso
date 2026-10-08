import { noticePrices } from '@raadi/catalog/money';
import { z } from 'zod';
import type { Locale, PushKind } from './model.js';

export interface PushCopy {
  title: string;
  body: string;
}

/**
 * Lock-screen text. Shorter than the e-mails and just as discreet: no message
 * text, no listing titles, no names (anyone holding the phone can read it).
 */
const COPY: Record<PushKind, Record<Locale, PushCopy>> = {
  new_message: {
    nb: { title: 'Ny melding', body: 'Du har fått en ny melding om en annonse.' },
    en: { title: 'New message', body: 'Someone sent you a message about a listing.' },
    so: { title: 'Fariin cusub', body: 'Qof ayaa kuu soo diray fariin ku saabsan xayeysiis.' },
  },
  listing_removed: {
    nb: { title: 'Annonse fjernet', body: 'En av annonsene dine er fjernet av moderatorene.' },
    en: { title: 'Listing removed', body: 'One of your listings was removed by the moderators.' },
    so: {
      title: 'Xayeysiis la saaray',
      body: 'Mid ka mid ah xayeysiisyadaada waxaa saaray maamulayaasha.',
    },
  },
  review_received: {
    nb: { title: 'Ny omtale', body: 'Noen har gitt deg en omtale etter en handel.' },
    en: { title: 'New review', body: 'Someone reviewed you after a deal.' },
    so: { title: 'Faallo cusub', body: 'Qof ayaa kaa faallooday ka dib iib.' },
  },
  favourite_price_drop: {
    nb: { title: 'Lavere pris', body: 'En av favorittene dine koster nå {price}.' },
    en: { title: 'Price drop', body: 'One of your favourites now costs {price}.' },
    so: {
      title: 'Qiimo dhimis',
      body: 'Mid ka mid ah waxyaabaha aad jeceshahay hadda waa {price}.',
    },
  },
  favourite_sold: {
    nb: { title: 'Favoritt solgt', body: 'En av favorittene dine er solgt.' },
    en: { title: 'Favourite sold', body: 'One of your favourites has been sold.' },
    so: {
      title: 'Waa la iibiyay',
      body: 'Mid ka mid ah waxyaabaha aad jeceshahay waa la iibiyay.',
    },
  },
  saved_search_match: {
    nb: { title: 'Nye treff', body: '{count} nye annonser passer et lagret søk.' },
    en: { title: 'New matches', body: '{count} new listings match a saved search.' },
    so: {
      title: 'Natiijooyin cusub',
      body: '{count} xayeysiis oo cusub ayaa ku habboon raadin la keydiyay.',
    },
  },
  listing_promoted: {
    nb: { title: 'Annonsen er fremhevet', body: 'Annonsen din er fremhevet i {days} dager.' },
    en: { title: 'Listing promoted', body: 'Your listing is promoted for {days} days.' },
    so: {
      title: 'Xayeysiiska waa la horumariyay',
      body: 'Xayeysiiskaaga waa la horumariyay {days} maalmood.',
    },
  },
};

export function renderPush(
  kind: PushKind,
  locale: Locale,
  params: Record<string, string>,
): PushCopy {
  const copy = COPY[kind][locale];
  const values = { ...params, ...noticePrices(params, locale) };
  return {
    title: copy.title,
    body: copy.body.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? ''),
  };
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  sound: 'default';
  /** The app's notification category: "message" lets iOS offer Reply on the notification itself. */
  categoryId?: string;
}

const ticketSchema = z.union([
  z.object({ status: z.literal('ok'), id: z.string() }),
  z.object({
    status: z.literal('error'),
    message: z.string(),
    details: z.object({ error: z.string().optional() }).loose().optional(),
  }),
]);
const responseSchema = z.object({ data: z.array(ticketSchema) });

export interface PushResult {
  sent: number;
  /** Tokens of uninstalled apps: forget them. */
  unregistered: string[];
  /** Other per-message errors (logged; the push counts as sent to the rest). */
  errors: string[];
}

/**
 * Client for Expo's push API (https://exp.host/--/api/v2/push/send in
 * production, push-mock in development). Transport errors and non-2xx answers
 * throw, so the queue retries the push later.
 */
export class PushClient {
  constructor(private readonly opts: { url: string; accessToken?: string; timeoutMs?: number }) {}

  async send(messages: PushMessage[]): Promise<PushResult> {
    const res = await fetch(this.opts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.opts.accessToken ? { authorization: `Bearer ${this.opts.accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw new Error(`push service returned ${res.status}`);
    const { data } = responseSchema.parse(await res.json());
    const result: PushResult = { sent: 0, unregistered: [], errors: [] };
    data.forEach((ticket, i) => {
      if (ticket.status === 'ok') result.sent++;
      else if (ticket.details?.error === 'DeviceNotRegistered')
        result.unregistered.push(messages[i]!.to);
      else result.errors.push(ticket.details?.error ?? ticket.message);
    });
    return result;
  }
}
