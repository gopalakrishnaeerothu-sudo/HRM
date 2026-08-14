"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { fieldErrors } from "@/lib/validation/common";
import {
  createTaskSchema,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
} from "@/lib/validation/task";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/toggles";
import { Field, FieldGrid, FieldSection } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Create a task. Uses the same Zod schema the API validates against. */

const NONE = "__none__";

export function TaskForm({
  employees,
  teams,
  defaultStatus = "TODO",
}: {
  employees: Array<{ id: string; name: string; designation: string; avatarUrl: string | null }>;
  teams: Array<{ id: string; name: string; color: string }>;
  defaultStatus?: string;
}) {
  const router = useRouter();
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState(defaultStatus);
  const [priority, setPriority] = React.useState("MEDIUM");
  const [teamId, setTeamId] = React.useState(NONE);
  const [assigneeIds, setAssigneeIds] = React.useState<string[]>([]);
  const [ownerId, setOwnerId] = React.useState<string | null>(null);
  const [startDate, setStartDate] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [estimatedHours, setEstimatedHours] = React.useState("");
  const [tagInput, setTagInput] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);

  const toggleAssignee = (id: string) => {
    setAssigneeIds((current) => {
      const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
      // The owner must remain an assignee; drop the flag if they are removed.
      if (ownerId === id && !next.includes(id)) setOwnerId(null);
      if (next.length === 1 && ownerId === null) setOwnerId(next[0]);
      return next;
    });
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || tags.includes(tag) || tags.length >= 8) return;
    setTags((current) => [...current, tag]);
    setTagInput("");
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      assigneeIds,
      ownerId: ownerId ?? undefined,
      teamId: teamId === NONE ? null : teamId,
      startDate: startDate || undefined,
      dueDate: dueDate || undefined,
      estimatedHours: estimatedHours ? Number(estimatedHours) : undefined,
      progress: 0,
      tags,
    };

    const parsed = createTaskSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      toast.error("Please check the highlighted fields");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't create that task");
        return;
      }

      toast.success("Task created");
      router.push(`/app/tasks/${body.data.id}`);
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const firstError = (key: string) => errors[key]?.[0] ?? null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardContent className="flex flex-col gap-8 pt-6">
          <FieldSection title="What needs doing" description="Keep the title short and specific.">
            <FieldGrid columns={1}>
              <Field label="Title" required error={firstError("title")}>
                {(control) => (
                  <Input
                    {...control}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Ship the leave approval flow"
                    autoFocus
                  />
                )}
              </Field>

              <Field
                label="Description"
                optional
                hint="Context, acceptance criteria, links."
                error={firstError("description")}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={5}
                  />
                )}
              </Field>
            </FieldGrid>
          </FieldSection>

          <FieldSection title="Classification">
            <FieldGrid columns={3}>
              <Field label="Status" required error={firstError("status")}>
                {(control) => (
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger id={control.id}>
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
                )}
              </Field>

              <Field label="Priority" required error={firstError("priority")}>
                {(control) => (
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger id={control.id}>
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
                )}
              </Field>

              <Field label="Team" optional error={firstError("teamId")}>
                {(control) => (
                  <Select value={teamId} onValueChange={setTeamId}>
                    <SelectTrigger id={control.id}>
                      <SelectValue placeholder="No team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No team</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </FieldGrid>
          </FieldSection>

          <FieldSection title="Schedule">
            <FieldGrid columns={3}>
              <Field label="Start date" optional error={firstError("startDate")}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                )}
              </Field>

              <Field label="Due date" optional error={firstError("dueDate")}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                )}
              </Field>

              <Field label="Estimate (hours)" optional error={firstError("estimatedHours")}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={0}
                    step={0.5}
                    inputMode="decimal"
                    value={estimatedHours}
                    onChange={(event) => setEstimatedHours(event.target.value)}
                    placeholder="8"
                  />
                )}
              </Field>
            </FieldGrid>
          </FieldSection>

          <FieldSection
            title="Assignees"
            description="Pick who is doing the work. The first person selected becomes the accountable owner."
          >
            <div>
              {errors.assigneeIds || errors.ownerId ? (
                <p className="mb-2 text-xs text-critical">
                  {errors.assigneeIds?.[0] ?? errors.ownerId?.[0]}
                </p>
              ) : null}

              <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
                {employees.map((employee) => {
                  const selected = assigneeIds.includes(employee.id);
                  return (
                    <li key={employee.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-2">
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleAssignee(employee.id)}
                        />
                        <Avatar name={employee.name} src={employee.avatarUrl} size="xs" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{employee.name}</span>
                          <span className="block truncate text-[0.6875rem] text-ink-muted">
                            {employee.designation}
                          </span>
                        </span>
                        {selected && ownerId === employee.id ? (
                          <Badge tone="brand" size="sm">
                            Owner
                          </Badge>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </FieldSection>

          <FieldSection title="Tags" description="Up to eight, lower-cased automatically.">
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="frontend"
                  aria-label="Add a tag"
                  inputSize="sm"
                  className="max-w-xs"
                />
                <Button type="button" variant="secondary" size="sm" onClick={addTag}>
                  Add tag
                </Button>
              </div>

              {tags.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <li key={tag}>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pl-2.5 pr-1.5 text-xs text-ink-secondary">
                        #{tag}
                        <button
                          type="button"
                          onClick={() => setTags((current) => current.filter((entry) => entry !== tag))}
                          className="flex size-4 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
                          aria-label={`Remove tag ${tag}`}
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </FieldSection>
        </CardContent>
      </Card>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.back()} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          Create task
        </Button>
      </div>
    </form>
  );
}
