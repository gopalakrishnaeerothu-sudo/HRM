"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one form row used across the product.
 *
 * Every field in every form renders exactly this stack —
 *
 *     Label  (+ optional/required marker)
 *     Control
 *     Helper text  OR  validation message
 *
 * — with the same gaps, so labels and inputs align across columns and no page
 * invents its own spacing. `Field` also wires up `htmlFor`, `aria-describedby`
 * and `aria-invalid` for whatever control it wraps, via context.
 */

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Spread onto the control inside a `Field` to inherit its a11y wiring. */
export function useFieldControl() {
  const ctx = React.useContext(FieldContext);
  if (!ctx) return {};
  return {
    id: ctx.id,
    "aria-describedby": ctx.describedBy,
    "aria-invalid": ctx.invalid || undefined,
  } as const;
}

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "flex items-center gap-1.5 text-sm font-medium leading-none text-ink-secondary",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

export interface FieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  label: React.ReactNode;
  /** Persistent hint. Hidden while an error is showing, to avoid two messages. */
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  /** Renders a muted "Optional" marker; use on forms where most fields are required. */
  optional?: boolean;
  /** Receives id / aria-describedby / aria-invalid. */
  children: (control: ReturnType<typeof useFieldControl>) => React.ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  className,
  children,
  ...props
}: FieldProps) {
  const reactId = React.useId();
  const id = `field-${reactId}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const invalid = Boolean(error);
  const describedBy = invalid ? errorId : hint ? hintId : undefined;

  const control = { id, "aria-describedby": describedBy, "aria-invalid": invalid || undefined } as const;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid }}>
      <div className={cn("flex w-full min-w-0 flex-col gap-2", className)} {...props}>
        <Label htmlFor={id}>
          <span className="truncate">{label}</span>
          {required ? (
            <span className="text-critical" aria-hidden>
              *
            </span>
          ) : null}
          {optional ? <span className="text-xs font-normal text-ink-muted">Optional</span> : null}
        </Label>

        {children(control)}

        {/* Reserve the message row only when there is something to say — but
            both messages share one slot so the layout never jumps twice. */}
        {invalid ? (
          <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-critical">
            <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs leading-relaxed text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Consistent two-column form grid; collapses to one column below `sm`. */
export function FieldGrid({
  className,
  columns = 2,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { columns?: 1 | 2 | 3 }) {
  return (
    <div
      className={cn(
        "grid gap-x-5 gap-y-5",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
      {...props}
    />
  );
}

/** Full-width row inside a `FieldGrid` (description, notes). */
export function FieldSpan({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sm:col-span-2 lg:col-span-3", className)} {...props} />;
}

/** Titled group of fields, used to break long forms into sections. */
export function FieldSection({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-5", className)}>
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {description ? <p className="text-xs leading-relaxed text-ink-muted">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export { Label };
