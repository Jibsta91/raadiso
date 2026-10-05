import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { parseEvent } from '@raadi/events';
import type { Principal } from '@raadi/service-kit';
import { PermanentEventError, type ReceivedEvent } from '@raadi/service-kit/kafka';
import type { Transporter } from 'nodemailer';
import type { AppConfig } from '../config.js';
import { APP_CONFIG } from '../tokens.js';
import { UserDirectory } from './directory.js';
import {
  type Device,
  type EmailRow,
  type Preferences,
  type PushRow,
  pushPath,
  retryDelayMs,
  toNotification,
} from './model.js';
import { NotificationsRepository } from './notifications.repository.js';
import { type PushClient, renderPush } from './push.js';
import { renderEmail } from './templates.js';

export const MAILER = Symbol('MAILER');
export const PUSHER = Symbol('PUSHER');

const meter = metrics.getMeter('notifications');
const emails = meter.createCounter('raadi.notifications.emails', {
  description:
    'E-mails by kind and outcome (queued, throttled, opted_out, sent, skipped, retry, failed)',
});
const pushes = meter.createCounter('raadi.notifications.pushes', {
  description:
    'Pushes by kind and outcome (queued, throttled, opted_out, no_device, sent, skipped, retry, failed)',
});
const unregistered = meter.createCounter('raadi.notifications.devices_unregistered', {
  description: 'Push tokens forgotten because the push service reported the app as uninstalled',
});
const created = meter.createCounter('raadi.notifications.created', {
  description: 'In-app notifications created, by kind',
});

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly directory: UserDirectory,
    @Inject(MAILER) private readonly mailer: Transporter,
    @Inject(PUSHER) private readonly pusher: PushClient,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---------------------------------------------------------------- events

  /** Turns domain events into notifications and queued e-mails (exactly once per event). */
  async onEvent(event: ReceivedEvent): Promise<void> {
    let parsed;
    try {
      parsed = parseEvent(event.value);
    } catch (error) {
      throw new PermanentEventError('event violates its contract', { cause: error });
    }
    if (!parsed) return; // a newer event type this build does not know

    switch (parsed.type) {
      case 'no.raadi.messaging.conversation.message_sent.v1': {
        const { recipientId, conversationId } = parsed.data;
        await this.repo.once(parsed.id, async (tx) => {
          const prefs = await this.repo.preferences(recipientId, tx.client);
          if (prefs.pushMessages) {
            const outcome = await tx.queuePush({
              userId: recipientId,
              kind: 'new_message',
              refId: conversationId,
              throttleSeconds: this.cfg.env.PUSH_THROTTLE_SECONDS,
            });
            pushes.add(1, { kind: 'new_message', outcome });
          } else {
            pushes.add(1, { kind: 'new_message', outcome: 'opted_out' });
          }
          if (!prefs.emailMessages)
            return void emails.add(1, { kind: 'new_message', outcome: 'opted_out' });
          const queued = await tx.queueEmail({
            userId: recipientId,
            kind: 'new_message',
            refId: conversationId,
            throttleMinutes: this.cfg.env.EMAIL_THROTTLE_MINUTES,
          });
          emails.add(1, { kind: 'new_message', outcome: queued ? 'queued' : 'throttled' });
        });
        return;
      }
      case 'no.raadi.listings.listing.deleted.v1': {
        const { listingId, ownerId, title, reason } = parsed.data;
        // Owners who delete their own listing need no notice; older events lack the fields.
        if (reason !== 'moderation' || !ownerId) return;
        const params = { title: title ?? '' };
        await this.repo.once(parsed.id, async (tx) => {
          await tx.notify(ownerId, 'listing_removed', listingId, params);
          await tx.queueEmail({
            userId: ownerId,
            kind: 'listing_removed',
            refId: listingId,
            params,
          });
          // The push leaves the title out (lock screens): no params.
          const outcome = await tx.queuePush({
            userId: ownerId,
            kind: 'listing_removed',
            refId: listingId,
          });
          pushes.add(1, { kind: 'listing_removed', outcome });
        });
        created.add(1, { kind: 'listing_removed' });
        emails.add(1, { kind: 'listing_removed', outcome: 'queued' });
        return;
      }
      case 'no.raadi.trust.review.published.v1': {
        // In-app only: reviews are not urgent enough for an e-mail.
        const { reviewId, subjectId, rating } = parsed.data;
        await this.repo.once(parsed.id, async (tx) => {
          await tx.notify(subjectId, 'review_received', reviewId, { rating: String(rating) });
          const outcome = await tx.queuePush({
            userId: subjectId,
            kind: 'review_received',
            refId: reviewId,
          });
          pushes.add(1, { kind: 'review_received', outcome });
        });
        created.add(1, { kind: 'review_received' });
        return;
      }
      case 'no.raadi.payments.payment.captured.v1': {
        // A receipt (always sent: it is a legal document, not a marketing e-mail)
        // and an in-app notice that the listing is promoted.
        const { orderId, userId, listingId, product, amountOre, capturedAt } = parsed.data;
        const days = /(\d+)d$/.exec(product)?.[1] ?? '';
        const params = {
          orderId,
          days,
          amountOre: String(amountOre),
          capturedAt,
          merchant: this.cfg.env.RECEIPT_MERCHANT,
        };
        await this.repo.once(parsed.id, async (tx) => {
          await tx.notify(userId, 'listing_promoted', listingId, { days });
          await tx.queueEmail({ userId, kind: 'payment_receipt', refId: listingId, params });
          const outcome = await tx.queuePush({
            userId,
            kind: 'listing_promoted',
            refId: listingId,
            params: { days },
          });
          pushes.add(1, { kind: 'listing_promoted', outcome });
        });
        created.add(1, { kind: 'listing_promoted' });
        emails.add(1, { kind: 'payment_receipt', outcome: 'queued' });
        return;
      }
      case 'no.raadi.identity.user.registered.v1':
        await this.repo.once(parsed.id, (tx) =>
          tx.saveLocale(parsed.data.userId, parsed.data.locale),
        );
        return;
      case 'no.raadi.identity.user.preferences_changed.v1': {
        const { userId, locale } = parsed.data;
        if (locale) await this.repo.once(parsed.id, (tx) => tx.saveLocale(userId, locale));
        return;
      }
      case 'no.raadi.saved.alert.v1': {
        // Favourites and saved searches (ADR-0026): in the app, as a push, and (saved
        // searches only) at most one e-mail a day per search.
        const { userId, kind, listingId, savedSearchId, count, priceNok, previousPriceNok } =
          parsed.data;
        await this.repo.once(parsed.id, async (tx) => {
          if (kind === 'search_match' && savedSearchId && count) {
            await tx.notifyMatches(userId, savedSearchId, count);
            const push = await tx.queuePush({
              userId,
              kind: 'saved_search_match',
              refId: savedSearchId,
              params: { count: String(count) },
              throttleSeconds: 3600,
            });
            pushes.add(1, { kind: 'saved_search_match', outcome: push });
            const queued = await tx.queueEmail({
              userId,
              kind: 'saved_search_match',
              refId: savedSearchId,
              params: { count: String(count) },
              throttleMinutes: 24 * 60,
            });
            emails.add(1, { kind: 'saved_search_match', outcome: queued ? 'queued' : 'throttled' });
            created.add(1, { kind: 'saved_search_match' });
          } else if ((kind === 'price_drop' || kind === 'sold') && listingId) {
            const notice = kind === 'price_drop' ? 'favourite_price_drop' : 'favourite_sold';
            const params: Record<string, string> =
              kind === 'price_drop'
                ? {
                    priceNok: String(priceNok ?? ''),
                    previousPriceNok: String(previousPriceNok ?? ''),
                  }
                : {};
            await tx.notify(userId, notice, listingId, params);
            const push = await tx.queuePush({ userId, kind: notice, refId: listingId, params });
            pushes.add(1, { kind: notice, outcome: push });
            created.add(1, { kind: notice });
          }
        });
        return;
      }
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- e-mail

  /** Sends the due e-mails once; returns how many were handled. Called by the sender loop. */
  async sendDue(batch = 10): Promise<number> {
    const due = await this.repo.claimDue('emails', batch, 120_000);
    for (const email of due) await this.deliver(email);
    return due.length;
  }

  private async deliver(email: EmailRow): Promise<void> {
    try {
      const recipient = await this.directory.recipient(email.user_id);
      if (!recipient) {
        await this.repo.finish('emails', email.id, 'skipped', 'no deliverable address');
        return void emails.add(1, { kind: email.kind, outcome: 'skipped' });
      }
      // The language chosen on the website or in the app wins over Keycloak's.
      const locale = (await this.repo.locale(email.user_id)) ?? recipient.locale;
      const base = `${this.cfg.env.PUBLIC_BASE_URL}/${locale}`;
      const action =
        email.kind === 'new_message'
          ? `${base}/messages/${email.ref_id}`
          : email.kind === 'payment_receipt'
            ? `${base}/listings/${email.ref_id}`
            : email.kind === 'saved_search_match'
              ? `${base}/my/saved-searches?open=${email.ref_id}`
              : `${base}/my/listings`;
      const rendered = renderEmail(email.kind, locale, email.params, {
        action,
        settings: `${base}/notifications`,
      });
      await this.mailer.sendMail({
        from: this.cfg.env.SMTP_FROM,
        to: recipient.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        headers: { 'X-Raadi-Notification': email.kind },
      });
      await this.repo.finish('emails', email.id, 'sent');
      emails.add(1, { kind: email.kind, outcome: 'sent' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (email.attempts >= this.cfg.env.EMAIL_MAX_ATTEMPTS) {
        await this.repo.finish('emails', email.id, 'failed', message);
        emails.add(1, { kind: email.kind, outcome: 'failed' });
        this.logger.error({ err: error, emailId: email.id }, 'e-mail given up');
      } else {
        await this.repo.retryLater('emails', email.id, retryDelayMs(email.attempts), message);
        emails.add(1, { kind: email.kind, outcome: 'retry' });
        this.logger.warn(
          { err: error, emailId: email.id, attempts: email.attempts },
          'e-mail will be retried',
        );
      }
    }
  }

  // ---------------------------------------------------------------- push

  /** Sends the due pushes once; returns how many were handled. Called by the sender loop. */
  async sendDuePushes(batch = 20): Promise<number> {
    const due = await this.repo.claimDue('pushes', batch, 60_000);
    for (const push of due) await this.push(push);
    return due.length;
  }

  private async push(push: PushRow): Promise<void> {
    try {
      const tokens = await this.repo.deviceTokens(push.user_id);
      const known = tokens.length ? await this.directory.locale(push.user_id) : null;
      const locale = known && ((await this.repo.locale(push.user_id)) ?? known);
      if (!tokens.length || !locale) {
        await this.repo.finish(
          'pushes',
          push.id,
          'skipped',
          tokens.length ? 'user gone' : 'no device',
        );
        return void pushes.add(1, { kind: push.kind, outcome: 'skipped' });
      }
      const copy = renderPush(push.kind, locale, push.params);
      const url = pushPath(push.kind, push.ref_id, push.user_id);
      const result = await this.pusher.send(
        tokens.map((to) => ({
          to,
          ...copy,
          data: { url },
          sound: 'default' as const,
          // New messages can be answered from the notification (Reply with a text field).
          ...(push.kind === 'new_message' ? { categoryId: 'message' } : {}),
        })),
      );
      if (result.unregistered.length) {
        await this.repo.forgetTokens(result.unregistered);
        unregistered.add(result.unregistered.length);
      }
      if (result.errors.length) {
        this.logger.warn({ pushId: push.id, errors: result.errors }, 'some push messages failed');
      }
      const outcome = result.sent > 0 ? 'sent' : 'skipped';
      await this.repo.finish('pushes', push.id, outcome, result.errors[0]);
      pushes.add(1, { kind: push.kind, outcome });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (push.attempts >= this.cfg.env.PUSH_MAX_ATTEMPTS) {
        await this.repo.finish('pushes', push.id, 'failed', message);
        pushes.add(1, { kind: push.kind, outcome: 'failed' });
        this.logger.error({ err: error, pushId: push.id }, 'push given up');
      } else {
        await this.repo.retryLater('pushes', push.id, retryDelayMs(push.attempts), message);
        pushes.add(1, { kind: push.kind, outcome: 'retry' });
        this.logger.warn(
          { err: error, pushId: push.id, attempts: push.attempts },
          'push will be retried',
        );
      }
    }
  }

  // ---------------------------------------------------------------- API

  registerDevice(principal: Principal, device: Device): Promise<void> {
    return this.repo.registerDevice(principal.sub, device);
  }

  async removeDevice(principal: Principal, token: string): Promise<void> {
    if (!(await this.repo.removeDevice(principal.sub, token)))
      throw new NotFoundException('Device not found');
  }

  async list(principal: Principal, limit: number) {
    const [rows, unread] = await Promise.all([
      this.repo.list(principal.sub, limit),
      this.repo.unread(principal.sub),
    ]);
    return { unread, items: rows.map(toNotification) };
  }

  async unread(principal: Principal) {
    return { count: await this.repo.unread(principal.sub) };
  }

  async markRead(principal: Principal, id: string): Promise<void> {
    if (!(await this.repo.markRead(principal.sub, id)))
      throw new NotFoundException('Notification not found');
  }

  async markAllRead(principal: Principal): Promise<void> {
    await this.repo.markAllRead(principal.sub);
  }

  preferences(principal: Principal): Promise<Preferences> {
    return this.repo.preferences(principal.sub);
  }

  savePreferences(
    principal: Principal,
    prefs: { emailMessages: boolean; pushMessages?: boolean },
  ): Promise<Preferences> {
    return this.repo.savePreferences(principal.sub, prefs);
  }
}
