"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { MessageSquare, Paperclip, Plus } from "lucide-react";
import { toast } from "sonner";

import { branding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER, type TaskStatusValue } from "@/lib/validation/task";
import type { TaskSummary } from "@/server/repositories/task-repository";
import { AvatarGroup } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DueDateBadge, TaskPriorityBadge } from "@/components/tasks/task-meta";

/**
 * Kanban board with drag-and-drop between columns.
 *
 * Uses the native HTML drag-and-drop API rather than a library — the only
 * interaction needed is "move a card to another column", and the native API
 * costs no bundle size. Because native DnD is not keyboard-accessible, every
 * card also carries a status `<select>` in its menu on the detail page, so
 * moving a task never *requires* a pointer.
 *
 * The move is optimistic: the card jumps immediately and reverts if the PATCH
 * fails, which keeps the board feeling instant on a slow connection.
 */

const COLUMN_ACCENT: Record<TaskStatusValue, string> = {
  TODO: "bg-ink-muted",
  IN_PROGRESS: "bg-info",
  IN_REVIEW: "bg-brand",
  BLOCKED: "bg-critical",
  COMPLETED: "bg-success",
};

export function TaskBoard({ tasks: initialTasks }: { tasks: TaskSummary[] }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [tasks, setTasks] = React.useState(initialTasks);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [overColumn, setOverColumn] = React.useState<TaskStatusValue | null>(null);

  React.useEffect(() => setTasks(initialTasks), [initialTasks]);

  const byStatus = React.useMemo(() => {
    const map = new Map<TaskStatusValue, TaskSummary[]>();
    for (const status of TASK_STATUS_ORDER) map.set(status, []);
    for (const task of tasks) {
      map.get(task.status as TaskStatusValue)?.push(task);
    }
    return map;
  }, [tasks]);

  const move = async (taskId: string, status: TaskStatusValue) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task || task.status === status) return;

    const previous = tasks;
    setTasks((current) =>
      current.map((entry) =>
        entry.id === taskId
          ? { ...entry, status, progress: status === "COMPLETED" ? 100 : entry.progress }
          : entry,
      ),
    );

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, boardOrder: Date.now() }),
      });

      if (!response.ok) {
        const body = await response.json();
        setTasks(previous); // revert
        toast.error(body?.error?.message ?? "Couldn't move that task");
        return;
      }

      toast.success(`Moved to ${TASK_STATUS_LABELS[status]}`);
      router.refresh();
    } catch {
      setTasks(previous);
      toast.error("Network error", { description: "The task was not moved." });
    }
  };

  return (
    <div className="scrollbar-none -mx-3 flex gap-3 overflow-x-auto px-3 pb-2 sm:-mx-5 sm:px-5">
      {TASK_STATUS_ORDER.map((status) => {
        const columnTasks = byStatus.get(status) ?? [];
        const isOver = overColumn === status;

        return (
          <section
            key={status}
            aria-label={TASK_STATUS_LABELS[status]}
            onDragOver={(event) => {
              event.preventDefault();
              setOverColumn(status);
            }}
            onDragLeave={() => setOverColumn((current) => (current === status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOverColumn(null);
              const taskId = event.dataTransfer.getData("text/plain");
              if (taskId) void move(taskId, status);
            }}
            className={cn(
              "flex w-[17.5rem] shrink-0 flex-col rounded-2xl border p-2.5 transition-colors sm:w-[19rem]",
              isOver ? "border-brand bg-brand-soft/40" : "border-line bg-surface-2/40",
            )}
          >
            <header className="flex items-center justify-between gap-2 px-1.5 pb-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn("size-2 shrink-0 rounded-full", COLUMN_ACCENT[status])} aria-hidden />
                <h3 className="truncate text-sm font-semibold text-ink">
                  {TASK_STATUS_LABELS[status]}
                </h3>
                <span className="shrink-0 rounded-full bg-surface-3 px-1.5 text-[0.6875rem] tabular text-ink-muted">
                  {columnTasks.length}
                </span>
              </div>
              <Button variant="ghost" size="icon-xs" asChild aria-label={`Add task to ${TASK_STATUS_LABELS[status]}`}>
                <Link href={`/app/tasks/new?status=${status}`}>
                  <Plus aria-hidden />
                </Link>
              </Button>
            </header>

            <div className="flex min-h-[6rem] flex-col gap-2.5">
              {columnTasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-xs text-ink-muted">
                  Nothing here
                </p>
              ) : (
                columnTasks.map((task) => (
                  <motion.article
                    key={task.id}
                    layout={!reduceMotion}
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    draggable
                    onDragStart={(event) => {
                      // Framer types the handler as its own event; the native
                      // dataTransfer is what the drop target reads.
                      (event as unknown as React.DragEvent).dataTransfer.setData("text/plain", task.id);
                      setDraggingId(task.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    className={cn(
                      "group cursor-grab rounded-xl border border-line bg-surface-1 p-3.5 shadow-soft transition-shadow active:cursor-grabbing",
                      "hover:shadow-raised",
                      draggingId === task.id && "opacity-40",
                    )}
                  >
                    <Link
                      href={`/app/tasks/${task.id}`}
                      className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    >
                      <p className="font-mono text-[0.6875rem] text-ink-muted">
                        {branding.taskPrefix}-{task.reference}
                      </p>
                      <p className="mt-1 line-clamp-2-safe text-sm font-medium leading-snug text-ink">
                        {task.title}
                      </p>
                    </Link>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <TaskPriorityBadge priority={task.priority} size="sm" />
                      <DueDateBadge
                        dueDate={task.dueDate}
                        completed={task.status === "COMPLETED"}
                        size="sm"
                      />
                    </div>

                    {task.progress > 0 && task.status !== "COMPLETED" ? (
                      <div className="mt-3 flex items-center gap-2">
                        <Progress
                          value={task.progress}
                          barSize="sm"
                          label={`${task.title} progress`}
                        />
                        <span className="shrink-0 text-[0.6875rem] tabular text-ink-muted">
                          {task.progress}%
                        </span>
                      </div>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <AvatarGroup
                        size="xs"
                        max={3}
                        people={task.assignees.map((assignee) => ({
                          id: assignee.employee.id,
                          name: `${assignee.employee.firstName} ${assignee.employee.lastName}`,
                          avatarUrl: assignee.employee.avatarUrl,
                        }))}
                      />

                      <div className="flex shrink-0 items-center gap-2.5 text-[0.6875rem] text-ink-muted">
                        {task._count.comments > 0 ? (
                          <span className="flex items-center gap-1">
                            <MessageSquare className="size-3" aria-hidden />
                            {task._count.comments}
                          </span>
                        ) : null}
                        {task._count.attachments > 0 ? (
                          <span className="flex items-center gap-1">
                            <Paperclip className="size-3" aria-hidden />
                            {task._count.attachments}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </motion.article>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
