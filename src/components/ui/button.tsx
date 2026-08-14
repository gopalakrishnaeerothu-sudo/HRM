import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Every height here is a fixed step (h-8 / h-9 / h-10 / h-11) shared with
 * Input and Select, so a button sitting beside a field lines up exactly.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg",
    "text-sm font-medium leading-none",
    "transition-[background-color,box-shadow,transform,opacity] duration-200 ease-[var(--ease-out-quint)]",
    "outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.98]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "brand-gradient text-white shadow-[0_4px_16px_-4px_var(--brand-glow)] hover:shadow-[0_8px_24px_-6px_var(--brand-glow)] hover:brightness-110",
        secondary:
          "bg-surface-2 text-ink border border-line hover:bg-surface-3 hover:border-line-strong",
        outline:
          "border border-line-strong bg-transparent text-ink hover:bg-surface-2 hover:border-brand/40",
        ghost: "text-ink-secondary hover:bg-surface-2 hover:text-ink",
        subtle: "bg-brand-soft text-brand hover:brightness-95 dark:hover:brightness-125",
        danger: "bg-critical text-white hover:brightness-110 shadow-soft",
        success: "bg-success text-white hover:brightness-110 shadow-soft",
        link: "text-brand underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        xs: "h-8 px-2.5 text-xs [&_svg]:size-3.5",
        sm: "h-9 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-6 text-[0.9375rem]",
        icon: "h-10 w-10 p-0",
        "icon-sm": "h-9 w-9 p-0",
        "icon-xs": "h-8 w-8 p-0 [&_svg]:size-3.5",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      block: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Swaps the leading icon for a spinner and blocks interaction. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, block, asChild = false, loading = false, children, disabled, ...props },
    ref,
  ) => {
    // `asChild` renders into a link or menu item, which must receive exactly
    // one child — so the spinner is only injected when we own the element.
    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size, block, className }))} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, block, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
