import { AlertOctagon, ArrowDown, ArrowUp, CircleDot, Flame, Minus } from "lucide-react";

import type { TaskPriorityValue, TaskStatusValue } from "@/lib/validation/task";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/validation/task";
import { Badge } from "@/components/ui/badge";

/**
 * Status and priority chips.
 *
 * Each carries an icon *and* a word, so neither meaning depends on colour —
 * which matters here because urgent-red and blocked-red are adjacent hues.
 */

const STATUS_TONE = {
  TODO: "neutral",
  IN_PROGRESS: "info",
  IN_REVIEW: "brand",
  BLOCKED: "critical",
  COMPLETED: "success",
} as const;

const PRIORITY_META = {
  URGENT: { tone: "critical", icon: Flame },
  HIGH: { tone: "warning", icon: ArrowUp },
  MEDIUM: { tone: "info", icon: Minus },
  LOW: { tone: "neutral", icon: ArrowDown },
} as const;

export function TaskStatusBadge({ status, size = "md" }: { status: TaskStatusValue; size?: "sm" | "md" }) {
  const Icon = status === "BLOCKED" ? AlertOctagon : CircleDot;
  return (
    <Badge tone={STATUS_TONE[status]} size={size}>
      <Icon aria-hidden />
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TaskPriorityBadge({
  priority,
  size = "md",
}: {
  priority: TaskPriorityValue;
  size?: "sm" | "md";
}) {
  const meta = PRIORITY_META[priority];
  return (
    <Badge tone={meta.tone} size={size}>
      <meta.icon aria-hidden />
      {TASK_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

/** Due-date chip that turns critical once the date has passed. */
export function DueDateBadge({
  dueDate,
  completed,
  size = "md",
}: {
  dueDate: Date | null;
  completed: boolean;
  size?: "sm" | "md";
}) {
  if (!dueDate) return null;

  const now = new Date();
  const overdue = !completed && dueDate < now;
  const dueSoon =
    !completed && !overdue && dueDate.getTime() - now.getTime() < 2 * 24 * 60 * 60 * 1000;

  const label = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(dueDate);

  return (
    <Badge tone={overdue ? "critical" : dueSoon ? "warning" : "outline"} size={size}>
      {/* The word carries the state; the colour only reinforces it. */}
      {overdue ? "Overdue" : dueSoon ? "Due" : "Due"} {label}
    </Badge>
  );
}

export const TASK_STATUS_TONE = STATUS_TONE;
