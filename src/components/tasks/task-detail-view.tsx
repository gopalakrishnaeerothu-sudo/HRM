"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Timer,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { branding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatRelative } from "@/lib/time";
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  type TaskPriorityValue,
  type TaskStatusValue,
} from "@/lib/validation/task";
import type { TaskDetail } from "@/server/repositories/task-repository";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/toggles";
import { Input, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DueDateBadge, TaskPriorityBadge, TaskStatusBadge } from "@/components/tasks/task-meta";

/**
 * Task detail.
 *
 * Status, priority and progress are editable in place. Each edit PATCHes the
 * task and the server appends an activity entry, which is why the timeline
 * below is a faithful history rather than a UI-side log — it is reconstructed
 * from the database, not from what this component happened to do.
 */

const ACTIVITY_TONE: Record<string, string> = {
  CREATED: "bg-brand",
  STATUS_CHANGED: "bg-info",
  PRIORITY_CHANGED: "bg-warning",
  ASSIGNED: "bg-brand",
  PROGRESS_UPDATED: "bg-info",
  COMMENTED: "bg-ink-muted",
  COMPLETED: "bg-success",
  SUBTASK_ADDED: "bg-ink-muted",
  SUBTASK_COMPLETED: "bg-success",
  DUE_DATE_CHANGED: "bg-warning",
};

export function TaskDetailView({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [newSubtask, setNewSubtask] = React.useState("");
  const [progress, setProgress] = React.useState(task.progress);

  React.useEffect(() => setProgress(task.progress), [task.progress]);

  const patch = async (payload: Record<string, unknown>, successMessage: string) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        toast.error(body?.error?.message ?? "Couldn't save that change");
        return false;
      }
      toast.success(successMessage);
      router.refresh();
      return true;
    } catch {
      toast.error("Network error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = comment.trim();
    if (body.length === 0) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload?.error?.message ?? "Couldn't post that comment");
        return;
      }
      setComment("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const addSubtask = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = newSubtask.trim();
    if (title.length === 0) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/subtasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        toast.error("Couldn't add that subtask");
        return;
      }
      setNewSubtask("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const toggleSubtask = async (subtaskId: string, isCompleted: boolean) => {
    await fetch(`/api/tasks/${task.id}/subtasks`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subtaskId, isCompleted }),
    });
    router.refresh();
  };

  const completedSubtasks = task.subtasks.filter((subtask) => subtask.isCompleted).length;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="font-mono text-xs text-ink-muted">
              {branding.taskPrefix}-{task.reference}
            </p>
            <h2 className="mt-1.5 text-xl font-semibold leading-tight tracking-tight text-ink sm:text-2xl">
              {task.title}
            </h2>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <TaskStatusBadge status={task.status as TaskStatusValue} />
              <TaskPriorityBadge priority={task.priority as TaskPriorityValue} />
              <DueDateBadge dueDate={task.dueDate} completed={task.status === "COMPLETED"} />
              {task.team ? (
                <Badge tone="outline">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: task.team.color }}
                    aria-hidden
                  />
                  {task.team.name}
                </Badge>
              ) : null}
              {task.tags.map((tag) => (
                <Badge key={tag} tone="neutral" size="sm">
                  #{tag}
                </Badge>
              ))}
            </div>

            {task.description ? (
              <div className="mt-6 border-t border-line pt-5">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">
                  {task.description}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader compact>
            <CardTitle>
              Subtasks{" "}
              {task.subtasks.length > 0 ? (
                <span className="ml-1 text-sm font-normal tabular text-ink-muted">
                  {completedSubtasks}/{task.subtasks.length}
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent compact>
            {task.subtasks.length > 0 ? (
              <ul className="mb-4 flex flex-col gap-1">
                {task.subtasks.map((subtask) => (
                  <li key={subtask.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                      <Checkbox
                        checked={subtask.isCompleted}
                        onCheckedChange={(checked) => void toggleSubtask(subtask.id, checked === true)}
                        disabled={!canEdit}
                        className="mt-0.5"
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm",
                          subtask.isCompleted ? "text-ink-muted line-through" : "text-ink",
                        )}
                      >
                        {subtask.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}

            {canEdit ? (
              <form onSubmit={addSubtask} className="flex gap-2">
                <Input
                  value={newSubtask}
                  onChange={(event) => setNewSubtask(event.target.value)}
                  placeholder="Add a subtask…"
                  inputSize="sm"
                  aria-label="New subtask"
                />
                <Button type="submit" variant="secondary" size="sm" disabled={!newSubtask.trim()}>
                  <Plus aria-hidden />
                  Add
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader compact>
            <CardTitle>
              <span className="flex items-center gap-2">
                <MessageSquare className="size-4 text-ink-muted" aria-hidden />
                Comments
                <span className="text-sm font-normal tabular text-ink-muted">
                  {task.comments.length}
                </span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent compact>
            {task.comments.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">
                No comments yet. Start the conversation.
              </p>
            ) : (
              <ul className="mb-5 flex flex-col gap-5">
                {task.comments.map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <Avatar
                      name={
                        entry.author
                          ? `${entry.author.firstName} ${entry.author.lastName}`
                          : "Unknown"
                      }
                      src={entry.author?.avatarUrl}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="text-sm font-medium text-ink">
                          {entry.author
                            ? `${entry.author.firstName} ${entry.author.lastName}`
                            : "Removed user"}
                        </p>
                        <p className="text-[0.6875rem] text-ink-muted">
                          {formatRelative(entry.createdAt)}
                        </p>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">
                        {entry.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={submitComment} className="flex flex-col gap-2">
              <Textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Write a comment…"
                rows={3}
                aria-label="New comment"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={saving} disabled={!comment.trim()}>
                  <Send aria-hidden />
                  Comment
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Sidebar: properties and the activity timeline. */}
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader compact>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent compact className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">
                Status
              </p>
              <Select
                value={task.status}
                disabled={!canEdit || saving}
                onValueChange={(value) =>
                  void patch({ status: value }, `Moved to ${TASK_STATUS_LABELS[value as TaskStatusValue]}`)
                }
              >
                <SelectTrigger triggerSize="sm" aria-label="Task status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUS_ORDER.map((value) => (
                    <SelectItem key={value} value={value}>
                      {TASK_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">
                Priority
              </p>
              <Select
                value={task.priority}
                disabled={!canEdit || saving}
                onValueChange={(value) => void patch({ priority: value }, "Priority updated")}
              >
                <SelectTrigger triggerSize="sm" aria-label="Task priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">
                  Progress
                </p>
                <p className="text-xs tabular text-ink-secondary">{progress}%</p>
              </div>
              <Progress
                value={progress}
                tone={task.status === "COMPLETED" ? "success" : "brand"}
                label="Task progress"
              />
              {canEdit ? (
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={progress}
                  onChange={(event) => setProgress(Number(event.target.value))}
                  onPointerUp={() => {
                    if (progress !== task.progress) void patch({ progress }, "Progress updated");
                  }}
                  aria-label="Set progress"
                  className="mt-2 w-full accent-[var(--brand)]"
                />
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <Meta icon={Users} label="Assignees">
                {task.assignees.length > 0 ? (
                  <AvatarGroup
                    size="xs"
                    people={task.assignees.map((assignee) => ({
                      id: assignee.employee.id,
                      name: `${assignee.employee.firstName} ${assignee.employee.lastName}`,
                      avatarUrl: assignee.employee.avatarUrl,
                    }))}
                  />
                ) : (
                  <span className="text-sm text-ink-muted">Unassigned</span>
                )}
              </Meta>

              <Meta icon={CalendarClock} label="Due">
                <span className="text-sm text-ink">
                  {task.dueDate ? formatDate(task.dueDate) : "No due date"}
                </span>
              </Meta>

              <Meta icon={Timer} label="Estimate">
                <span className="text-sm text-ink">
                  {task.estimatedHours ? `${task.estimatedHours} h` : "—"}
                  {(task.actualHours ?? 0) > 0 ? (
                    <span className="text-ink-muted"> · {task.actualHours} h logged</span>
                  ) : null}
                </span>
              </Meta>

              <Meta icon={Clock} label="Created">
                <span className="text-sm text-ink">{formatDate(task.createdAt)}</span>
              </Meta>

              {task.creator ? (
                <Meta icon={CheckCircle2} label="Created by">
                  <Link
                    href={`/app/employees/${task.creator.id}`}
                    className="text-sm text-brand hover:underline"
                  >
                    {task.creator.firstName} {task.creator.lastName}
                  </Link>
                </Meta>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader compact>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent compact>
            {task.activities.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">No activity recorded.</p>
            ) : (
              <ol className="relative flex flex-col gap-4 pl-5">
                {/* Vertical rail behind the dots. */}
                <span
                  className="absolute bottom-2 left-[0.3125rem] top-2 w-px bg-line"
                  aria-hidden
                />
                {task.activities.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span
                      className={cn(
                        "absolute -left-5 top-1.5 size-2.5 rounded-full ring-2 ring-surface-1",
                        ACTIVITY_TONE[entry.type] ?? "bg-ink-muted",
                      )}
                      aria-hidden
                    />
                    <p className="text-xs leading-relaxed text-ink">
                      <span className="font-medium">
                        {entry.actor ? entry.actor.firstName : "Someone"}
                      </span>{" "}
                      {entry.message}
                    </p>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-muted">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {task.attachments.length > 0 ? (
          <Card>
            <CardHeader compact>
              <CardTitle>
                <span className="flex items-center gap-2">
                  <Paperclip className="size-4 text-ink-muted" aria-hidden />
                  Attachments
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent compact>
              <ul className="flex flex-col gap-2">
                {task.attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2"
                  >
                    <Paperclip className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">
                      {attachment.fileName}
                    </span>
                    <span className="shrink-0 text-[0.6875rem] tabular text-ink-muted">
                      {Math.round(attachment.fileSize / 1024)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />
      <span className="w-20 shrink-0 text-[0.6875rem] text-ink-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
