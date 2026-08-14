import { z } from "zod";

import {
  optionalDateSchema,
  optionalText,
  paginationSchema,
  searchSchema,
  text,
  uuidSchema,
} from "@/lib/validation/common";

export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "COMPLETED", "BLOCKED"]);
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export type TaskStatusValue = z.infer<typeof taskStatusSchema>;
export type TaskPriorityValue = z.infer<typeof taskPrioritySchema>;

export const createTaskSchema = z
  .object({
    title: text("Title", 160),
    description: optionalText(4000),
    status: taskStatusSchema.default("TODO"),
    priority: taskPrioritySchema.default("MEDIUM"),
    assigneeIds: z.array(uuidSchema).max(10, "A task can have at most 10 assignees").default([]),
    /** The accountable assignee; must appear in `assigneeIds`. */
    ownerId: uuidSchema.optional().nullable(),
    teamId: uuidSchema.optional().nullable(),
    startDate: optionalDateSchema,
    dueDate: optionalDateSchema,
    estimatedHours: z.number().min(0).max(2000).optional().nullable(),
    progress: z.number().int().min(0).max(100).default(0),
    tags: z
      .array(z.string().trim().min(1).max(24))
      .max(8, "Up to 8 tags")
      .default([])
      .transform((tags) => Array.from(new Set(tags.map((tag) => tag.toLowerCase())))),
  })
  .refine((data) => !data.startDate || !data.dueDate || data.dueDate >= data.startDate, {
    message: "Due date cannot be before the start date",
    path: ["dueDate"],
  })
  .refine((data) => !data.ownerId || data.assigneeIds.includes(data.ownerId), {
    message: "The task owner must also be an assignee",
    path: ["ownerId"],
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: text("Title", 160).optional(),
  description: optionalText(4000).nullable(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeIds: z.array(uuidSchema).max(10).optional(),
  ownerId: uuidSchema.nullable().optional(),
  teamId: uuidSchema.nullable().optional(),
  startDate: optionalDateSchema.nullable(),
  dueDate: optionalDateSchema.nullable(),
  estimatedHours: z.number().min(0).max(2000).nullable().optional(),
  actualHours: z.number().min(0).max(2000).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  /** Kanban drag: new column plus fractional position within it. */
  boardOrder: z.number().optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskQuerySchema = paginationSchema.extend({
  search: searchSchema,
  status: z.union([taskStatusSchema, z.array(taskStatusSchema)]).optional(),
  priority: z.union([taskPrioritySchema, z.array(taskPrioritySchema)]).optional(),
  assigneeId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  creatorId: uuidSchema.optional(),
  /** "mine" restricts to the caller's own assignments, resolved server-side. */
  scope: z.enum(["all", "mine", "team", "created"]).default("all"),
  overdue: z.coerce.boolean().optional(),
  dueBefore: optionalDateSchema,
  dueAfter: optionalDateSchema,
  sortBy: z.enum(["dueDate", "priority", "createdAt", "title", "status"]).default("dueDate"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type TaskQuery = z.infer<typeof taskQuerySchema>;

export const createCommentSchema = z.object({
  body: text("Comment", 4000),
});

export const createSubtaskSchema = z.object({
  title: text("Subtask", 160),
});

export const toggleSubtaskSchema = z.object({
  isCompleted: z.boolean(),
});

// --- Presentation metadata --------------------------------------------------

export const TASK_STATUS_LABELS: Record<TaskStatusValue, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriorityValue, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

/** Column order for the kanban board and every status breakdown. */
export const TASK_STATUS_ORDER: TaskStatusValue[] = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "COMPLETED",
];

export const TASK_PRIORITY_ORDER: TaskPriorityValue[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

/**
 * Progress implied by a status change, applied only when the user did not set
 * a progress value explicitly. Keeps the two fields from contradicting.
 */
export const STATUS_IMPLIED_PROGRESS: Record<TaskStatusValue, number | null> = {
  TODO: 0,
  IN_PROGRESS: null, // whatever the user reports
  IN_REVIEW: null,
  BLOCKED: null,
  COMPLETED: 100,
};
