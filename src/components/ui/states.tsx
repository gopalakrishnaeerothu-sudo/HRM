import * as React from "react";
import { AlertTriangle, Inbox, SearchX, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The non-happy-path states. Every list, table and panel in the product uses
 * one of these rather than inventing its own, so an empty Tasks page and an
 * empty Employees page look and behave identically.
 */

export interface EmptyStateProps {
  /**
   * Rendered element, not a component reference — `icon={<Inbox />}`.
   * Several callers are Server Components rendering into Client Components,
   * and a function cannot cross that boundary.
   */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** `inline` fits inside a card; `page` fills a routed view. */
  size?: "inline" | "page";
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = "inline",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 text-center",
        size === "page" ? "min-h-[22rem] px-6 py-16" : "px-6 py-12",
        className,
      )}
    >
      {/* Decorative illustration: concentric glow behind a single glyph. */}
      <div className="relative flex size-16 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-2xl bg-brand-soft" />
        <span className="absolute -inset-3 rounded-3xl bg-brand-soft/40 blur-lg" />
        <span className="relative text-brand [&_svg]:size-7">{icon ?? <Inbox className="size-7" />}</span>
      </div>

      <div className="max-w-sm space-y-1.5">
        <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>
        {description ? (
          <p className="text-sm leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>

      {action ? <div className="flex flex-wrap justify-center gap-2 pt-1">{action}</div> : null}
    </div>
  );
}

/** Empty state specific to an active search or filter set. */
export function NoResultsState({
  query,
  onClear,
  className,
}: {
  query?: string;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={<SearchX />}
      title="No matches"
      description={
        query
          ? `Nothing matched “${query}”. Try a different spelling or clear the filters.`
          : "No records match the current filters."
      }
      action={
        onClear ? (
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : null
      }
      className={className}
    />
  );
}

/**
 * Error state. Shows a human-readable message only — never a stack trace, and
 * never a raw database error (those are mapped in src/lib/errors.ts).
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this right now. The issue has been logged.",
  onRetry,
  className,
  size = "inline",
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
  size?: "inline" | "page";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 text-center",
        size === "page" ? "min-h-[22rem] px-6 py-16" : "px-6 py-12",
        className,
      )}
      role="alert"
    >
      <div className="relative flex size-16 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-2xl bg-critical-soft" />
        <AlertTriangle className="relative size-7 text-critical" />
      </div>
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>
        <p className="text-sm leading-relaxed text-ink-muted">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Shown when a fetch fails with no network, e.g. a check-in attempt offline. */
export function OfflineState({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-4 px-6 py-12 text-center", className)}
      role="status"
    >
      <div className="relative flex size-16 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-2xl bg-warning-soft" />
        <WifiOff className="relative size-7 text-warning" />
      </div>
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-base font-semibold tracking-tight text-ink">You&apos;re offline</h3>
        <p className="text-sm leading-relaxed text-ink-muted">
          Check-ins need a connection so the server can verify your location. Your last change is
          saved locally and will not be lost.
        </p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
