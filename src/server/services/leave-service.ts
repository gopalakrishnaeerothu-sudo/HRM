import "server-only";

import type { LeaveStatus, LeaveType } from "@/server/db/types";
import type { z } from "zod";

import { errors } from "@/lib/errors";
import { startOfUtcDay } from "@/lib/time";
import type { requestLeaveSchema, reviewLeaveSchema } from "@/lib/validation/attendance";
import type { AuthSession } from "@/server/auth/types";
import { hasPermission } from "@/server/auth/permissions";
import { leaveRepository, type LeaveRecord } from "@/server/repositories/leave-repository";
import { auditService } from "@/server/services/audit-service";
import { notificationService } from "@/server/services/notification-service";
import { resolveVisibleEmployeeIds, tenantScopeFor } from "@/server/services/access-service";

/**
 * Leave requests and approvals.
 *
 * Approved leave is not just a record — `attendanceRepository.findApprovedLeave`
 * consults it on every attendance computation, so approving a request
 * retroactively changes those days from ABSENT to ON_LEAVE. That coupling is
 * why approval is permission-gated and audited.
 */

type RequestInput = z.infer<typeof requestLeaveSchema>;
type ReviewInput = z.infer<typeof reviewLeaveSchema>;

export const leaveService = {
  /** The caller's own requests. */
  async listMine(session: AuthSession) {
    if (!session.employee) return [];

    return leaveRepository.listForEmployee(tenantScopeFor(session), session.employee.id);
  },

  /**
   * Requests awaiting the caller's decision, plus recently reviewed ones.
   * Bounded by the visibility envelope, so a manager sees only their own
   * people's requests.
   */
  async listForReview(session: AuthSession, status?: LeaveStatus) {
    if (!hasPermission(session.user.role, "leave:approve", session.permissionOverrides)) {
      return [];
    }

    const envelope = await resolveVisibleEmployeeIds(session);

    return leaveRepository.listForReview(tenantScopeFor(session), {
      employeeIds: envelope,
      status,
      // Never surface your own request for your own approval.
      excludeEmployeeId: session.employee?.id ?? null,
    });
  },

  /** Remaining balance per type, for the current calendar year. */
  async balances(session: AuthSession) {
    if (!session.employee) return [];

    const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));

    const takenByType = await leaveRepository.takenByType(
      tenantScopeFor(session),
      session.employee.id,
      yearStart,
    );

    // Entitlements are policy, not yet configurable per organisation — this is
    // the one place to change when they become a settings field.
    return DEFAULT_ENTITLEMENTS.map((entitlement) => ({
      type: entitlement.type,
      entitled: entitlement.days,
      taken: takenByType.get(entitlement.type) ?? 0,
      remaining: Math.max(0, entitlement.days - (takenByType.get(entitlement.type) ?? 0)),
    }));
  },

  async request(session: AuthSession, input: RequestInput) {
    const employee = session.employee;
    if (!employee) throw errors.forbidden("This account has no employee profile.");

    const scope = tenantScopeFor(session);

    // Overlapping requests are the most common data error here, and they make
    // the attendance lookup ambiguous — reject rather than pick one.
    const overlapping = await leaveRepository.findOverlapping(
      scope,
      employee.id,
      startOfUtcDay(input.startDate),
      startOfUtcDay(input.endDate),
    );

    if (overlapping) {
      throw errors.conflict("You already have leave requested or approved that overlaps these dates.");
    }

    const created = await leaveRepository.create(scope, {
      employeeId: employee.id,
      type: input.type,
      startDate: startOfUtcDay(input.startDate),
      endDate: startOfUtcDay(input.endDate),
      days: input.days,
      reason: input.reason,
    });

    await notificationService.leaveRequested(
      scope,
      employee.managerId,
      `${employee.firstName} ${employee.lastName}`,
      created.id,
    );

    return created;
  },

  async review(session: AuthSession, leaveId: string, input: ReviewInput) {
    const scope = tenantScopeFor(session);

    const leave = await leaveRepository.findById(scope, leaveId);
    if (!leave) throw errors.notFound("leave request");

    if (leave.status !== "PENDING") {
      throw errors.conflict("That request has already been decided.");
    }
    if (session.employee && leave.employee.id === session.employee.id) {
      throw errors.forbidden("You can't approve your own leave request.");
    }

    // The reviewer must be able to see this employee at all.
    const envelope = await resolveVisibleEmployeeIds(session);
    if (envelope !== null && !envelope.includes(leave.employee.id)) {
      throw errors.notFound("leave request");
    }

    // Guarded on status = PENDING inside the UPDATE, so two reviewers acting
    // at the same moment produce one decision and one 409 rather than a silent
    // last-write-wins.
    const decided = await leaveRepository.review(scope, leaveId, {
      status: input.decision,
      reviewerId: session.employee?.id ?? null,
      reviewNote: input.reviewNote ?? null,
    });

    if (!decided) throw errors.conflict("That request has already been decided.");

    const updated = await leaveRepository.requireById(scope, leaveId);

    await auditService.record(scope, session, {
      action: "UPDATE",
      entityType: "leaves",
      entityId: leaveId,
      summary: `${input.decision === "APPROVED" ? "Approved" : "Declined"} ${leave.employee.firstName} ${leave.employee.lastName}'s ${LEAVE_TYPE_SHORT[leave.type]} (${leave.days} ${leave.days === 1 ? "day" : "days"})`,
      changes: { status: { from: "PENDING", to: input.decision }, note: input.reviewNote ?? null },
    });

    await notificationService.leaveReviewed(
      scope,
      leave.employee.id,
      input.decision,
      session.user.name,
    );

    return updated;
  },

  /** Withdraw a pending request. Only the requester may do this. */
  async cancel(session: AuthSession, leaveId: string) {
    const employee = session.employee;
    if (!employee) throw errors.forbidden("This account has no employee profile.");

    const cancelled = await leaveRepository.cancelPending(
      tenantScopeFor(session),
      leaveId,
      employee.id,
    );

    if (!cancelled) throw errors.notFound("pending leave request");

    return { id: leaveId };
  },

  /** Approved leave overlapping a date range — used by the team calendar. */
  async upcomingForTeam(session: AuthSession, from: Date, to: Date) {
    const envelope = await resolveVisibleEmployeeIds(session);

    return leaveRepository.listApprovedInRange(tenantScopeFor(session), {
      employeeIds: envelope,
      from: startOfUtcDay(from),
      to: startOfUtcDay(to),
    });
  },
};

/**
 * Default annual entitlements. Not yet per-organisation configurable; when
 * they become a settings field, this constant is the only thing to replace.
 */
const DEFAULT_ENTITLEMENTS: Array<{ type: LeaveType; days: number }> = [
  { type: "CASUAL", days: 12 },
  { type: "SICK", days: 12 },
  { type: "EARNED", days: 15 },
  { type: "COMP_OFF", days: 5 },
];

const LEAVE_TYPE_SHORT: Record<LeaveType, string> = {
  CASUAL: "casual leave",
  SICK: "sick leave",
  EARNED: "earned leave",
  UNPAID: "unpaid leave",
  MATERNITY: "maternity leave",
  PATERNITY: "paternity leave",
  COMP_OFF: "comp off",
};

export type { LeaveRecord };
