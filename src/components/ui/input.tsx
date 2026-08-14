import * as React from "react";

import { cn } from "@/lib/utils";

/** Shared field chrome. Input, Textarea and Select all render these classes,
 *  which is what guarantees a row of mixed controls lines up. */
export const fieldBaseClasses = [
  "w-full rounded-lg border bg-surface-1 text-sm text-ink",
  "border-line-strong",
  "placeholder:text-ink-muted",
  "transition-[border-color,box-shadow] duration-200",
  "focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25",
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-2",
  "aria-[invalid=true]:border-critical aria-[invalid=true]:ring-critical/25",
].join(" ");

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Icon rendered inside the leading edge; the input pads itself to clear it. */
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  inputSize?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-9 px-3",
  md: "h-10 px-3.5",
  lg: "h-11 px-4",
} as const;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", leadingIcon, trailingIcon, inputSize = "md", ...props }, ref) => {
    const control = (
      <input
        type={type}
        ref={ref}
        className={cn(
          fieldBaseClasses,
          sizeClasses[inputSize],
          leadingIcon && "pl-10",
          trailingIcon && "pr-10",
          className,
        )}
        {...props}
      />
    );

    if (!leadingIcon && !trailingIcon) return control;

    return (
      <div className="relative w-full">
        {leadingIcon ? (
          <span
            className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-ink-muted [&_svg]:size-4"
            aria-hidden
          >
            {leadingIcon}
          </span>
        ) : null}
        {control}
        {trailingIcon ? (
          <span
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted [&_svg]:size-4"
            aria-hidden
          >
            {trailingIcon}
          </span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(fieldBaseClasses, "resize-y px-3.5 py-2.5 leading-relaxed", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Input, Textarea };
