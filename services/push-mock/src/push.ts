import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * The subset of Expo's push API (POST /--/api/v2/push/send) that Raadi uses.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */
const TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;

export const messageSchema = z.object({
  to: z.union([z.string(), z.array(z.string()).min(1).max(100)]),
  title: z.string().max(200).optional(),
  body: z.string().max(2000).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  sound: z.union([z.literal('default'), z.null()]).optional(),
  badge: z.number().int().min(0).optional(),
  channelId: z.string().max(100).optional(),
  categoryId: z.string().max(100).optional(),
  ttl: z.number().int().min(0).optional(),
  priority: z.enum(['default', 'normal', 'high']).optional(),
});

export const requestSchema = z.union([messageSchema, z.array(messageSchema).min(1).max(100)]);

export type Ticket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details: { error: string; expoPushToken?: string } };

export interface Delivered {
  id: string;
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  categoryId?: string;
  receivedAt: string;
}

/**
 * In-memory inbox. Tokens that contain "Unregistered" behave like an
 * uninstalled app (DeviceNotRegistered), so callers can test token cleanup.
 */
export class PushInbox {
  private readonly items: Delivered[] = [];

  constructor(private readonly capacity = 500) {}

  send(body: unknown): { data: Ticket[] } | { errors: Array<{ code: string; message: string }> } {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return { errors: [{ code: 'VALIDATION_ERROR', message: parsed.error.issues[0]!.message }] };
    }
    const messages = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const expanded = messages.flatMap((m) =>
      (Array.isArray(m.to) ? m.to : [m.to]).map((to) => ({ ...m, to })),
    );
    if (expanded.length > 100) {
      return {
        errors: [{ code: 'PUSH_TOO_MANY_NOTIFICATIONS', message: 'At most 100 per request' }],
      };
    }
    return {
      data: expanded.map((m): Ticket => {
        if (!TOKEN.test(m.to)) {
          return {
            status: 'error',
            message: `"${m.to}" is not a valid Expo push token`,
            details: { error: 'DeviceNotRegistered', expoPushToken: m.to },
          };
        }
        if (m.to.includes('Unregistered')) {
          return {
            status: 'error',
            message: `"${m.to}" is not a registered push notification recipient`,
            details: { error: 'DeviceNotRegistered', expoPushToken: m.to },
          };
        }
        const id = randomUUID();
        this.items.push({
          id,
          to: m.to,
          title: m.title,
          body: m.body,
          data: m.data,
          categoryId: m.categoryId,
          receivedAt: new Date().toISOString(),
        });
        if (this.items.length > this.capacity) this.items.shift();
        return { status: 'ok', id };
      }),
    };
  }

  list(to?: string): Delivered[] {
    return this.items.filter((d) => !to || d.to === to).reverse();
  }

  clear(): void {
    this.items.length = 0;
  }
}
