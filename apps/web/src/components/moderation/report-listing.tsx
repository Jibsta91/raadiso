'use client';

import { Alert, Button, Textarea } from '@raadi/ui';
import { Flag } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';

const REASONS = ['fraud', 'prohibited', 'offensive', 'wrong_category', 'other'] as const;

/** "Report listing": reason and an optional comment, straight to the moderators (ADR-0027). */
export function ReportListing({ listingId }: { listingId: string }) {
  const t = useTranslations('report');
  const locale = useLocale();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>();
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  if (state === 'sent') {
    return (
      <p role="status" className="text-sm text-muted-foreground" data-testid="report-sent">
        {t('thanks')}
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="report-open"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <Flag aria-hidden className="size-3.5" />
        {t('open')}
      </button>
    );
  }
  return (
    <form
      data-testid="report-form"
      className="space-y-3 rounded-card border bg-card p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason) return;
        setState('sending');
        const res = await fetch(`/api/v1/listings/${listingId}/reports`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason, comment }),
        }).catch(() => null);
        if (res?.status === 401) {
          const here = `${window.location.pathname}${window.location.search}`;
          window.location.href = `/auth/login?returnTo=${encodeURIComponent(here)}&locale=${locale}`;
          return;
        }
        setState(res?.ok ? 'sent' : 'error');
      }}
    >
      <fieldset className="space-y-2">
        <legend className="mb-1 font-semibold">{t('title')}</legend>
        {REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-reason`}
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              data-testid={`report-reason-${r}`}
            />
            {t(`reasons.${r}`)}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t('comment')}</span>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={3}
          data-testid="report-comment"
          className="p-3"
        />
      </label>
      {state === 'error' ? (
        <Alert variant="danger" className="w-full p-3">
          {t('error')}
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!reason || state === 'sending'}
          data-testid="report-send"
        >
          {t('send')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
