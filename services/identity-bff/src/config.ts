import { baseEnvSchema, loadEnv, OpenBaoClient } from '@raadi/service-kit';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().default(4000),
  PUBLIC_BASE_URL: z.url(),
  AUTH_BASE_URL: z.url(),
  KEYCLOAK_INTERNAL_URL: z.url().default('http://keycloak:8080'),
  KEYCLOAK_REALM: z.string().min(1).default('raadi'),
  OIDC_CLIENT_ID: z.string().min(1).default('raadi-bff'),
  API_AUDIENCE: z.string().min(1).default('raadi-api'),
  VALKEY_HOST: z.string().default('valkey'),
  VALKEY_PORT: z.coerce.number().int().default(6379),
  DB_HOST: z.string().default('postgres'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().default('identity'),
  DB_USER: z.string().default('identity'),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  OPENBAO_ADDR: z.url().default('http://openbao:8200'),
  OPENBAO_ROLE_ID_FILE: z.string().default('/run/secrets/openbao/role_id'),
  OPENBAO_SECRET_ID_FILE: z.string().default('/run/secrets/openbao/secret_id'),
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[\w-]+$/)
    .default('raadi_sid'),
  SESSION_MAX_AGE_SEC: z.coerce.number().int().min(300).default(36_000),
  /**
   * The same image also runs as admin-bff for the admin console (its own host, Keycloak client,
   * cookie and secrets, ADR-0028). These keep the two instances' sessions and secrets apart.
   */
  SESSION_KEY_PREFIX: z
    .string()
    .regex(/^[a-z]+$/)
    .default('bff'),
  /** OIDC `prompt` on every sign-in; `login` makes Keycloak ask again despite single sign-on. */
  OIDC_PROMPT: z.enum(['login']).optional(),
  OPENBAO_SECRET_PATH: z
    .string()
    .regex(/^raadi\/[a-z-]+$/)
    .default('raadi/identity-bff'),
});

export type Env = z.infer<typeof envSchema>;

export interface Secrets {
  dbPassword: string;
  oidcClientSecret: string;
  /** 32-byte AES-256-GCM key for session encryption at rest. */
  sessionKey: Buffer;
  valkeyPassword: string;
}

export interface AppConfig {
  env: Env;
  secrets: Secrets;
  /** Token issuer — the public realm URL. */
  issuer: string;
  /** Realm URL reachable from inside the network (back channel). */
  realmInternalUrl: string;
  cookieSecure: boolean;
  /** Origins allowed to make state-changing cookie-authenticated requests. */
  allowedOrigins: string[];
}

export function buildConfig(env: Env, secrets: Secrets): AppConfig {
  const pub = new URL(env.PUBLIC_BASE_URL);
  return {
    env,
    secrets,
    issuer: `${env.AUTH_BASE_URL}/realms/${env.KEYCLOAK_REALM}`,
    realmInternalUrl: `${env.KEYCLOAK_INTERNAL_URL}/realms/${env.KEYCLOAK_REALM}`,
    cookieSecure: pub.protocol === 'https:',
    // The same host is reachable over http and https in development.
    allowedOrigins: [...new Set([pub.origin, `https://${pub.host}`])],
  };
}

/** Environment from process.env, secrets from OpenBao (AppRole). */
export async function loadAppConfig(): Promise<AppConfig> {
  const env = loadEnv(envSchema);
  const bao = new OpenBaoClient({
    addr: env.OPENBAO_ADDR,
    roleIdFile: env.OPENBAO_ROLE_ID_FILE,
    secretIdFile: env.OPENBAO_SECRET_ID_FILE,
  });
  await bao.login();
  const [own, valkey] = await Promise.all([
    bao.readKv(env.OPENBAO_SECRET_PATH),
    bao.readKv('raadi/shared/valkey'),
  ]);
  bao.close();

  const secrets = z
    .object({
      db_password: z.string().min(16),
      oidc_client_secret: z.string().min(16),
      session_key: z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex'),
      valkey_password: z.string().min(16),
    })
    .parse({ ...own, valkey_password: valkey.password });

  return buildConfig(env, {
    dbPassword: secrets.db_password,
    oidcClientSecret: secrets.oidc_client_secret,
    sessionKey: Buffer.from(secrets.session_key, 'hex'),
    valkeyPassword: secrets.valkey_password,
  });
}
