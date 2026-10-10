import { Alert, cn, Tab, Tabs as UiTabs } from '@raadi/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

/**
 * Building blocks of the admin console (ADR-0030): dense, keyboard-friendly, the website's
 * tokens. Server components unless noted; charts are plain SVG (no chart library).
 */

export function PageHeader({
  title,
  intro,
  eyebrow,
  actions,
  children,
}: {
  title: ReactNode;
  intro?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="truncate text-xl font-bold sm:text-2xl" data-testid="admin-title">
          {title}
        </h1>
        {intro ? <p className="max-w-2xl text-sm text-muted-foreground">{intro}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
  testId,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  return (
    <section
      className={cn('flex min-w-0 flex-col rounded-card border bg-card', className)}
      data-testid={testId}
    >
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="flex items-center gap-2 font-sans text-sm font-semibold tracking-normal">
            {Icon ? <Icon aria-hidden className="size-4 text-muted-foreground" /> : null}
            {title}
          </h2>
          {actions}
        </div>
      ) : null}
      <div className={cn('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: 'bg-muted text-subtle-foreground',
  info: 'bg-soft text-soft-foreground',
  // Light mode darkens the text a little: small bold text needs 4.5:1 on the tinted background.
  good: 'bg-success/12 text-[color-mix(in_oklab,var(--success),black_25%)] dark:text-success',
  warn: 'bg-highlight/40 text-highlight-foreground dark:bg-highlight/15 dark:text-highlight',
  bad: 'bg-destructive/12 text-[color-mix(in_oklab,var(--destructive),black_25%)] dark:text-destructive',
  ink: 'bg-ink text-ink-foreground',
} as const;
export type Tone = keyof typeof TONES;

export function Pill({
  tone = 'neutral',
  children,
  dot,
  className,
  testId,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        TONES[tone],
        className,
      )}
      data-testid={testId}
    >
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/** A small line chart of recent values (no axes; the numbers are next to it). */
export function Sparkline({
  values,
  className,
  tone = 'primary',
  label,
}: {
  values: number[];
  className?: string;
  tone?: 'primary' | 'bad' | 'good' | 'muted';
  label?: string;
}) {
  const w = 120;
  const h = 32;
  if (values.length < 2) return <svg aria-hidden viewBox={`0 0 ${w} ${h}`} className={className} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - 2 - ((v - min) / span) * (h - 4),
  ]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x!.toFixed(1)},${y!.toFixed(1)}`).join('');
  const color = {
    primary: 'var(--primary)',
    bad: 'var(--destructive)',
    good: 'var(--success)',
    muted: 'var(--muted-foreground)',
  }[tone];
  const id = `spark-${tone}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-8 w-full overflow-visible', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Vertical bars, one per day (or bucket); the latest bar is emphasised. */
export function Bars({
  values,
  labels,
  className,
  format = (n) => String(n),
}: {
  values: number[];
  labels?: string[];
  className?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(...values, 1);
  return (
    <div className={cn('flex h-24 items-end gap-1', className)} role="list">
      {values.map((v, i) => (
        <div
          key={labels?.[i] ?? i}
          role="listitem"
          className="group relative flex h-full flex-1 items-end"
          title={`${labels?.[i] ?? ''} ${format(v)}`.trim()}
        >
          <div
            className={cn(
              'w-full rounded-t-[3px] transition-colors',
              i === values.length - 1 ? 'bg-primary' : 'bg-primary/30 group-hover:bg-primary/60',
            )}
            style={{ height: `${Math.max(v ? 4 : 1, (v / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** A KPI tile: label, big number, optional trend line and footnote. */
export function Stat({
  label,
  value,
  hint,
  trend,
  tone,
  href,
  icon: Icon,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  trend?: number[];
  tone?: 'primary' | 'bad' | 'good' | 'muted';
  href?: string;
  icon?: LucideIcon;
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon aria-hidden className="size-4 text-muted-foreground" /> : null}
      </div>
      <p className="text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {trend ? <Sparkline values={trend} tone={tone} /> : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  const cls =
    'flex min-w-0 flex-col gap-1.5 rounded-card border bg-card p-4 motion-safe:transition-colors focus-ring';
  return href ? (
    <Link href={href} prefetch={false} className={cn(cls, 'hover:bg-accent')} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

export function KeyValues({
  items,
  className,
}: {
  items: Array<[ReactNode, ReactNode] | null | false>;
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {items.filter(Boolean).map((item, i) => {
        const [k, v] = item as [ReactNode, ReactNode];
        return (
          <div key={i} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words font-medium">{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function Empty({
  icon: Icon,
  children,
  testId,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 px-4 py-12 text-center text-sm text-muted-foreground"
      data-testid={testId}
    >
      {Icon ? <Icon aria-hidden className="size-8 opacity-60" /> : null}
      {children}
    </div>
  );
}

export function Unavailable({ children }: { children: ReactNode }) {
  return (
    <Alert variant="danger" className="px-3 py-2">
      {children}
    </Alert>
  );
}

/** An id shown short, full on hover; mono. */
export function Id({
  value,
  href,
  className,
}: {
  value: string;
  href?: string;
  className?: string;
}) {
  const short = value.length > 12 ? `${value.slice(0, 8)}` : value;
  const cls = cn('font-mono text-xs', className);
  return href ? (
    <Link
      href={href}
      prefetch={false}
      title={value}
      className={cn(cls, 'text-primary hover:underline')}
    >
      {short}
    </Link>
  ) : (
    <span title={value} className={cls}>
      {short}
    </span>
  );
}

// Generic pieces live in packages/ui; the console uses them as they are.
export { Avatar, Kbd } from '@raadi/ui';

/** Link-based tabs (state lives in the URL, so tabs are shareable and work without JS). */
export function Tabs({
  tabs,
  current,
  label,
}: {
  tabs: Array<{ key: string; href: string; label: ReactNode; count?: number }>;
  current: string;
  label: string;
}) {
  return (
    <UiTabs label={label}>
      {tabs.map((tab) => (
        <Tab key={tab.key} asChild active={tab.key === current}>
          <Link href={tab.href} prefetch={false} scroll={false} data-testid={`tab-${tab.key}`}>
            {tab.label}
            {tab.count !== undefined ? (
              <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{tab.count}</span>
            ) : null}
          </Link>
        </Tab>
      ))}
    </UiTabs>
  );
}

/** A filter bar: GET form, so filters live in the URL. */
export function FilterBar({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2" data-testid={testId}>
      {children}
    </form>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export const inputCls = 'h-9 w-auto';

/** A table with the console's styling; rows come from the caller. */
export function Table({
  head,
  children,
  testId,
}: {
  head: ReactNode[];
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-card border bg-card">
      <table className="w-full text-start text-sm" data-testid={testId}>
        <thead className="sticky top-0 border-b bg-card text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export const td = 'px-4 py-2.5 align-middle';

export function Pager({
  total,
  offset,
  limit,
  href,
  labels,
}: {
  total: number;
  offset: number;
  limit: number;
  href: (offset: number) => string;
  labels: { prev: string; next: string; range: string };
}) {
  if (total <= limit && offset === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground tabular-nums">{labels.range}</p>
      <div className="flex gap-2">
        {offset > 0 ? (
          <Link
            href={href(Math.max(0, offset - limit))}
            prefetch={false}
            className="rounded-full border px-3 py-1 font-medium hover:bg-accent"
          >
            {labels.prev}
          </Link>
        ) : null}
        {offset + limit < total ? (
          <Link
            href={href(offset + limit)}
            prefetch={false}
            className="rounded-full border px-3 py-1 font-medium hover:bg-accent"
          >
            {labels.next}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
