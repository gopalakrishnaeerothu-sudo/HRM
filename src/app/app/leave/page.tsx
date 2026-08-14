import type { Metadata } from "next";

import { can, requireSession } from "@/server/auth";
import { leaveService } from "@/server/services/leave-service";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { LeaveWorkspace } from "@/components/leave/leave-workspace";

export const metadata: Metadata = { title: "Leave" };

/**
 * Leave requests and approvals.
 *
 * Approving here is not just a status change: `findApprovedLeave` is consulted
 * on every attendance computation, so an approval retroactively turns those
 * days from ABSENT into ON_LEAVE.
 */
export default async function LeavePage() {
  const session = await requireSession();
  const canApprove = can(session, "leave:approve");

  const [myRequests, pendingReviews, balances] = await Promise.all([
    leaveService.listMine(session),
    canApprove ? leaveService.listForReview(session) : Promise.resolve([]),
    leaveService.balances(session),
  ]);

  return (
    <>
      <PageHeader
        title="Leave"
        description={
          canApprove
            ? "Your own requests, and decisions waiting on you."
            : "Request time off and track its approval."
        }
      />

      <PageBody>
        <LeaveWorkspace
          myRequests={myRequests}
          pendingReviews={pendingReviews}
          balances={balances}
          canApprove={canApprove}
        />
      </PageBody>
    </>
  );
}
