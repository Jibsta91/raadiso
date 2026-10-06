'use client';

import type { ConversationDetail, Message } from '@raadi/api-client';
import { Button } from '@raadi/ui';
import { Send } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from '@/i18n/navigation';

type ClientEvent =
  | { type: 'hello' }
  | { type: 'message'; message: Message }
  | { type: 'read'; conversationId: string; byMe: boolean };

const merge = (list: Message[], add: Message[]) => {
  const seen = new Set(list.map((m) => m.id));
  return [...list, ...add.filter((m) => !seen.has(m.id))].sort((a, b) =>
    a.sentAt.localeCompare(b.sentAt),
  );
};

/**
 * A conversation thread. Sending goes over REST; new messages and read
 * receipts arrive over the push-only WebSocket, which reconnects with backoff
 * (the server closes it when the access token expires).
 */
export function Thread({ initial }: { initial: ConversationDetail }) {
  const t = useTranslations('messages');
  const format = useFormatter();
  const router = useRouter();
  const [messages, setMessages] = useState(initial.messages);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [seen, setSeen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  // Either side blocked the other (ADR-0027): no composer, and the blocked side is not told why.
  const [closed, setClosed] = useState(!initial.canMessage);
  const [blocking, setBlocking] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const id = initial.id;

  const markRead = useCallback(() => {
    void fetch(`/api/v1/messaging/conversations/${id}/read`, { method: 'POST' }).then(
      (res) => res.ok && router.refresh(),
      () => undefined,
    );
  }, [id, router]);

  useEffect(markRead, [markRead]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const connect = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${window.location.host}/api/v1/messaging/ws`);
      socket.onopen = () => {
        attempt = 0;
        setLive(true);
      };
      socket.onmessage = (e) => {
        const event = JSON.parse(String(e.data)) as ClientEvent;
        if (event.type === 'message' && event.message.conversationId === id) {
          setMessages((list) => merge(list, [event.message]));
          if (!event.message.fromMe) {
            setSeen(false);
            if (document.visibilityState === 'visible') markRead();
          }
        } else if (event.type === 'read' && event.conversationId === id && !event.byMe) {
          setSeen(true);
        }
      };
      socket.onclose = () => {
        setLive(false);
        if (stopped) return;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [id, markRead]);

  // Keep the newest message in view by scrolling the list, not the page.
  const newest = messages.at(-1)?.id;
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/messaging/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => ({}))) as {
          errors?: Array<{ code?: string }>;
        };
        if (problem.errors?.[0]?.code === 'conversation_closed') return setClosed(true);
        setError(t(res.status === 429 ? 'errors.rate_limited' : 'errors.generic'));
        return;
      }
      const message = (await res.json()) as Message;
      setMessages((list) => merge(list, [message]));
      setSeen(false);
      setDraft('');
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSending(false);
    }
  }

  async function setBlocked(block: boolean) {
    if (block && !window.confirm(t('blockConfirm', { name: initial.counterpart.name }))) return;
    setBlocking(true);
    const res = await fetch(`/api/v1/messaging/conversations/${id}/block`, {
      method: block ? 'PUT' : 'DELETE',
    }).catch(() => null);
    setBlocking(false);
    if (res?.ok) {
      setClosed(block);
      router.refresh();
    }
  }

  async function loadOlder() {
    const before = messages[0]?.sentAt;
    if (!before) return;
    const res = await fetch(
      `/api/v1/messaging/conversations/${id}?before=${encodeURIComponent(before)}&limit=50`,
    );
    if (!res.ok) return;
    const older = (await res.json()) as ConversationDetail;
    setMessages((list) => merge(list, older.messages));
    setHasMore(older.hasMore);
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };
  const lastMine = [...messages].reverse().find((m) => m.fromMe)?.id;

  return (
    <div className="flex flex-col gap-4" data-testid="thread" data-live={live}>
      <div ref={list} className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pe-1">
        {hasMore ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadOlder()}
            className="self-center"
          >
            {t('older')}
          </Button>
        ) : null}
        <ol className="flex flex-col gap-2" aria-live="polite" aria-label={t('thread')}>
          {messages.map((m) => (
            <li
              key={m.id}
              data-testid="thread-message"
              data-from={m.fromMe ? 'me' : 'them'}
              className={`max-w-[80%] rounded-3xl px-4 py-2.5 ${m.fromMe ? 'self-end rounded-ee-lg bg-primary text-primary-foreground' : 'self-start rounded-es-lg border bg-card'}`}
            >
              <p className="whitespace-pre-line break-words">{m.body}</p>
              <p className="mt-1 text-end text-xs opacity-70">
                <time dateTime={m.sentAt}>
                  {format.dateTime(new Date(m.sentAt), { dateStyle: 'short', timeStyle: 'short' })}
                </time>
                {m.id === lastMine && seen ? ` · ${t('seen')}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </div>
      {closed ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[1.75rem] border bg-card p-4 text-sm"
          data-testid="thread-closed"
        >
          <span>
            {initial.blockedByMe
              ? t('blockedByMe', { name: initial.counterpart.name })
              : t('closed')}
          </span>
          {initial.blockedByMe ? (
            <Button
              size="sm"
              variant="outline"
              disabled={blocking}
              onClick={() => void setBlocked(false)}
              data-testid="thread-unblock"
            >
              {t('unblock')}
            </Button>
          ) : null}
        </div>
      ) : (
        <form
          onSubmit={send}
          className="flex items-end gap-2 rounded-[1.75rem] border bg-card p-2 shadow-float focus-within:border-primary"
        >
          <label className="sr-only" htmlFor="compose">
            {t('compose')}
          </label>
          <textarea
            id="compose"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={2000}
            rows={1}
            placeholder={t('compose')}
            data-testid="compose-input"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 focus:outline-none"
          />
          <Button
            type="submit"
            disabled={sending || draft.trim() === ''}
            data-testid="compose-send"
            className="max-sm:size-11 max-sm:px-0"
          >
            <Send aria-hidden />
            <span className="sr-only sm:not-sr-only">{t('send')}</span>
          </Button>
        </form>
      )}
      {closed ? null : (
        <button
          type="button"
          onClick={() => void setBlocked(true)}
          disabled={blocking}
          data-testid="thread-block"
          className="self-end text-xs text-muted-foreground hover:text-destructive hover:underline"
        >
          {t('block', { name: initial.counterpart.name })}
        </button>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
