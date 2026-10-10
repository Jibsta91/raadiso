import {
  authEnvSchema,
  baseEnvSchema,
  dbEnvSchema,
  loadEnv,
  openBaoEnvSchema,
  readSecrets,
} from '@raadi/service-kit';
import { z } from 'zod';

export const envSchema = baseEnvSchema
  .extend(authEnvSchema.shape)
  .extend(openBaoEnvSchema.shape)
  .extend(dbEnvSchema.shape)
  .extend({
    PORT: z.coerce.number().int().default(4000),
    DB_NAME: z.string().default('listings'),
    DB_USER: z.string().default('listings'),
    OPENFGA_URL: z.url().default('http://openfga:8080'),
    OPA_URL: z.url().default('http://opa:8181'),
    /** Hearts on the owner's listings (saved's internal API). */
    SAVED_URL: z.url().default('http://saved:4000'),
    SEED_DEMO_DATA: z.enum(['true', 'false']).default('false'),
    /** Promotion events from payments (ADR-0020). */
    KAFKA_BROKERS: z.string().default('kafka:9092'),
    KAFKA_USERNAME: z.string().default('listings'),
  });

export type Env = z.infer<typeof envSchema>;

export const secretsSchema = z.object({
  db_password: z.string().min(16),
  fga_key: z.string().min(16),
  opa_token: z.string().min(16),
  kafka_password: z.string().min(16),
  'imgproxy.key': z.string().regex(/^[0-9a-f]{64}$/),
  'imgproxy.salt': z.string().regex(/^[0-9a-f]{64}$/),
});

export interface AppConfig {
  env: Env;
  secrets: z.infer<typeof secretsSchema>;
}

/** Environment from process.env, secrets from OpenBao (AppRole). */
export async function loadAppConfig(): Promise<AppConfig> {
  const env = loadEnv(envSchema);
  const raw = await readSecrets(env, { '': 'raadi/listings', imgproxy: 'raadi/shared/imgproxy' });
  return { env, secrets: secretsSchema.parse(raw) };
}
