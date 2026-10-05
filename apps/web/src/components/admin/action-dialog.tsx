'use client';

import { cn } from '@raadi/ui';
import {
  Ban,
  CircleCheck,
  KeyRound,
  LogOut,
  Mail,
  NotebookPen,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Undo2,
  UserCog,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { ActionResult } from '@/app/[locale]/admin/actions';
import { toast } from './toaster';

const ICONS = {
  ban: Ban,
  check: CircleCheck,
  key: KeyRound,
  logout: LogOut,
  mail: Mail,
  note: NotebookPen,
  undo: Undo2,
  refund: RotateCcw,
  shield: ShieldCheck,
  trash: Trash2,
  roles: UserCog,
} as const;

export type ActionIcon = keyof typeof ICONS;

const TRIGGER = {
  danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 border-transparent',
  primary: 'bg-ink text-ink-foreground hover:bg-ink/90 border-transparent',
  default: 'bg-card hover:bg-accent',
  ghost: 'border-transparent hover:bg-accent',
} as const;

/**
 * A staff action behind a confirmation (ADR-0030): a reason code, a note for the audit log,
 * optional extra fields, and "type to confirm" for the irreversible ones. When the service asks
 * for a recent sign-in (step-up), it offers to sign in again and come back to this page.
 */
export function ActionDialog({
  action,
  label,
  icon,
  tone = 'default',
  title,
  description,
  hidden,
  reasons,
  note,
  confirmText,
  stepUp,
  submitLabel,
  children,
  testId,
  size = 'md',
  shortcut,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  label: string;
  icon?: ActionIcon;
  tone?: keyof typeof TRIGGER;
  title: string;
  description?: ReactNode;
  hidden?: Record<string, string | string[]>;
  reasons?: { name?: string; label: string; options: Array<{ value: string; label: string }> };
  note?: { label: string; required?: boolean; placeholder?: string; templates?: string[] };
  confirmText?: string;
  stepUp?: boolean;
  submitLabel?: string;
  children?: ReactNode;
  testId?: string;
  size?: 'sm' | 'md';
  /** A key that opens the dialog (when focus is not in a field), e.g. "x". */
  shortcut?: string;
}) {
  const t = useTranslations('admin.dialog');
  const locale = useLocale();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Toast as soon as the result arrives: the refreshed page may replace this dialog (the item it
  // acted on is gone, or Suspend became Lift suspension) before an effect would run.
  const run = useCallback(
    async (prev: ActionResult | null, form: FormData) => {
      const result = await action(prev, form);
      if (result.ok) toast(result.message, 'good');
      else if (result.error !== 'step_up') toast(result.message, 'bad');
      return result;
    },
    [action],
  );
  const [state, formAction, pending] = useActionState(run, null);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [noteText, setNoteText] = useState('');
  const Icon = icon ? ICONS[icon] : null;

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      ref.current?.close();
      setTyped('');
      setNoteText('');
      setReason('');
      router.refresh();
    }
  }, [state, router]);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest('input,textarea,select,dialog')) return;
      if (e.key === shortcut) {
        e.preventDefault();
        ref.current?.showModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const reAuth = () => {
    const back = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/auth/login?returnTo=${encodeURIComponent(back)}&locale=${locale}`;
  };

  const blocked =
    pending ||
    (confirmText !== undefined && typed.trim() !== confirmText) ||
    (!!reasons && !reason) ||
    (!!note?.required && noteText.trim().length < 3);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
          size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm',
          TRIGGER[tone],
        )}
        data-testid={testId}
        aria-keyshortcuts={shortcut}
      >
        {Icon ? <Icon aria-hidden className="size-4" /> : null}
        {label}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-3xl border bg-card p-0 text-card-foreground shadow-float backdrop:bg-black/40 backdrop:backdrop-blur-sm"
        data-testid={testId ? `${testId}-dialog` : undefined}
      >
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 id={titleId} className="text-xl font-bold">
                {title}
              </h2>
              {description ? (
                <div className="text-sm text-muted-foreground">{description}</div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="rounded-full p-1.5 hover:bg-accent"
              aria-label={t('close')}
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          {stepUp ? (
            <p className="flex items-center gap-2 rounded-xl bg-soft px-3 py-2 text-xs text-soft-foreground">
              <ShieldAlert aria-hidden className="size-4 shrink-0" />
              {t('stepUpNote')}
            </p>
          ) : null}
          {Object.entries(hidden ?? {}).flatMap(([name, value]) =>
            (Array.isArray(value) ? value : [value]).map((v) => (
              <input key={`${name}-${v}`} type="hidden" name={name} value={v} />
            )),
          )}
          {reasons ? (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">{reasons.label}</legend>
              <div className="flex flex-wrap gap-1.5">
                {reasons.options.map((o) => (
                  <label
                    key={o.value}
                    className="cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-ink-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring hover:bg-accent"
                  >
                    <input
                      type="radio"
                      name={reasons.name ?? 'reasonCode'}
                      value={o.value}
                      className="sr-only"
                      required
                      checked={reason === o.value}
                      onChange={() => setReason(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {children}
          {note ? (
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              {note.label}
              <textarea
                name="note"
                rows={3}
                maxLength={500}
                required={note.required}
                placeholder={note.placeholder}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                className="field border-input px-3 py-2 text-sm font-normal"
              />
              {note.templates?.length ? (
                <span className="flex flex-wrap gap-1">
                  {note.templates.map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setNoteText((v) => (v ? `${v} ${tpl}` : tpl))}
                      className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-subtle-foreground hover:bg-accent"
                    >
                      + {tpl}
                    </button>
                  ))}
                </span>
              ) : null}
            </label>
          ) : null}
          {confirmText !== undefined ? (
            <label className="flex flex-col gap-1.5 text-sm">
              <span>
                {t.rich('typeToConfirm', {
                  text: confirmText,
                  b: (c) => <strong className="font-mono">{c}</strong>,
                })}
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="field h-10 border-input px-3 font-mono"
                data-testid={testId ? `${testId}-confirm` : undefined}
              />
            </label>
          ) : null}
          {state && !state.ok && state.error === 'step_up' ? (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-soft p-4 text-sm text-soft-foreground sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex items-center gap-2">
                <ShieldAlert aria-hidden className="size-4 shrink-0" />
                {state.message}
              </span>
              <button
                type="button"
                onClick={reAuth}
                className="rounded-full bg-ink px-4 py-1.5 font-semibold text-ink-foreground"
                data-testid="step-up-signin"
              >
                {t('signInAgain')}
              </button>
            </div>
          ) : state && !state.ok ? (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="h-10 rounded-full px-4 text-sm font-semibold hover:bg-accent"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={blocked}
              className={cn(
                'h-10 rounded-full px-5 text-sm font-semibold transition-opacity disabled:opacity-40',
                tone === 'danger'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-ink text-ink-foreground',
              )}
              data-testid={testId ? `${testId}-submit` : undefined}
            >
              {pending ? t('working') : (submitLabel ?? label)}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
