import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';

/**
 * True on the admin console's host (admin.<domain>, ADR-0028). The admin host has its own
 * session (admin-bff, cookie raadi_admin_sid) and shows only the /<locale>/admin area.
 */
export const isAdminHost = cache(async (): Promise<boolean> =>
  ((await headers()).get('host') ?? '').startsWith('admin.'),
);
