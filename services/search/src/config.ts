import {
  authEnvSchema,
  baseEnvSchema,
  loadEnv,
  openBaoEnvSchema,
  readSecrets,
} from '@raadi/service-kit';
import { COUNTRY_CODES } from '@raadi/catalog';
import { z } from 'zod';

export const envSchema = baseEnvSchema
  .extend(authEnvSchema.shape)
  .extend(openBaoEnvSchema.shape)
  .extend({
    PORT: z.coerce.number().int().default(4000),
    OPENSEARCH_URL: z.url().default('http://opensearch:9200'),
    OPENSEARCH_USERNAME: z.string().default('search'),
    /** Alias that queries use; the concrete index is versioned behind it. */
    INDEX_ALIAS: z.string().default('raadi-listings'),
    KAFKA_BROKERS: z.string().default('kafka:9092'),
    KAFKA_USERNAME: z.string().default('search'),
    /** The country of a search that names none (ADR-0040). */
    DEFAULT_COUNTRY: z.enum(COUNTRY_CODES).default('XS'),
  });

export type Env = z.infer<typeof envSchema>;

export const secretsSchema = z.object({
  opensearch_password: z.string().min(16),
  kafka_password: z.string().min(16),
  'imgproxy.key': z.string().regex(/^[0-9a-f]{64}$/),
  'imgproxy.salt': z.string().regex(/^[0-9a-f]{64}$/),
});

export interface AppConfig {
  env: Env;
  secrets: z.infer<typeof secretsSchema>;
}

export async function loadAppConfig(): Promise<AppConfig> {
  const env = loadEnv(envSchema);
  const raw = await readSecrets(env, { '': 'raadi/search', imgproxy: 'raadi/shared/imgproxy' });
  return { env, secrets: secretsSchema.parse(raw) };
}
