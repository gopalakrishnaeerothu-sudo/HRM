import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const cardVariants = cva("relative rounded-xl transition-shadow duration-300", {
  variants: {
    variant: {
      /** Default content container — translucent, blurred, hairline top edge. */
      glass: "glass-card",
      /** Opaque; use when a chart or dense table needs maximum legibility. */
      solid: "bg-surface-1 border border-line shadow-soft",
      /** Nested well inside another card. */
      inset: "glass-inset shadow-none",
      /** No chrome — for layout-only grouping. */
      plain: "bg-transparent",
    },
    interactive: {
      true: "hover:shadow-raised hover:-translate-y-0.5 transition-transform motion-reduce:hover:translate-y-0",
      false: "",
    },
  },
  defaultVariants: { variant: "glass", interactive: false },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, interactive }), className)} {...props} />
  ),
);
Card.displayName = "Card";

/**
 * Fixed padding scale across every card in the app (p-5 on mobile, p-6 from
 * sm up). Header/Content/Footer all use it, which is what keeps unrelated
 * pages optically aligned.
 */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { compact?: boolean }
>(({ className, compact = false, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-wrap items-start justify-between gap-3",
      compact ? "px-4 pt-4 pb-3 sm:px-5 sm:pt-5" : "px-5 pt-5 pb-4 sm:px-6 sm:pt-6",
      className,
    )}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" }
>(({ className, as: Tag = "h3", ...props }, ref) => (
  <Tag
    ref={ref}
    className={cn("text-base font-semibold leading-tight tracking-tight text-ink", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("mt-1 text-sm leading-relaxed text-ink-muted", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { compact?: boolean; flush?: boolean }
>(({ className, compact = false, flush = false, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      flush ? "pb-0" : compact ? "px-4 pb-4 sm:px-5 sm:pb-5" : "px-5 pb-5 sm:px-6 sm:pb-6",
      className,
    )}
    {...props}
  />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-line px-5 py-4 sm:px-6",
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, cardVariants };
