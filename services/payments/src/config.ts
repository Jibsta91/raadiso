import {
  authEnvSchema,
  baseEnvSchema,
  dbEnvSchema,
  loadEnv,
  openBaoEnvSchema,
  readSecrets,
} from '@raadi/service-kit';
import { z } from 'zod';

const optionalUrl = z
  .union([z.literal(''), z.url()])
  .optional()
  .transform((v) => v || undefined);

export const envSchema = baseEnvSchema
  .extend(authEnvSchema.shape)
  .extend(openBaoEnvSchema.shape)
  .extend(dbEnvSchema.shape)
  .extend({
    PORT: z.coerce.number().int().default(4000),
    DB_NAME: z.string().default('payments'),
    DB_USER: z.string().default('payments'),
    /** Providers send the payer back to the app here. */
    PUBLIC_BASE_URL: z.url(),
    /** Ownership and status of the listing being promoted (internal API). */
    LISTINGS_URL: z.url().default('http://listings:4000'),
    /** The active provider (ADR-0020). */
    /** `none`: no provider yet; promotions are switched off (ADR-0051). */
    PAYMENTS_PROVIDER: z.enum(['vipps', 'stripe', 'none']).default('vipps'),
    /** Vipps MobilePay ePayment API; payments-mock in development. */
    VIPPS_BASE_URL: z.url().default('http://payments-mock:4000'),
    VIPPS_CLIENT_ID: z.string().default('raadi-dev'),
    VIPPS_MSN: z.string().default('123456'),
    STRIPE_BASE_URL: optionalUrl,
    /** Open orders not updated for this long are re-checked with the provider. */
    RECONCILE_AFTER_SECONDS: z.coerce.number().int().min(5).default(60),
    RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  });
export type Env = z.infer<typeof envSchema>;

export const secretsSchema = z.object({
  db_password: z.string().min(16),
  vipps_client_secret: z.string().optional(),
  vipps_subscription_key: z.string().optional(),
  vipps_webhook_secret: z.string().optional(),
  stripe_secret_key: z.string().optional(),
  stripe_webhook_secret: z.string().optional(),
});
export type Secrets = z.infer<typeof secretsSchema>;

export interface AppConfig {
  env: Env;
  secrets: Secrets;
}

/** Environment from process.env, secrets from OpenBao (AppRole). */
export async function loadAppConfig(): Promise<AppConfig> {
  const env = loadEnv(envSchema);
  const secrets = secretsSchema.parse(await readSecrets(env, { '': 'raadi/payments' }));
  const needed =
    env.PAYMENTS_PROVIDER === 'vipps'
      ? (['vipps_client_secret', 'vipps_subscription_key', 'vipps_webhook_secret'] as const)
      : env.PAYMENTS_PROVIDER === 'stripe'
        ? (['stripe_secret_key', 'stripe_webhook_secret'] as const)
        : ([] as const);
  const missing = needed.filter((k) => !secrets[k]);
  if (missing.length)
    throw new Error(`missing secrets for ${env.PAYMENTS_PROVIDER}: ${missing.join(', ')}`);
  return { env, secrets };
}
