import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';
import { cn } from './cn';

export const alertVariants = cva(
  'flex items-start gap-3 rounded-card border p-4 text-sm text-foreground [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        info: 'border-primary/25 bg-soft [&>svg]:text-primary',
        success: 'border-success/35 bg-success/10 [&>svg]:text-success',
        warning: 'border-warning/35 bg-warning/10 [&>svg]:text-warning',
        danger: 'border-destructive/40 bg-destructive/10 [&>svg]:text-destructive',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

export type AlertProps = ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof alertVariants> & {
    /** An icon before the text (decorative: give it aria-hidden). */
    icon?: ReactNode;
    title?: ReactNode;
  };

/**
 * A message banner. Problems (warning, danger) are announced at once (role="alert"); news (info,
 * success) politely (role="status"). Pass `role` to choose otherwise.
 */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, variant, icon, title, children, role, ...props },
  ref,
) {
  const urgent = variant === 'warning' || variant === 'danger';
  return (
    <div
      ref={ref}
      role={role ?? (urgent ? 'alert' : 'status')}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
});
