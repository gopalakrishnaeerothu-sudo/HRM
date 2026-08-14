import Link from "next/link";
import { MessageSquare, Paperclip } from "lucide-react";

import { branding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import type { TaskSummary } from "@/server/repositories/task-repository";
import { AvatarGroup } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { DueDateBadge, TaskPriorityBadge, TaskStatusBadge } from "@/components/tasks/task-meta";

/**
 * One task in a list.
 *
 * The whole row is a link, with the meta chips inside it — a nested
 * interactive element would break keyboard navigation, so the chips are
 * presentational only.
 */
export function TaskListItem({ task, compact = false }: { task: TaskSummary; compact?: boolean }) {
  const assignees = task.assignees.map((assignee) => ({
    id: assignee.employee.id,
    name: `${assignee.employee.firstName} ${assignee.employee.lastName}`,
    avatarUrl: assignee.employee.avatarUrl,
  }));

  return (
    <li>
      <Link
        href={`/app/tasks/${task.id}`}
        className={cn(
          "flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface-2/60 sm:px-6",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50",
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="shrink-0 font-mono text-[0.6875rem] text-ink-muted">
                {branding.taskPrefix}-{task.reference}
              </span>
              <span className="line-clamp-2-safe text-sm font-medium leading-snug text-ink">
                {task.title}
              </span>
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <TaskStatusBadge status={task.status} size="sm" />
              <TaskPriorityBadge priority={task.priority} size="sm" />
              <DueDateBadge
                dueDate={task.dueDate}
                completed={task.status === "COMPLETED"}
                size="sm"
              />
              {task.team ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[0.6875rem] text-ink-muted">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: task.team.color }}
                    aria-hidden
                  />
                  {task.team.name}
                </span>
              ) : null}
            </div>
          </div>

          <AvatarGroup people={assignees} size="xs" max={3} className="shrink-0 pt-0.5" />
        </div>

        {!compact ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-[8rem] flex-1 items-center gap-2.5">
              <Progress
                value={task.progress}
                barSize="sm"
                tone={task.status === "COMPLETED" ? "success" : task.status === "BLOCKED" ? "critical" : "brand"}
                label={`${task.title} progress`}
              />
              <span className="shrink-0 text-[0.6875rem] tabular text-ink-muted">{task.progress}%</span>
            </div>

            <div className="flex shrink-0 items-center gap-3 text-[0.6875rem] text-ink-muted">
              {task._count.comments > 0 ? (
                <span className="flex items-center gap-1">
                  <MessageSquare className="size-3.5" aria-hidden />
                  {task._count.comments}
                  <span className="sr-only">comments</span>
                </span>
              ) : null}
              {task._count.attachments > 0 ? (
                <span className="flex items-center gap-1">
                  <Paperclip className="size-3.5" aria-hidden />
                  {task._count.attachments}
                  <span className="sr-only">attachments</span>
                </span>
              ) : null}
              {task._count.subtasks > 0 ? (
                <span>
                  {task._count.subtasks} subtask{task._count.subtasks === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </Link>
    </li>
  );
}
