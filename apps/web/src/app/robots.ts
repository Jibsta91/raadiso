import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

/** Public pages may be indexed; accounts, messages, the API and sign-in may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/*/account',
        '/*/my/',
        '/*/messages',
        '/*/notifications',
        '/*/payments',
        '/*/welcome',
        '/*/listings/new',
        '/*/listings/*/edit',
        '/*/listings/*/promote',
      ],
    },
    sitemap: `${env.publicBaseUrl}/sitemap.xml`,
  };
}
