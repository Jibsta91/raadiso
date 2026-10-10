'use client';

import type { Listing } from '@raadi/api-client';
import { Alert, Button } from '@raadi/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * Owner and moderator actions. Requests go to the gateway with the session
 * cookie; the token handler adds the access token (no tokens in the browser).
 */
export function ListingActions({ listing }: { listing: Listing }) {
  const t = useTranslations('listing');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const viewer = listing.viewer;
  if (!viewer?.canEdit && !viewer?.canDelete) return null;

  const send = (method: 'PATCH' | 'DELETE', body?: object) =>
    startTransition(async () => {
      setError(false);
      const res = await fetch(`/api/v1/listings/${listing.id}`, {
        method,
        // No content-type without a body: Fastify rejects an empty JSON body.
        headers: {
          'if-match': `"${listing.version}"`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return setError(true);
      if (method === 'DELETE') router.replace('/my/listings');
      else router.refresh();
    });

  return (
    <div className="space-y-2 rounded-card border p-4" data-testid="listing-actions">
      {viewer.isOwner ? <p className="text-sm font-medium">{t('yours')}</p> : null}
      <div className="flex flex-wrap gap-2">
        {viewer.canEdit ? (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/listings/${listing.id}/edit`} data-testid="edit-listing">
                {t('edit')}
              </Link>
            </Button>
            {viewer.isOwner && listing.status === 'active' ? (
              <Button asChild size="sm">
                <Link href={`/listings/${listing.id}/promote`} data-testid="promote-listing">
                  {t(listing.promotedUntil ? 'extendPromotion' : 'promote')}
                </Link>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              data-testid="toggle-sold"
              onClick={() =>
                send('PATCH', { status: listing.status === 'sold' ? 'active' : 'sold' })
              }
            >
              {listing.status === 'sold' ? t('markActive') : t('markSold')}
            </Button>
          </>
        ) : null}
        {viewer.canDelete ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            className="text-destructive"
            data-testid="delete-listing"
            onClick={() => window.confirm(t('deleteConfirm')) && send('DELETE')}
          >
            {t('delete')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <Alert variant="danger" className="w-full p-3">
          {t('actionFailed')}
        </Alert>
      ) : null}
    </div>
  );
}
