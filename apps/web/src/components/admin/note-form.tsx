'use client';

import { Pin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { noteAction } from '@/app/[locale]/admin/actions';
import { toast } from './toaster';

/** Add an internal note to an account (support's memory; never shown to the user). */
export function NoteForm({ userId }: { userId: string }) {
  const t = useTranslations('admin.user.notes');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  // The server action itself (not a wrapper), so the form also works before hydration.
  const [state, action, pending] = useActionState(noteAction, null);
  useEffect(() => {
    if (!state) return;
    toast(state.message, state.ok ? 'good' : 'bad');
    if (state.ok) {
      form.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return (
    <form ref={form} action={action} className="space-y-2" data-testid="note-form">
      <input type="hidden" name="id" value={userId} />
      <textarea
        name="body"
        required
        maxLength={2000}
        rows={3}
        placeholder={t('placeholder')}
        className="field w-full border-input px-3 py-2 text-sm"
        data-testid="note-body"
      />
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="pinned" className="size-4 accent-[var(--primary)]" />
          <Pin aria-hidden className="size-3.5" />
          {t('pin')}
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-full bg-ink px-4 text-sm font-semibold text-ink-foreground disabled:opacity-50"
          data-testid="note-submit"
        >
          {t('add')}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t('privacy')}</p>
    </form>
  );
}
