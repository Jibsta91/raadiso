import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from './cn';

export type AvatarProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  name: string;
  /** A stable id: it picks the colour, so a person keeps theirs. */
  id: string;
  size?: 'sm' | 'md' | 'lg';
};

/** Two initials of a name. */
export function initials(name: string): string {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  );
}

/** Initials in a circle, coloured by the id (stable per person). Decorative: the name is next to it. */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, id, size = 'md', className, style, ...props },
  ref,
) {
  const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-scrim-foreground',
        { sm: 'size-7 text-xs', md: 'size-9 text-xs', lg: 'size-14 text-lg' }[size],
        className,
      )}
      // L 0.45 keeps white initials above 4.5:1 contrast for every hue (WCAG AA).
      style={{ background: `oklch(0.45 0.13 ${hue})`, ...style }}
      {...props}
    >
      {initials(name)}
    </span>
  );
});
