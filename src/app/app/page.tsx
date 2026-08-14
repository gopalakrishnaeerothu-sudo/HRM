import { Suspense } from "react";
import type { Metadata } from "next";

import { requireSession } from "@/server/auth";
import { isManagerialRole, isOrgWideRole } from "@/server/auth/permissions";
import { StatCardSkeleton, ChartCardSkeleton } from "@/components/ui/skeleton";
import { StatGrid } from "@/components/ui/stat-card";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { ManagerDashboard } from "@/components/dashboard/manager-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard is a different product for each role, not the same page with
 * things hidden:
 *
 *   OWNER / ADMIN / HR → organisation-wide operations
 *   MANAGER            → their team's attendance and workload
 *   EMPLOYEE           → their own day: check in, today's tasks, their hours
 *
 * The role comes from the server session; there is no client-side branch that
 * could be flipped to reveal another role's data, and each dashboard's queries
 * are scoped independently besides.
 */
export default async function DashboardPage() {
  const session = await requireSession();

  if (isOrgWideRole(session.user.role)) {
    return (
      <Suspense fallback={<DashboardSkeleton />}>
        <AdminDashboard session={session} />
      </Suspense>
    );
  }

  if (isManagerialRole(session.user.role)) {
    return (
      <Suspense fallback={<DashboardSkeleton />}>
        <ManagerDashboard session={session} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <EmployeeDashboard session={session} />
    </Suspense>
  );
}

/** Mirrors the real layout so nothing shifts when the data lands. */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-16" />
      <StatGrid>
        {Array.from({ length: 4 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </StatGrid>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
    </div>
  );
}
