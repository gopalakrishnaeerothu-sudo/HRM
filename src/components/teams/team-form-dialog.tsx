"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { fieldErrors } from "@/lib/validation/common";
import { createTeamSchema } from "@/lib/validation/organization";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/toggles";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Create or edit a team.
 *
 * The copy notes what membership actually does: a manager's visibility
 * envelope includes the members of teams they manage, so this dialog is
 * granting access, not just grouping people.
 */

const NONE = "__none__";

const COLOR_CHOICES = [
  "#4f46e5",
  "#0ea5e9",
  "#1baf7a",
  "#eb6834",
  "#e87ba4",
  "#eda100",
  "#8b5cf6",
  "#e34948",
];

export interface TeamFormOptions {
  employees: Array<{ id: string; name: string; designation: string; avatarUrl: string | null }>;
  departments: Array<{ id: string; name: string }>;
}

export function TeamFormDialog({
  teamId,
  initial,
  options,
  trigger,
}: {
  teamId?: string;
  initial?: {
    name: string;
    description: string;
    color: string;
    departmentId: string | null;
    managerId: string | null;
    memberIds: string[];
  };
  options: TeamFormOptions;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [color, setColor] = React.useState(initial?.color ?? COLOR_CHOICES[0]);
  const [departmentId, setDepartmentId] = React.useState(initial?.departmentId ?? NONE);
  const [managerId, setManagerId] = React.useState(initial?.managerId ?? NONE);
  const [memberIds, setMemberIds] = React.useState<string[]>(initial?.memberIds ?? []);
  const [filter, setFilter] = React.useState("");

  const toggleMember = (id: string) => {
    setMemberIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const visibleEmployees = React.useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return options.employees;
    return options.employees.filter(
      (employee) =>
        employee.name.toLowerCase().includes(term) ||
        employee.designation.toLowerCase().includes(term),
    );
  }, [filter, options.employees]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      departmentId: departmentId === NONE ? null : departmentId,
      // The manager is always a member — otherwise they would manage a team
      // they cannot see.
      managerId: managerId === NONE ? null : managerId,
      memberIds:
        managerId !== NONE && !memberIds.includes(managerId) ? [...memberIds, managerId] : memberIds,
    };

    const parsed = createTeamSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(teamId ? `/api/teams/${teamId}` : "/api/teams", {
        method: teamId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't save that team");
        return;
      }

      toast.success(teamId ? "Team updated" : "Team created");
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const firstError = (key: string) => errors[key]?.[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus aria-hidden />
            New team
          </Button>
        )}
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{teamId ? "Edit team" : "New team"}</DialogTitle>
          <DialogDescription>
            A team&apos;s manager can see its members&apos; attendance and tasks, so membership
            grants visibility as well as grouping people.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate>
          <DialogBody className="flex flex-col gap-5">
            <FieldGrid>
              <Field label="Team name" required error={firstError("name")}>
                {(control) => (
                  <Input
                    {...control}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Frontend Team"
                  />
                )}
              </Field>

              <Field label="Department" optional error={firstError("departmentId")}>
                {(control) => (
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger id={control.id}>
                      <SelectValue placeholder="No department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No department</SelectItem>
                      {options.departments.map((department) => (
                        <SelectItem key={department.id} value={department.id}>
                          {department.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </FieldGrid>

            <Field label="Description" optional error={firstError("description")}>
              {(control) => (
                <Textarea
                  {...control}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={2}
                  placeholder="What this team owns."
                />
              )}
            </Field>

            <Field label="Manager" optional error={firstError("managerId")}>
              {(control) => (
                <Select value={managerId} onValueChange={setManagerId}>
                  <SelectTrigger id={control.id}>
                    <SelectValue placeholder="No manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No manager</SelectItem>
                    {options.employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name} — {employee.designation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <div>
              <p className="mb-2 text-sm font-medium text-ink-secondary">Colour</p>
              <div className="flex flex-wrap gap-2">
                {COLOR_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setColor(choice)}
                    aria-label={`Colour ${choice}`}
                    aria-pressed={color === choice}
                    className={`size-8 rounded-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                      color === choice
                        ? "ring-2 ring-ink ring-offset-2 ring-offset-[var(--surface-1)]"
                        : "hover:scale-110"
                    }`}
                    style={{ background: choice }}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-secondary">
                  Members
                  {memberIds.length > 0 ? (
                    <Badge tone="brand" size="sm" className="ml-2">
                      {memberIds.length}
                    </Badge>
                  ) : null}
                </p>
                <Input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter people…"
                  inputSize="sm"
                  aria-label="Filter people"
                  className="max-w-48"
                />
              </div>

              {errors.memberIds ? (
                <p className="mb-2 text-xs text-critical">{errors.memberIds[0]}</p>
              ) : null}

              <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
                {visibleEmployees.length === 0 ? (
                  <li className="col-span-full py-6 text-center text-sm text-ink-muted">
                    Nobody matched “{filter}”.
                  </li>
                ) : (
                  visibleEmployees.map((employee) => (
                    <li key={employee.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-2">
                        <Checkbox
                          checked={memberIds.includes(employee.id)}
                          onCheckedChange={() => toggleMember(employee.id)}
                        />
                        <Avatar name={employee.name} src={employee.avatarUrl} size="xs" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{employee.name}</span>
                          <span className="block truncate text-[0.6875rem] text-ink-muted">
                            {employee.designation}
                          </span>
                        </span>
                        {managerId === employee.id ? (
                          <Badge tone="brand" size="sm">
                            Manager
                          </Badge>
                        ) : null}
                      </label>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <UsersRound aria-hidden />
              {teamId ? "Save team" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
