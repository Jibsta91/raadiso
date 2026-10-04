'use server';

import { revalidatePath } from 'next/cache';
import { env } from '@/lib/env';
import { isAdminHost } from '@/lib/host';
import { logger } from '@/lib/logger';
import { accessToken } from '@/lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Moderation decisions, run on the server with the admin session's token (the admin host has no
 * API routes). listings checks the moderator role again and writes the audit entry (ADR-0028).
 */
async function moderate(listingId: string, kind: 'remove' | 'dismiss'): Promise<boolean> {
  if (!UUID.test(listingId) || !(await isAdminHost())) return false;
  const token = await accessToken();
  if (!token) return false;
  const res = await fetch(
    kind === 'remove'
      ? `${env.listingsUrl}/api/v1/listings/${listingId}`
      : `${env.listingsUrl}/api/v1/listings/moderation/reports/${listingId}/dismiss`,
    {
      method: kind === 'remove' ? 'DELETE' : 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    },
  ).catch((error: unknown) => {
    logger.warn({ err: error }, 'moderation action failed');
    return null;
  });
  revalidatePath('/[locale]/admin/moderation', 'page');
  return !!res?.ok;
}

export async function removeListing(listingId: string): Promise<boolean> {
  return moderate(listingId, 'remove');
}

export async function dismissReports(listingId: string): Promise<boolean> {
  return moderate(listingId, 'dismiss');
}
