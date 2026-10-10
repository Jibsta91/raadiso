import { cn } from '@raadi/ui';
import { Star } from 'lucide-react';

/** Read-only star rating (rounded to the nearest half for display). */
export function Stars({
  value,
  label,
  className,
}: {
  value: number;
  /** Accessible text, e.g. "4.5 out of 5". */
  label: string;
  className?: string;
}) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span role="img" aria-label={label} className={cn('inline-flex items-center', className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            'size-4',
            n <= rounded
              ? 'fill-rating text-rating'
              : n - 0.5 === rounded
                ? 'fill-rating/35 text-rating'
                : 'text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  );
}
