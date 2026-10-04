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
    DB_NAME: z.string().default('audit'),
    DB_USER: z.string().default('audit'),
    KAFKA_BROKERS: z.string().default('kafka:9092'),
    KAFKA_USERNAME: z.string().default('audit'),
  });

export type Env = z.infer<typeof envSchema>;

export const secretsSchema = z.object({
  db_password: z.string().min(16),
  kafka_password: z.string().min(16),
});

export interface AppConfig {
  env: Env;
  secrets: z.infer<typeof secretsSchema>;
}

/** Environment from process.env, secrets from OpenBao (AppRole). */
export async function loadAppConfig(): Promise<AppConfig> {
  const env = loadEnv(envSchema);
  const raw = await readSecrets(env, { '': 'raadi/audit' });
  return { env, secrets: secretsSchema.parse(raw) };
}
