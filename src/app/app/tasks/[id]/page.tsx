import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { branding } from "@/lib/branding";
import { isAppError } from "@/lib/errors";
import { can, requirePermission } from "@/server/auth";
import { taskService } from "@/server/services/task-service";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { TaskDetailView } from "@/components/tasks/task-detail-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requirePermission("task:read");
  const { id } = await params;
  try {
    const task = await taskService.detail(session, id);
    return { title: `${branding.taskPrefix}-${task.reference} · ${task.title}` };
  } catch {
    return { title: "Task" };
  }
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("task:read");
  const { id } = await params;

  let task;
  try {
    task = await taskService.detail(session, id);
  } catch (error) {
    // The service returns NOT_FOUND for both "no such task" and "not yours",
    // so a foreign id is indistinguishable from a missing one.
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const isParticipant =
    session.employee !== null &&
    (task.creator?.id === session.employee.id ||
      task.assignees.some((assignee) => assignee.employee.id === session.employee!.id));

  const canEdit = isParticipant || can(session, "task:update:any");

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Tasks", href: "/app/tasks" },
          { label: `${branding.taskPrefix}-${task.reference}` },
        ]}
        title={task.title}
        description={
          canEdit
            ? "Changes here are appended to the task's activity timeline."
            : "You have read-only access to this task."
        }
      />
      <PageBody>
        <TaskDetailView task={task} canEdit={canEdit} />
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
