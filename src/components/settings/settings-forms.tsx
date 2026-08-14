"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { clockToMinutes, minutesToClock } from "@/lib/utils";
import { formatDate } from "@/lib/time";
import { fieldErrors } from "@/lib/validation/common";
import {
  attendancePolicySchema,
  organizationProfileSchema,
  WEEKDAY_LABELS,
  workingHoursSchema,
} from "@/lib/validation/organization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, SettingRow, Switch } from "@/components/ui/toggles";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Editable organisation settings.
 *
 * Each card is its own form posting its own section, so saving working hours
 * cannot silently submit a geofence change the user never saw. Every save
 * writes an audit entry, and the copy says so where the stakes are highest.
 */

type Section = "profile" | "workingHours" | "attendancePolicy";

async function saveSection(section: Section, values: unknown) {
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ section, values }),
  });
  const body = await response.json();
  return { ok: response.ok, body };
}

/** Shared submit/dirty handling for the three cards below. */
function useSectionForm<T>(section: Section, initial: T) {
  const router = useRouter();
  const [values, setValues] = React.useState<T>(initial);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);

  const dirty = React.useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initial),
    [values, initial],
  );

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  const submit = async (payload: unknown, successMessage: string) => {
    setErrors({});
    setSaving(true);
    try {
      const { ok, body } = await saveSection(section, payload);
      if (!ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't save those settings");
        return false;
      }
      toast.success(successMessage, { description: "Recorded in the audit log." });
      router.refresh();
      return true;
    } finally {
      setSaving(false);
    }
  };

  return { values, set, setValues, errors, setErrors, saving, dirty, submit };
}

// --- Organisation profile ---------------------------------------------------

export function OrganizationProfileForm({
  initial,
}: {
  initial: { name: string; legalName: string; logoUrl: string; timezone: string; currency: string; locale: string };
}) {
  const form = useSectionForm("profile", initial);
  const { values, set, errors, saving, dirty } = form;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const payload = {
      name: values.name.trim(),
      legalName: values.legalName.trim() || undefined,
      logoUrl: values.logoUrl.trim() || undefined,
      timezone: values.timezone.trim(),
      currency: values.currency.trim().toUpperCase(),
      locale: values.locale.trim(),
    };

    const parsed = organizationProfileSchema.safeParse(payload);
    if (!parsed.success) {
      form.setErrors(fieldErrors(parsed.error));
      return;
    }

    await form.submit(payload, "Organisation profile updated");
  };

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Profile</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              How your organisation is named throughout the workspace.
            </p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <FieldGrid>
            <Field label="Organisation name" required error={errors.name?.[0]}>
              {(control) => (
                <Input
                  {...control}
                  value={values.name}
                  onChange={(event) => set("name", event.target.value)}
                />
              )}
            </Field>

            <Field label="Legal name" optional error={errors.legalName?.[0]}>
              {(control) => (
                <Input
                  {...control}
                  value={values.legalName}
                  onChange={(event) => set("legalName", event.target.value)}
                  placeholder="Acme Technologies Private Limited"
                />
              )}
            </Field>

            <Field
              label="Timezone"
              required
              hint="IANA name. Offices can override this individually."
              error={errors.timezone?.[0]}
            >
              {(control) => (
                <Input
                  {...control}
                  value={values.timezone}
                  onChange={(event) => set("timezone", event.target.value)}
                  placeholder="Asia/Kolkata"
                />
              )}
            </Field>

            <Field label="Currency" required hint="3-letter code." error={errors.currency?.[0]}>
              {(control) => (
                <Input
                  {...control}
                  value={values.currency}
                  onChange={(event) => set("currency", event.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="INR"
                />
              )}
            </Field>

            <Field label="Locale" required error={errors.locale?.[0]}>
              {(control) => (
                <Input
                  {...control}
                  value={values.locale}
                  onChange={(event) => set("locale", event.target.value)}
                  placeholder="en-IN"
                />
              )}
            </Field>

            <Field label="Logo URL" optional error={errors.logoUrl?.[0]}>
              {(control) => (
                <Input
                  {...control}
                  type="url"
                  value={values.logoUrl}
                  onChange={(event) => set("logoUrl", event.target.value)}
                  placeholder="https://…"
                />
              )}
            </Field>
          </FieldGrid>

          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={!dirty}>
              <Save aria-hidden />
              Save profile
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

// --- Working hours ----------------------------------------------------------

export function WorkingHoursForm({
  initial,
}: {
  initial: {
    workdayStartMinutes: number;
    workdayEndMinutes: number;
    gracePeriodMinutes: number;
    fullDayHours: number;
    halfDayHours: number;
    weekendDays: number[];
  };
}) {
  const router = useRouter();
  const [start, setStart] = React.useState(minutesToClock(initial.workdayStartMinutes));
  const [end, setEnd] = React.useState(minutesToClock(initial.workdayEndMinutes));
  const [grace, setGrace] = React.useState(String(initial.gracePeriodMinutes));
  const [fullDay, setFullDay] = React.useState(String(initial.fullDayHours));
  const [halfDay, setHalfDay] = React.useState(String(initial.halfDayHours));
  const [weekend, setWeekend] = React.useState<number[]>(initial.weekendDays);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);

  const toggleWeekend = (day: number) => {
    setWeekend((current) =>
      current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort(),
    );
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    const payload = {
      workdayStartMinutes: clockToMinutes(start),
      workdayEndMinutes: clockToMinutes(end),
      gracePeriodMinutes: Number(grace),
      fullDayHours: Number(fullDay),
      halfDayHours: Number(halfDay),
      weekendDays: weekend,
    };

    const parsed = workingHoursSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSaving(true);
    try {
      const { ok, body } = await saveSection("workingHours", payload);
      if (!ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't save those settings");
        return;
      }
      toast.success("Working hours updated", {
        description: `Arrivals after ${minutesToClock(payload.workdayStartMinutes + payload.gracePeriodMinutes)} now count as late.`,
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const lateFrom = minutesToClock(clockToMinutes(start) + (Number(grace) || 0));

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Working hours</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              These decide who is marked late and what counts as a full day.
            </p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <FieldGrid>
            <Field label="Day starts" required error={errors.workdayStartMinutes?.[0]}>
              {(control) => (
                <Input
                  {...control}
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              )}
            </Field>

            <Field label="Day ends" required error={errors.workdayEndMinutes?.[0]}>
              {(control) => (
                <Input
                  {...control}
                  type="time"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Grace period (minutes)"
              required
              hint={`Arrivals after ${lateFrom} will be marked late.`}
              error={errors.gracePeriodMinutes?.[0]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={0}
                  max={240}
                  inputMode="numeric"
                  value={grace}
                  onChange={(event) => setGrace(event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Full day (hours)"
              required
              hint="Time worked beyond this counts as overtime."
              error={errors.fullDayHours?.[0]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  max={24}
                  step={0.5}
                  inputMode="decimal"
                  value={fullDay}
                  onChange={(event) => setFullDay(event.target.value)}
                />
              )}
            </Field>

            <Field
              label="Half day threshold (hours)"
              required
              hint="A shorter day is recorded as a half day."
              error={errors.halfDayHours?.[0]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={0.5}
                  max={12}
                  step={0.5}
                  inputMode="decimal"
                  value={halfDay}
                  onChange={(event) => setHalfDay(event.target.value)}
                />
              )}
            </Field>
          </FieldGrid>

          <div>
            <p className="mb-2.5 text-sm font-medium text-ink-secondary">Weekend days</p>
            {errors.weekendDays ? (
              <p className="mb-2 text-xs text-critical">{errors.weekendDays[0]}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {Object.entries(WEEKDAY_LABELS).map(([value, label]) => {
                const day = Number(value);
                const selected = weekend.includes(day);
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      selected
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-line text-ink-secondary hover:bg-surface-2"
                    }`}
                  >
                    <Checkbox checked={selected} onCheckedChange={() => toggleWeekend(day)} />
                    {label}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              <Save aria-hidden />
              Save working hours
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

// --- Attendance / location policy -------------------------------------------

export function AttendancePolicyForm({
  initial,
}: {
  initial: {
    maxAccuracyMeters: number;
    maxTravelSpeedKmh: number;
    enforceGeofence: boolean;
    allowManualOverride: boolean;
    requireCheckoutLocation: boolean;
  };
}) {
  const router = useRouter();
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    const payload = {
      maxAccuracyMeters: Number(values.maxAccuracyMeters),
      maxTravelSpeedKmh: Number(values.maxTravelSpeedKmh),
      enforceGeofence: values.enforceGeofence,
      allowManualOverride: values.allowManualOverride,
      requireCheckoutLocation: values.requireCheckoutLocation,
    };

    const parsed = attendancePolicySchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSaving(true);
    try {
      const { ok, body } = await saveSection("attendancePolicy", payload);
      if (!ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't save that policy");
        return;
      }
      toast.success("Attendance policy updated", { description: "Recorded in the audit log." });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Location policy</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              How strictly check-in location is enforced.
            </p>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <SettingRow
            title="Enforce geofence"
            description={
              values.enforceGeofence
                ? "Check-ins outside a perimeter are refused."
                : "Out-of-perimeter check-ins are recorded and flagged, but allowed."
            }
            control={
              <Switch
                checked={values.enforceGeofence}
                onCheckedChange={(checked) => set("enforceGeofence", checked)}
                aria-label="Enforce geofence"
              />
            }
          />

          {/* Turning this off is an access-control change, so it is called out
              rather than left as a quiet toggle. */}
          {!values.enforceGeofence ? (
            <div className="flex items-start gap-3 rounded-xl border border-warning/35 bg-warning-soft/50 px-4 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p className="text-xs leading-relaxed text-ink-secondary">
                With enforcement off, anyone can record attendance from anywhere. Attempts are still
                logged and flagged, but nothing is refused. This change is written to the audit log
                as a permission change.
              </p>
            </div>
          ) : null}

          <SettingRow
            title="Allow manual corrections"
            description="HR can amend a record — always with a reason, and always audited."
            control={
              <Switch
                checked={values.allowManualOverride}
                onCheckedChange={(checked) => set("allowManualOverride", checked)}
                aria-label="Allow manual corrections"
              />
            }
          />

          <SettingRow
            title="Require location on check-out"
            description="Leaving also needs a verified position, not just arriving."
            control={
              <Switch
                checked={values.requireCheckoutLocation}
                onCheckedChange={(checked) => set("requireCheckoutLocation", checked)}
                aria-label="Require location on check-out"
              />
            }
          />

          <FieldGrid>
            <Field
              label="Maximum GPS accuracy (m)"
              required
              hint="A reading vaguer than this is refused — it can't decide a perimeter either way."
              error={errors.maxAccuracyMeters?.[0]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={20}
                  max={1000}
                  inputMode="numeric"
                  value={values.maxAccuracyMeters}
                  onChange={(event) => set("maxAccuracyMeters", Number(event.target.value))}
                />
              )}
            </Field>

            <Field
              label="Impossible-travel threshold (km/h)"
              required
              hint="Movement faster than this between two fixes raises a risk flag."
              error={errors.maxTravelSpeedKmh?.[0]}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={50}
                  max={2000}
                  inputMode="numeric"
                  value={values.maxTravelSpeedKmh}
                  onChange={(event) => set("maxTravelSpeedKmh", Number(event.target.value))}
                />
              )}
            </Field>
          </FieldGrid>

          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={!dirty}>
              <Save aria-hidden />
              Save policy
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

// --- Holidays ---------------------------------------------------------------

export function HolidayManager({
  holidays,
  canManage,
}: {
  holidays: Array<{ id: string; name: string; date: Date; isOptional: boolean }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [date, setDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !date) return;

    setSaving(true);
    try {
      const response = await fetch("/api/settings/holidays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), date, isOptional: false }),
      });
      const body = await response.json();

      if (!response.ok) {
        toast.error(body?.error?.message ?? "Couldn't add that holiday");
        return;
      }

      toast.success("Holiday added");
      setName("");
      setDate("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (holidayId: string) => {
    const response = await fetch("/api/settings/holidays", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ holidayId }),
    });
    if (!response.ok) {
      toast.error("Couldn't remove that holiday");
      return;
    }
    toast.success("Holiday removed");
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Holidays</CardTitle>
          <p className="mt-1 text-sm text-ink-muted">
            Attendance on these days is recorded as a holiday rather than a working day.
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {holidays.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">No holidays configured.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {holidays.map((holiday) => (
              <li
                key={holiday.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{holiday.name}</p>
                  <p className="text-xs text-ink-muted">{formatDate(holiday.date)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {holiday.isOptional ? (
                    <Badge tone="outline" size="sm">
                      Optional
                    </Badge>
                  ) : null}
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => remove(holiday.id)}
                      aria-label={`Remove ${holiday.name}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Holiday name"
              aria-label="Holiday name"
              inputSize="sm"
              className="min-w-40 flex-1"
            />
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Holiday date"
              inputSize="sm"
              className="w-auto"
            />
            <Button type="submit" variant="secondary" size="sm" loading={saving} disabled={!name.trim() || !date}>
              <Plus aria-hidden />
              Add
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
