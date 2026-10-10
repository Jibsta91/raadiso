import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from './cn';

/** A placeholder while content loads; hidden from assistive technology. */
export const Skeleton = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden
        className={cn('rounded-field bg-muted motion-safe:animate-pulse', className)}
        {...props}
      />
    );
  },
);
