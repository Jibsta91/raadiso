import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from './cn';

export const chipVariants = cva(
  'focus-ring inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border text-sm font-medium motion-safe:transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      selected: {
        true: 'border-ink bg-ink text-ink-foreground',
        false: 'bg-card text-foreground hover:bg-accent',
      },
      size: { default: 'h-9 px-3.5', sm: 'h-8 px-3' },
    },
    defaultVariants: { selected: false, size: 'default' },
  },
);

export type ChipProps = ComponentPropsWithoutRef<'button'> &
  VariantProps<typeof chipVariants> & { asChild?: boolean };

/**
 * A filter or shortcut chip. A button by default (`aria-pressed` follows `selected` when given); with asChild it
 * styles a link, which should carry aria-current itself.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { className, selected, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      {...(asChild ? {} : { type: 'button' as const, 'aria-pressed': selected ?? undefined })}
      className={cn(chipVariants({ selected: !!selected, size }), className)}
      {...props}
    />
  );
});
