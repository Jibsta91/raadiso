import {
  cloneElement,
  type ComponentPropsWithoutRef,
  forwardRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from 'react';
import { cn } from './cn';

/** The look of text inputs, selects and textareas: the `field` utility plus size and states. */
export const fieldControl =
  'field w-full border-input text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive';

export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldControl, 'h-11 px-3', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(fieldControl, 'min-h-24 px-3 py-2', className)}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<'select'>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(fieldControl, 'h-11 px-3', className)} {...props} />;
  },
);

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  required?: boolean;
};

export type FieldProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  label: ReactNode;
  /** Help under the control, read with it (aria-describedby). */
  hint?: ReactNode;
  /** A validation message: marks the control invalid and is read with it. */
  error?: ReactNode;
  /** The control's id; otherwise the control's own id, otherwise a generated one. */
  htmlFor?: string;
  /** Shows a required mark after the label (the control keeps its own `required`). */
  required?: boolean;
  labelClassName?: string;
  /** One control: Input, Select, Textarea or any element that takes id and aria-* props. */
  children: ReactElement<ControlProps>;
};

/**
 * A label, a control, a hint and an error, wired together: the label points at the control, and the
 * hint and the error describe it (aria-describedby); an error also sets aria-invalid.
 */
export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, hint, error, htmlFor, required, className, labelClassName, children, ...props },
  ref,
) {
  const generated = useId();
  const child = isValidElement(children) ? children : null;
  const id = htmlFor ?? child?.props.id ?? `field${generated.replace(/:/g, '')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [child?.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div ref={ref} className={cn('flex flex-col gap-1.5', className)} {...props}>
      <label htmlFor={id} className={cn('text-sm font-medium', labelClassName)}>
        {label}
        {required ? (
          <span aria-hidden className="text-destructive">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {child
        ? cloneElement(child, {
            id,
            'aria-describedby': describedBy,
            ...(error ? { 'aria-invalid': true } : {}),
          })
        : children}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
});
