'use server';

import { createIdentityClient } from '@raadi/api-client';
import { revalidatePath } from 'next/cache';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { accessToken } from '@/lib/session';

export type SecurityResult = { ok: true } | { ok: false; stepUp: boolean };

const ID = /^[\w-]{8,64}$/;

/** Runs a security change with the user's token; a 401 challenge means "sign in again first". */
async function run(
  call: (init: { headers: { authorization: string }; signal: AbortSignal }) => Promise<{
    response: Response;
  }>,
): Promise<SecurityResult> {
  const token = await accessToken();
  if (!token) return { ok: false, stepUp: true };
  try {
    const { response } = await call({
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    revalidatePath('/[locale]/account/security', 'page');
    if (response.ok) return { ok: true };
    const challenge = response.headers.get('www-authenticate') ?? '';
    return { ok: false, stepUp: challenge.includes('insufficient_user_authentication') };
  } catch (error) {
    logger.warn({ err: error }, 'security action failed');
    return { ok: false, stepUp: false };
  }
}

const identity = () => createIdentityClient({ baseUrl: env.identityBffUrl });

export async function endSession(id: string): Promise<SecurityResult> {
  if (!ID.test(id)) return { ok: false, stepUp: false };
  return run((i) =>
    identity().DELETE('/api/v1/identity/me/sessions/{id}', { ...i, params: { path: { id } } }),
  );
}

export async function endOtherSessions(): Promise<SecurityResult> {
  return run((i) => identity().DELETE('/api/v1/identity/me/sessions', i));
}

export async function removeCredential(id: string): Promise<SecurityResult> {
  if (!ID.test(id)) return { ok: false, stepUp: false };
  return run((i) =>
    identity().DELETE('/api/v1/identity/me/credentials/{id}', { ...i, params: { path: { id } } }),
  );
}
