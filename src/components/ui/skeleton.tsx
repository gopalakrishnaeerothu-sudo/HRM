import { cn } from "@/lib/utils";

/**
 * Loading placeholders. Every skeleton mirrors the *exact* footprint of the
 * content it stands in for, so nothing shifts when data arrives.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-lg bg-surface-2",
        "bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--ink)_6%,transparent),transparent)] bg-[length:200%_100%]",
        "animate-[shimmer_2s_linear_infinite] motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

/** Matches the footprint of a StatCard. */
export function StatCardSkeleton() {
  return (
    <div className="glass-card flex h-[7.75rem] flex-col justify-between p-5">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="size-9 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

/** Matches a Card with a header and a chart body. */
export function ChartCardSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="glass-card p-5 sm:p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="mt-6 w-full rounded-lg" style={{ height }} />
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center gap-4 border-b border-line px-5 py-3.5">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div key={colIndex} className="flex flex-1 items-center gap-3">
              {colIndex === 0 ? <Skeleton className="size-9 shrink-0 rounded-full" /> : null}
              <Skeleton className="h-3.5 w-full max-w-32" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="glass-card flex items-center gap-4 p-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
