import { Slot } from '@radix-ui/react-slot';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from './cn';

/** A row of link tabs; state lives in the URL, so tabs are shareable and work without JavaScript. */
export const Tabs = forwardRef<HTMLElement, ComponentPropsWithoutRef<'nav'> & { label: string }>(
  function Tabs({ label, className, ...props }, ref) {
    return (
      <nav
        ref={ref}
        aria-label={label}
        className={cn('flex gap-1 overflow-x-auto border-b', className)}
        {...props}
      />
    );
  },
);

export type TabProps = ComponentPropsWithoutRef<'a'> & { active?: boolean; asChild?: boolean };

/** One tab: a link (asChild for a router link), marked aria-current="page" when active. */
export const Tab = forwardRef<HTMLAnchorElement, TabProps>(function Tab(
  { active = false, asChild = false, className, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp
      ref={ref}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-ring flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium motion-safe:transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
});
