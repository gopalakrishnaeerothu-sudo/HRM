import { Skeleton, StatCardSkeleton } from "@/components/ui/skeleton";
import { StatGrid } from "@/components/ui/stat-card";

/**
 * Route-level loading state.
 *
 * Mirrors the common page shape — header, KPI row, content — so the layout
 * holds its position and nothing jumps when the real content arrives.
 */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>

      <StatGrid>
        {Array.from({ length: 4 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}
