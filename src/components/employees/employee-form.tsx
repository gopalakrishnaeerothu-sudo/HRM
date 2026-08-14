"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { clockToMinutes, minutesToClock } from "@/lib/utils";
import {
  createEmployeeSchema,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
} from "@/lib/validation/employee";
import { fieldErrors } from "@/lib/validation/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGrid, FieldSection, FieldSpan } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/toggles";

/**
 * Create / edit employee.
 *
 * Validation runs the *same* Zod schema the API uses, so the inline messages a
 * user sees are exactly the rules the server will apply — and the server still
 * re-validates, because a client check is a convenience, not a guarantee.
 *
 * Every row is a `Field`, which owns the label/control/message stack; no
 * spacing is hand-rolled here, which is what keeps the two columns aligned.
 */

export interface EmployeeFormOptions {
  departments: Array<{ id: string; name: string }>;
  offices: Array<{ id: string; name: string; city: string }>;
  managers: Array<{ id: string; name: string; designation: string }>;
}

export interface EmployeeFormValues {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  designation: string;
  bio: string;
  departmentId: string;
  managerId: string;
  primaryOfficeId: string;
  employmentType: string;
  status: string;
  joinedAt: string;
  shiftStart: string;
  shiftEnd: string;
  avatarUrl: string;
}

const NONE = "__none__";

const EMPTY: EmployeeFormValues = {
  employeeCode: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  designation: "",
  bio: "",
  departmentId: NONE,
  managerId: NONE,
  primaryOfficeId: NONE,
  employmentType: "FULL_TIME",
  status: "ACTIVE",
  joinedAt: new Date().toISOString().slice(0, 10),
  shiftStart: "",
  shiftEnd: "",
  avatarUrl: "",
};

export function EmployeeForm({
  options,
  initialValues,
  employeeId,
}: {
  options: EmployeeFormOptions;
  initialValues?: Partial<EmployeeFormValues>;
  /** Present for edit; absent for create. */
  employeeId?: string;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState<EmployeeFormValues>({ ...EMPTY, ...initialValues });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const set = <K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    // Clear the field's error as soon as the user edits it, rather than making
    // them resubmit to find out whether they fixed it.
    setErrors((previous) => {
      if (!previous[key as string]) return previous;
      const next = { ...previous };
      delete next[key as string];
      return next;
    });
  };

  const toPayload = () => ({
    employeeCode: values.employeeCode.trim(),
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    email: values.email.trim(),
    phone: values.phone.trim() || undefined,
    designation: values.designation.trim(),
    bio: values.bio.trim() || undefined,
    avatarUrl: values.avatarUrl.trim() || undefined,
    departmentId: values.departmentId === NONE ? null : values.departmentId,
    managerId: values.managerId === NONE ? null : values.managerId,
    primaryOfficeId: values.primaryOfficeId === NONE ? null : values.primaryOfficeId,
    employmentType: values.employmentType,
    status: values.status,
    joinedAt: values.joinedAt,
    shiftStartMinutes: values.shiftStart ? clockToMinutes(values.shiftStart) : null,
    shiftEndMinutes: values.shiftEnd ? clockToMinutes(values.shiftEnd) : null,
  });

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    const payload = toPayload();

    // Client-side pass first, so obvious mistakes never leave the browser.
    if (!employeeId) {
      const parsed = createEmployeeSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        toast.error("Please check the highlighted fields");
        return;
      }
    }

    setSubmitting(true);
    try {
      const response = await fetch(employeeId ? `/api/employees/${employeeId}` : "/api/employees", {
        method: employeeId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't save this employee");
        return;
      }

      toast.success(employeeId ? "Employee updated" : "Employee created");
      router.push(`/app/employees/${body.data.id}`);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  };

  const firstError = (key: keyof EmployeeFormValues | string) => errors[key as string]?.[0] ?? null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardContent className="flex flex-col gap-8 pt-6">
          <FieldSection
            title="Identity"
            description="How this person appears throughout the workspace."
          >
            <FieldGrid>
              <Field
                label="Employee ID"
                required
                hint="Unique within your organisation, e.g. ACME-0042."
                error={firstError("employeeCode")}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={values.employeeCode}
                    onChange={(event) => set("employeeCode", event.target.value)}
                    placeholder="ACME-0042"
                    disabled={Boolean(employeeId)}
                    autoComplete="off"
                  />
                )}
              </Field>

              <Field label="Designation" required error={firstError("designation")}>
                {(control) => (
                  <Input
                    {...control}
                    value={values.designation}
                    onChange={(event) => set("designation", event.target.value)}
                    placeholder="Senior Frontend Engineer"
                  />
                )}
              </Field>

              <Field label="First name" required error={firstError("firstName")}>
                {(control) => (
                  <Input
                    {...control}
                    value={values.firstName}
                    onChange={(event) => set("firstName", event.target.value)}
                    autoComplete="given-name"
                  />
                )}
              </Field>

              <Field label="Last name" required error={firstError("lastName")}>
                {(control) => (
                  <Input
                    {...control}
                    value={values.lastName}
                    onChange={(event) => set("lastName", event.target.value)}
                    autoComplete="family-name"
                  />
                )}
              </Field>

              <Field label="Work email" required error={firstError("email")}>
                {(control) => (
                  <Input
                    {...control}
                    type="email"
                    inputMode="email"
                    value={values.email}
                    onChange={(event) => set("email", event.target.value)}
                    autoComplete="email"
                  />
                )}
              </Field>

              <Field label="Phone" optional error={firstError("phone")}>
                {(control) => (
                  <Input
                    {...control}
                    type="tel"
                    inputMode="tel"
                    value={values.phone}
                    onChange={(event) => set("phone", event.target.value)}
                    placeholder="+91 98765 43210"
                    autoComplete="tel"
                  />
                )}
              </Field>

              <FieldSpan>
                <Field label="Profile photo URL" optional error={firstError("avatarUrl")}>
                  {(control) => (
                    <Input
                      {...control}
                      type="url"
                      value={values.avatarUrl}
                      onChange={(event) => set("avatarUrl", event.target.value)}
                      placeholder="https://…"
                    />
                  )}
                </Field>
              </FieldSpan>

              <FieldSpan>
                <Field
                  label="Bio"
                  optional
                  hint="A sentence or two shown on their profile."
                  error={firstError("bio")}
                >
                  {(control) => (
                    <Textarea
                      {...control}
                      value={values.bio}
                      onChange={(event) => set("bio", event.target.value)}
                      rows={3}
                    />
                  )}
                </Field>
              </FieldSpan>
            </FieldGrid>
          </FieldSection>

          <Separator />

          <FieldSection title="Placement" description="Where they sit in the organisation.">
            <FieldGrid>
              <Field label="Department" optional error={firstError("departmentId")}>
                {(control) => (
                  <Select
                    value={values.departmentId}
                    onValueChange={(value) => set("departmentId", value)}
                  >
                    <SelectTrigger id={control.id} aria-describedby={control["aria-describedby"]}>
                      <SelectValue placeholder="Select a department" />
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

              <Field label="Reports to" optional error={firstError("managerId")}>
                {(control) => (
                  <Select value={values.managerId} onValueChange={(value) => set("managerId", value)}>
                    <SelectTrigger id={control.id} aria-describedby={control["aria-describedby"]}>
                      <SelectValue placeholder="Select a manager" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No manager</SelectItem>
                      {options.managers
                        .filter((manager) => manager.id !== employeeId)
                        .map((manager) => (
                          <SelectItem key={manager.id} value={manager.id}>
                            {manager.name} — {manager.designation}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field
                label="Primary office"
                optional
                hint="Determines which geofence they can check in from."
                error={firstError("primaryOfficeId")}
              >
                {(control) => (
                  <Select
                    value={values.primaryOfficeId}
                    onValueChange={(value) => set("primaryOfficeId", value)}
                  >
                    <SelectTrigger id={control.id} aria-describedby={control["aria-describedby"]}>
                      <SelectValue placeholder="Select an office" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No office</SelectItem>
                      {options.offices.map((office) => (
                        <SelectItem key={office.id} value={office.id}>
                          {office.name} · {office.city}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field label="Employment type" required error={firstError("employmentType")}>
                {(control) => (
                  <Select
                    value={values.employmentType}
                    onValueChange={(value) => set("employmentType", value)}
                  >
                    <SelectTrigger id={control.id} aria-describedby={control["aria-describedby"]}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field label="Joining date" required error={firstError("joinedAt")}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={values.joinedAt}
                    onChange={(event) => set("joinedAt", event.target.value)}
                  />
                )}
              </Field>

              <Field label="Status" required error={firstError("status")}>
                {(control) => (
                  <Select value={values.status} onValueChange={(value) => set("status", value)}>
                    <SelectTrigger id={control.id} aria-describedby={control["aria-describedby"]}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(EMPLOYEE_STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </FieldGrid>
          </FieldSection>

          <Separator />

          <FieldSection
            title="Working hours"
            description="Leave blank to use the office's standard window."
          >
            <FieldGrid>
              <Field label="Shift start" optional error={firstError("shiftStartMinutes")}>
                {(control) => (
                  <Input
                    {...control}
                    type="time"
                    value={values.shiftStart}
                    onChange={(event) => set("shiftStart", event.target.value)}
                  />
                )}
              </Field>

              <Field label="Shift end" optional error={firstError("shiftEndMinutes")}>
                {(control) => (
                  <Input
                    {...control}
                    type="time"
                    value={values.shiftEnd}
                    onChange={(event) => set("shiftEnd", event.target.value)}
                  />
                )}
              </Field>
            </FieldGrid>
          </FieldSection>
        </CardContent>
      </Card>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={() => router.back()} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {employeeId ? "Save changes" : "Create employee"}
        </Button>
      </div>
    </form>
  );
}

/** Convert a stored employee record into form values. */
export function toFormValues(employee: {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  designation: string;
  bio?: string | null;
  avatarUrl: string | null;
  departmentId: string | null;
  managerId: string | null;
  primaryOfficeId: string | null;
  employmentType: string;
  status: string;
  joinedAt: Date;
  shiftStartMinutes?: number | null;
  shiftEndMinutes?: number | null;
}): EmployeeFormValues {
  return {
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone ?? "",
    designation: employee.designation,
    bio: employee.bio ?? "",
    avatarUrl: employee.avatarUrl ?? "",
    departmentId: employee.departmentId ?? NONE,
    managerId: employee.managerId ?? NONE,
    primaryOfficeId: employee.primaryOfficeId ?? NONE,
    employmentType: employee.employmentType,
    status: employee.status,
    joinedAt: employee.joinedAt.toISOString().slice(0, 10),
    shiftStart: employee.shiftStartMinutes != null ? minutesToClock(employee.shiftStartMinutes) : "",
    shiftEnd: employee.shiftEndMinutes != null ? minutesToClock(employee.shiftEndMinutes) : "",
  };
}
