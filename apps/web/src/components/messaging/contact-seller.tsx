'use client';

import type { StartedConversation } from '@raadi/api-client';
import { Alert, Button, Textarea } from '@raadi/ui';
import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useRouter } from '@/i18n/navigation';

const KNOWN_ERRORS = ['own_listing', 'listing_unavailable'];

/** "Contact the seller" on a listing: sends the first message and opens the conversation. */
export function ContactSeller({ listingId }: { listingId: string }) {
  const t = useTranslations('messages');
  const router = useRouter();
  const [body, setBody] = useState(t('contact.default'));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/messaging/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listingId, body }),
      });
      if (res.ok) {
        const { conversation } = (await res.json()) as StartedConversation;
        router.push(`/messages/${conversation.id}`);
        return;
      }
      const problem = (await res.json().catch(() => ({}))) as {
        errors?: Array<{ code?: string }>;
      };
      const code = problem.errors?.[0]?.code;
      setError(
        t(
          `errors.${code && KNOWN_ERRORS.includes(code) ? code : res.status === 429 ? 'rate_limited' : 'generic'}` as never,
        ),
      );
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-card border p-4"
      data-testid="contact-seller"
    >
      <label className="block space-y-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <MessageCircle aria-hidden className="size-4" />
          {t('contact.title')}
        </span>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          maxLength={2000}
          rows={3}
          data-testid="contact-message"
          className="p-2"
        />
      </label>
      {error ? (
        <Alert variant="danger" className="w-full p-3" data-testid="contact-error">
          {error}
        </Alert>
      ) : null}
      <Button
        type="submit"
        className="w-full"
        disabled={sending || body.trim() === ''}
        data-testid="contact-submit"
      >
        {sending ? t('sending') : t('contact.send')}
      </Button>
    </form>
  );
}
