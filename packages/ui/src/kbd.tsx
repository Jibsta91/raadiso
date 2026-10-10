import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from './cn';

/** A key on the keyboard ("g", "⌘K"). */
export const Kbd = forwardRef<HTMLElement, ComponentPropsWithoutRef<'kbd'>>(function Kbd(
  { className, ...props },
  ref,
) {
  return (
    <kbd
      ref={ref}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-field border border-b-2 bg-card px-1 font-mono text-xs font-semibold text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
});
