/**
 * Demo data seeder (one-shot container, SEED_DEMO_DATA=true only). Inserts the
 * deterministic demo listings from @raadi/catalog with their outbox events
 * (Debezium carries them to search) and owner tuples in OpenFGA. Idempotent:
 * existing listings are skipped and tuple writes ignore duplicates.
 */
import { demoListings } from '@raadi/catalog/demo';
import { createPgPool, FgaClient, loadEnv, loggerOptions } from '@raadi/service-kit';
import { shutdownTelemetry } from '@raadi/service-kit/telemetry';
import { pino } from 'pino';
import { envSchema, loadAppConfig } from './config.js';
import { ListingsRepository, type NewListing } from './listings/listings.repository.js';

/**
 * About one demo listing in eight had a higher price first (ADR-0044), chosen by its id so every machine
 * seeds the same. The drop happened halfway between publication and now.
 */
function demoDrop(
  l: ReturnType<typeof demoListings>[number],
  publishedAt: number,
): Pick<NewListing, 'priceDrop'> {
  if (!l.price || parseInt(l.id.slice(0, 2), 16) % 8 !== 0) return {};
  const previousMinor = Math.round((l.price.amountMinor * 1.15) / 100) * 100;
  return { priceDrop: { previousMinor, at: new Date((publishedAt + Date.now()) / 2) } };
}

const log = pino(loggerOptions('listings-seed'));

async function main(): Promise<void> {
  if (loadEnv(envSchema).SEED_DEMO_DATA !== 'true') {
    log.info('SEED_DEMO_DATA is not true; nothing to do');
    return;
  }
  const { env, secrets } = await loadAppConfig();
  const pool = createPgPool(env, secrets.db_password, 'listings-seed');
  const fga = new FgaClient({ url: env.OPENFGA_URL, apiKey: secrets.fga_key });
  const repo = new ListingsRepository(pool);
  const now = Date.now();
  const listings = demoListings();
  let inserted = 0;
  try {
    for (let i = 0; i < listings.length; i += 50) {
      const batch = listings.slice(i, i + 50);
      const rows = await repo.createMany(
        batch.map((l): NewListing => ({
          id: l.id,
          ownerId: l.ownerId,
          sellerName: l.sellerName,
          category: l.category,
          subcategory: l.subcategory,
          title: l.title,
          description: l.description,
          price: l.price,
          attributes: l.attributes as Record<string, unknown>,
          placeId: l.place.id,
          imageIds: l.images.map((img) => img.id),
          publishedAt: new Date(now - l.ageDays * 86_400_000 - i * 60_000),
          ...demoDrop(l, now - l.ageDays * 86_400_000 - i * 60_000),
        })),
      );
      inserted += rows.length;
      // Owner tuples for the whole batch (2 per listing, ≤ 100 per write).
      await fga.write(
        batch.flatMap((l) => [
          { user: `user:${l.ownerId}`, relation: 'owner', object: `listing:${l.id}` },
          { user: 'platform:raadi', relation: 'platform', object: `listing:${l.id}` },
        ]),
      );
    }
    log.info({ inserted, total: listings.length }, 'demo listings seeded');
  } finally {
    await pool.end();
    await shutdownTelemetry();
  }
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, 'seeding failed');
  process.exit(1);
});
