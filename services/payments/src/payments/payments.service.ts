import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { Principal } from '@raadi/service-kit';
import type { AppConfig } from '../config.js';
import { APP_CONFIG } from '../tokens.js';
import { ListingsClient } from './listings.client.js';
import {
  type CreateOrder,
  type OrderRow,
  PRODUCTS,
  type ProviderOutcome,
  toOrder,
  transition,
} from './model.js';
import { PaymentsRepository, type Source, type Tx } from './payments.repository.js';
import {
  type IncomingWebhook,
  PAYMENT_PROVIDER,
  type PaymentProvider,
  WebhookRejected,
} from './providers/provider.js';

const meter = metrics.getMeter('payments');
const transitions = meter.createCounter('raadi.payments.transitions', {
  description: 'Order state changes by target status and source (api, webhook, reconcile, admin)',
});
const webhooks = meter.createCounter('raadi.payments.webhooks', {
  description: 'Provider webhooks by outcome (applied, duplicate, ignored, rejected)',
});
const revenue = meter.createCounter('raadi.payments.captured_ore', {
  description: 'Captured amount in øre, by product',
});

/** Keycloak realm role of the people who may refund (see deploy/keycloak/realm-raadi.json). */
const ADMINS = ['platform-admin'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly listings: ListingsClient,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  products() {
    return {
      items: Object.entries(PRODUCTS).map(([id, p]) => ({
        id,
        days: p.days,
        amountOre: p.amountOre,
        currency: 'NOK',
      })),
      provider: this.provider.name,
    };
  }

  // ---------------------------------------------------------------- orders

  /**
   * Creates an order and the provider payment. A retry with the same
   * Idempotency-Key returns the same order (200); the same key with a
   * different request is a conflict.
   */
  async createOrder(principal: Principal, token: string, key: string, body: CreateOrder) {
    const requestHash = createHash('sha256')
      .update(JSON.stringify([body.listingId, body.product]))
      .digest('hex');
    const earlier = await this.repo.byKey(principal.sub, key);
    if (earlier)
      return { created: false, order: await this.view(this.sameRequest(earlier, requestHash)) };

    const listing = await this.listings.facts(body.listingId, token);
    if (listing.ownerId !== principal.sub)
      throw new ForbiddenException('Only the seller can promote a listing');
    if (listing.status !== 'active')
      throw new ConflictException('Only active listings can be promoted');

    const { row, created } = await this.repo.insertOrder({
      userId: principal.sub,
      listingId: body.listingId,
      product: body.product,
      provider: this.provider.name,
      idempotencyKey: key,
      requestHash,
    });
    if (!created)
      return { created: false, order: await this.view(this.sameRequest(row, requestHash)) };

    const days = PRODUCTS[body.product].days;
    try {
      const payment = await this.provider.create({
        reference: row.id,
        amountOre: row.amount_ore,
        description: truncate(`Raadi: ${days} days promoted – ${listing.title}`, 100),
        returnUrl: `${this.cfg.env.PUBLIC_BASE_URL}/${body.locale}/payments/${row.id}`,
        // Stable per order: a retried create never makes a second payment.
        idempotencyKey: `create-${row.id}`,
      });
      const saved = await this.repo.setProvider(row.id, payment.providerRef, payment.redirectUrl);
      return { created: true, order: toOrder(saved) };
    } catch (error) {
      this.logger.warn({ err: error, orderId: row.id }, 'provider refused or unavailable');
      await this.repo.locked(row.id, (tx, r) => tx.setStatus(r, 'failed', 'api'));
      transitions.add(1, { to: 'failed', source: 'api' });
      throw new ServiceUnavailableException(
        'The payment provider is unavailable; please try again.',
      );
    }
  }

  /** The order, refreshed from the provider when it has been waiting a while. */
  async getOrder(principal: Principal, id: string) {
    let row = await this.repo.get(id);
    const admin = principal.roles.some((r) => ADMINS.includes(r));
    if (!row || (row.user_id !== principal.sub && !admin))
      throw new NotFoundException('Order not found');
    if (
      ['created', 'authorized'].includes(row.status) &&
      Date.now() - row.updated_at.getTime() > 2_000
    ) {
      await this.sync(row, 'reconcile').catch((err: unknown) =>
        this.logger.warn({ err, orderId: id }, 'status refresh failed'),
      );
      row = (await this.repo.get(id))!;
    }
    return this.view(row);
  }

  async listMine(principal: Principal, limit: number) {
    const rows = await this.repo.listForUser(principal.sub, limit);
    return { items: rows.map((r) => toOrder(r)) };
  }

  // ---------------------------------------------------------------- webhooks

  async webhook(providerName: string, req: IncomingWebhook): Promise<void> {
    if (providerName !== this.provider.name) throw new NotFoundException('Unknown provider');
    let event;
    try {
      event = this.provider.verifyWebhook(req);
    } catch (error) {
      if (error instanceof WebhookRejected) {
        webhooks.add(1, { outcome: 'rejected' });
        this.logger.warn({ reason: error.message }, 'webhook rejected');
        throw new UnauthorizedException('Invalid webhook signature');
      }
      throw error;
    }
    if (!event) return void webhooks.add(1, { outcome: 'ignored' });
    if (!isUuid(event.reference)) return void webhooks.add(1, { outcome: 'ignored' });
    const result = await this.repo.locked(
      event.reference,
      (tx, row) => this.apply(tx, row, event.outcome, 'webhook'),
      { provider: this.provider.name, eventId: event.eventId },
    );
    webhooks.add(1, { outcome: result ? 'applied' : 'duplicate' });
    if (result?.status === 'authorized') await this.capture(result, 'webhook');
  }

  // ---------------------------------------------------------------- reconciliation

  /** Re-checks open orders with the provider (lost webhooks, failed captures). */
  async reconcile(): Promise<number> {
    const open = await this.repo.stale(this.cfg.env.RECONCILE_AFTER_SECONDS);
    for (const row of open) {
      await this.sync(row, 'reconcile').catch((err: unknown) =>
        this.logger.warn({ err, orderId: row.id }, 'reconcile failed'),
      );
    }
    return open.length;
  }

  private async sync(row: OrderRow, source: Source): Promise<void> {
    if (!row.provider_ref) return;
    let outcome: ProviderOutcome | 'pending';
    try {
      outcome = (await this.provider.status(row.provider_ref)).outcome;
    } catch (error) {
      // The provider no longer knows the payment (e.g. the mock restarted).
      if ((error as { status?: number }).status === 404) outcome = 'failed';
      else throw error;
    }
    if (outcome === 'pending') {
      await this.repo.locked(row.id, (tx) => tx.touch(row.id));
      return;
    }
    const next = await this.repo.locked(row.id, (tx, r) => this.apply(tx, r, outcome, source));
    if (next?.status === 'authorized') await this.capture(next, source);
  }

  // ---------------------------------------------------------------- state changes

  /** Applies a provider outcome through the state machine (in the order's transaction). */
  private async apply(
    tx: Tx,
    row: OrderRow,
    outcome: ProviderOutcome,
    source: Source,
  ): Promise<OrderRow> {
    const next = transition(row.status, outcome);
    if (!next) return row;
    const updated = await tx.setStatus(row, next, source);
    transitions.add(1, { to: next, source });
    if (next === 'captured') {
      const until = await tx.activate(updated);
      revenue.add(updated.amount_ore, { product: updated.product });
      this.logger.log({ orderId: row.id, until: until.toISOString() }, 'promotion activated');
    }
    if (next === 'refunded') await tx.revoke(updated);
    return updated;
  }

  /** Captures an authorized order (idempotent per order), then records it. */
  private async capture(row: OrderRow, source: Source): Promise<void> {
    if (this.provider.autoCapture || !row.provider_ref) return;
    try {
      await this.provider.capture(row.provider_ref, row.amount_ore, `capture-${row.id}`);
    } catch (error) {
      // Left authorized: reconciliation retries with the same idempotency key.
      return void this.logger.warn({ err: error, orderId: row.id }, 'capture failed; will retry');
    }
    await this.repo.locked(row.id, (tx, r) => this.apply(tx, r, 'captured', source));
  }

  /** Refunds a captured order in full and ends its promotion (platform admins). */
  async refund(principal: Principal, id: string) {
    if (!principal.roles.some((r) => ADMINS.includes(r)))
      throw new ForbiddenException('Admins only');
    const row = await this.repo.get(id);
    if (!row) throw new NotFoundException('Order not found');
    if (row.status !== 'captured' || !row.provider_ref)
      throw new ConflictException(`Order is ${row.status}`);
    await this.provider.refund(row.provider_ref, row.amount_ore, `refund-${row.id}`);
    await this.repo.locked(id, (tx, r) => this.apply(tx, r, 'refunded', 'admin'));
    this.logger.log({ orderId: id, admin: principal.sub }, 'order refunded');
    return this.view((await this.repo.get(id))!);
  }

  // ---------------------------------------------------------------- helpers

  private sameRequest(row: OrderRow, hash: string): OrderRow {
    if (row.request_hash !== hash) {
      throw new ConflictException('Idempotency-Key was already used for a different request');
    }
    return row;
  }

  private async view(row: OrderRow) {
    const until = row.status === 'captured' ? await this.repo.promotedUntil(row.listing_id) : null;
    return toOrder(row, until);
  }
}

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
