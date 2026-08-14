import "server-only";

import type { NotificationType } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { AuthSession } from "@/server/auth/types";
import { notificationRepository } from "@/server/repositories/org-repository";
import type { TaskDetail, TaskSummary } from "@/server/repositories/task-repository";
import type { TenantScope } from "@/server/repositories/tenant";

/**
 * Notification fan-out.
 *
 * Only the IN_APP channel is delivered today. EMAIL and PUSH rows are written
 * with `sentAt` left null, so a future transport worker can pick them up by
 * querying `WHERE channel != 'IN_APP' AND sentAt IS NULL` without any schema
 * change or backfill. `deliver()` is the single seam where that worker hooks
 * in — see the note there.
 */

/** Map employee ids to the user accounts that should receive a notification. */
async function usersForEmployees(
  scope: TenantScope,
  employeeIds: readonly string[],
): Promise<Array<{ userId: string; employeeId: string }>> {
  if (employeeIds.length === 0) return [];

  const rows = await prisma.employee.findMany({
    where: {
      id: { in: [...employeeIds] },
      organizationId: scope.organizationId,
      deletedAt: null,
      userId: { not: null },
    },
    select: { id: true, userId: true },
  });

  return rows.flatMap((row) => (row.userId ? [{ userId: row.userId, employeeId: row.id }] : []));
}

interface DeliverInput {
  type: NotificationType;
  title: string;
  body: string;
  linkUrl?: string;
  /** Recipients as employee ids; resolved to user accounts here. */
  employeeIds: readonly string[];
  /** Never notify someone about their own action. */
  excludeUserId?: string | null;
}

async function deliver(scope: TenantScope, input: DeliverInput): Promise<void> {
  const recipients = await usersForEmployees(scope, input.employeeIds);
  const targets = recipients.filter((recipient) => recipient.userId !== input.excludeUserId);
  if (targets.length === 0) return;

  await notificationRepository.createMany(
    scope,
    targets.map((target) => ({
      userId: target.userId,
      type: input.type,
      channel: "IN_APP" as const,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl ?? null,
    })),
  );

  // Email/push transports plug in here. Rows for those channels would be
  // written alongside the IN_APP ones with sentAt null and picked up by a
  // worker; nothing in the calling code changes.
}

export const notificationService = {
  async taskAssigned(
    scope: TenantScope,
    task: TaskSummary | TaskDetail,
    assigneeIds: readonly string[],
    session: AuthSession,
  ) {
    await deliver(scope, {
      type: "TASK_ASSIGNED",
      title: "New task assigned",
      body: `${session.user.name} assigned you “${task.title}”.`,
      linkUrl: `/app/tasks/${task.id}`,
      employeeIds: assigneeIds,
      excludeUserId: session.user.id,
    });
  },

  async taskCommented(
    scope: TenantScope,
    task: TaskDetail,
    authorEmployeeId: string | null,
    session: AuthSession,
  ) {
    const participants = new Set<string>(task.assignees.map((assignee) => assignee.employee.id));
    if (task.creator) participants.add(task.creator.id);
    if (authorEmployeeId) participants.delete(authorEmployeeId);

    await deliver(scope, {
      type: "TASK_COMMENT",
      title: "New comment",
      body: `${session.user.name} commented on “${task.title}”.`,
      linkUrl: `/app/tasks/${task.id}`,
      employeeIds: Array.from(participants),
      excludeUserId: session.user.id,
    });
  },

  async leaveRequested(scope: TenantScope, managerEmployeeId: string | null, requesterName: string, leaveId: string) {
    if (!managerEmployeeId) return;
    await deliver(scope, {
      type: "LEAVE_REQUESTED",
      title: "Leave request",
      body: `${requesterName} requested leave and needs your approval.`,
      linkUrl: `/app/leave/${leaveId}`,
      employeeIds: [managerEmployeeId],
    });
  },

  async leaveReviewed(
    scope: TenantScope,
    employeeId: string,
    decision: "APPROVED" | "REJECTED",
    reviewerName: string,
  ) {
    await deliver(scope, {
      type: decision === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
      title: decision === "APPROVED" ? "Leave approved" : "Leave declined",
      body: `${reviewerName} ${decision === "APPROVED" ? "approved" : "declined"} your leave request.`,
      linkUrl: "/app/attendance/my",
      employeeIds: [employeeId],
    });
  },

  /** HR announcement to every employee with a user account. */
  async broadcast(scope: TenantScope, session: AuthSession, title: string, body: string, linkUrl?: string) {
    const employees = await prisma.employee.findMany({
      where: { organizationId: scope.organizationId, deletedAt: null, userId: { not: null } },
      select: { id: true },
    });

    await deliver(scope, {
      type: "ANNOUNCEMENT",
      title,
      body,
      linkUrl,
      employeeIds: employees.map((employee) => employee.id),
      excludeUserId: session.user.id,
    });

    return { recipients: employees.length };
  },

  async listForSession(session: AuthSession, limit = 30) {
    const scope: TenantScope = { organizationId: session.organization.id };
    const [items, unread] = await Promise.all([
      notificationRepository.listForUser(scope, session.user.id, limit),
      notificationRepository.countUnread(scope, session.user.id),
    ]);
    return { items, unread };
  },

  async markRead(session: AuthSession, notificationId: string) {
    const scope: TenantScope = { organizationId: session.organization.id };
    return notificationRepository.markRead(scope, session.user.id, notificationId);
  },

  async markAllRead(session: AuthSession) {
    const scope: TenantScope = { organizationId: session.organization.id };
    return notificationRepository.markAllRead(scope, session.user.id);
  },
};

export const NOTIFICATION_ICON_TONE: Record<NotificationType, "brand" | "success" | "warning" | "critical" | "info"> = {
  TASK_ASSIGNED: "brand",
  TASK_DUE_SOON: "warning",
  TASK_OVERDUE: "critical",
  TASK_COMPLETED: "success",
  TASK_COMMENT: "info",
  ATTENDANCE_REMINDER: "info",
  LATE_ARRIVAL: "warning",
  MISSED_CHECKOUT: "warning",
  LEAVE_REQUESTED: "brand",
  LEAVE_APPROVED: "success",
  LEAVE_REJECTED: "critical",
  ANNOUNCEMENT: "brand",
  GEOFENCE_ALERT: "critical",
};
