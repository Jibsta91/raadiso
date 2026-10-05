import 'server-only';
import { accessToken } from '../session';

/** How long a sign-in counts as recent for step-up actions; matches the services (ADR-0030). */
export const STEP_UP_SECONDS = Number(process.env.STEP_UP_MAX_AGE_SECONDS ?? 900);

/**
 * When the person last signed in (the token's auth_time), for the console's "sensitive actions"
 * indicator. Display only: the services verify the token and enforce step-up themselves.
 */
export async function authTime(): Promise<number | null> {
  const token = await accessToken();
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      auth_time?: unknown;
    };
    return typeof claims.auth_time === 'number' ? claims.auth_time * 1000 : null;
  } catch {
    return null;
  }
}
