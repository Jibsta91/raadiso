import { type ComponentPropsWithoutRef, type ElementType, forwardRef, type ReactNode } from 'react';
import { cn } from './cn';

export type EmptyStateProps = Omit<ComponentPropsWithoutRef<'div'>, 'title'> & {
  /** An icon, shown in a soft circle (decorative: give it aria-hidden). */
  icon?: ReactNode;
  title: ReactNode;
  /** The heading element of the title (default h2). */
  titleAs?: ElementType;
  /** What to do next: a button or link. */
  action?: ReactNode;
};

/** Nothing here yet: an icon, a title, a line of text and what to do next. */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, titleAs: Title = 'h2', action, children, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col items-center gap-3 px-4 py-12 text-center', className)}
      {...props}
    >
      {icon ? (
        <span className="flex size-14 items-center justify-center rounded-full bg-soft text-soft-foreground [&_svg]:size-7">
          {icon}
        </span>
      ) : null}
      <Title className="font-sans text-lg font-semibold tracking-normal">{title}</Title>
      {children ? <div className="max-w-md text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
});
