"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Crosshair, Plus } from "lucide-react";
import { toast } from "sonner";

import { clockToMinutes, minutesToClock } from "@/lib/utils";
import { fieldErrors } from "@/lib/validation/common";
import { createOfficeSchema } from "@/lib/validation/office";
import { Button } from "@/components/ui/button";
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
import { Field, FieldGrid, FieldSection, FieldSpan } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { GeofencePreview } from "@/components/locations/geofence-preview";

/**
 * Create or edit an office.
 *
 * Coordinates are entered by the administrator — nothing is hard-coded
 * anywhere in the application, including here. "Use my location" fills them
 * from the browser as a convenience for someone standing in the building; the
 * values are still theirs to confirm and edit.
 */

export interface OfficeFormValues {
  name: string;
  code: string;
  addressLine: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  timezone: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  workdayStart: string;
  workdayEnd: string;
  gracePeriodMinutes: string;
}

const EMPTY: OfficeFormValues = {
  name: "",
  code: "",
  addressLine: "",
  city: "",
  state: "",
  country: "India",
  postalCode: "",
  timezone: "Asia/Kolkata",
  latitude: "",
  longitude: "",
  radiusMeters: "100",
  workdayStart: "09:00",
  workdayEnd: "18:00",
  gracePeriodMinutes: "15",
};

export function OfficeFormDialog({
  officeId,
  initial,
  trigger,
}: {
  /** Present for edit, absent for create. */
  officeId?: string;
  initial?: Partial<OfficeFormValues>;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<OfficeFormValues>({ ...EMPTY, ...initial });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [saving, setSaving] = React.useState(false);
  const [locating, setLocating] = React.useState(false);

  const set = <K extends keyof OfficeFormValues>(key: K, value: OfficeFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("This browser doesn't support location services");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        set("latitude", position.coords.latitude.toFixed(6));
        set("longitude", position.coords.longitude.toFixed(6));
        setLocating(false);
        toast.success("Coordinates filled from your device", {
          description: `Accurate to about ${Math.round(position.coords.accuracy)} m — check them before saving.`,
        });
      },
      () => {
        setLocating(false);
        toast.error("Couldn't read your location", {
          description: "Enter the coordinates manually instead.",
        });
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    const payload = {
      name: values.name.trim(),
      code: values.code.trim(),
      addressLine: values.addressLine.trim(),
      city: values.city.trim(),
      state: values.state.trim() || undefined,
      country: values.country.trim() || "India",
      postalCode: values.postalCode.trim() || undefined,
      timezone: values.timezone.trim(),
      latitude: Number(values.latitude),
      longitude: Number(values.longitude),
      radiusMeters: Number(values.radiusMeters),
      workdayStartMinutes: clockToMinutes(values.workdayStart),
      workdayEndMinutes: clockToMinutes(values.workdayEnd),
      gracePeriodMinutes: Number(values.gracePeriodMinutes),
      status: "ACTIVE" as const,
    };

    if (!officeId) {
      const parsed = createOfficeSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        toast.error("Please check the highlighted fields");
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch(officeId ? `/api/offices/${officeId}` : "/api/offices", {
        method: officeId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't save that office");
        return;
      }

      toast.success(officeId ? "Office updated" : "Office created", {
        description: officeId
          ? "Recorded in the audit log."
          : `A ${payload.radiusMeters} m perimeter was created so staff can check in.`,
      });
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const firstError = (key: string) => errors[key]?.[0] ?? null;
  const previewRadius = Number(values.radiusMeters) || 100;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus aria-hidden />
            Add office
          </Button>
        )}
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{officeId ? "Edit office" : "Add an office"}</DialogTitle>
          <DialogDescription>
            The coordinates and radius here decide who can record attendance at this site.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate>
          <DialogBody className="flex flex-col gap-7">
            <FieldSection title="Identity">
              <FieldGrid>
                <Field label="Office name" required error={firstError("name")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={values.name}
                      onChange={(event) => set("name", event.target.value)}
                      placeholder="Guntur Headquarters"
                    />
                  )}
                </Field>

                <Field
                  label="Office code"
                  required
                  hint="Short, unique within your organisation."
                  error={firstError("code")}
                >
                  {(control) => (
                    <Input
                      {...control}
                      value={values.code}
                      onChange={(event) => set("code", event.target.value.toUpperCase())}
                      placeholder="GNT-HQ"
                      disabled={Boolean(officeId)}
                    />
                  )}
                </Field>

                <FieldSpan>
                  <Field label="Address" required error={firstError("addressLine")}>
                    {(control) => (
                      <Input
                        {...control}
                        value={values.addressLine}
                        onChange={(event) => set("addressLine", event.target.value)}
                        placeholder="4th Floor, Brodipet Main Road"
                      />
                    )}
                  </Field>
                </FieldSpan>

                <Field label="City" required error={firstError("city")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={values.city}
                      onChange={(event) => set("city", event.target.value)}
                    />
                  )}
                </Field>

                <Field label="State" optional error={firstError("state")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={values.state}
                      onChange={(event) => set("state", event.target.value)}
                    />
                  )}
                </Field>

                <Field label="Country" required error={firstError("country")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={values.country}
                      onChange={(event) => set("country", event.target.value)}
                    />
                  )}
                </Field>

                <Field label="Postal code" optional error={firstError("postalCode")}>
                  {(control) => (
                    <Input
                      {...control}
                      value={values.postalCode}
                      onChange={(event) => set("postalCode", event.target.value)}
                    />
                  )}
                </Field>
              </FieldGrid>
            </FieldSection>

            <FieldSection
              title="Location and perimeter"
              description="Attendance is verified against these on the server."
            >
              <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
                <FieldGrid columns={1}>
                  <FieldGrid>
                    <Field label="Latitude" required error={firstError("latitude")}>
                      {(control) => (
                        <Input
                          {...control}
                          inputMode="decimal"
                          value={values.latitude}
                          onChange={(event) => set("latitude", event.target.value)}
                          placeholder="16.30656"
                        />
                      )}
                    </Field>

                    <Field label="Longitude" required error={firstError("longitude")}>
                      {(control) => (
                        <Input
                          {...control}
                          inputMode="decimal"
                          value={values.longitude}
                          onChange={(event) => set("longitude", event.target.value)}
                          placeholder="80.43650"
                        />
                      )}
                    </Field>
                  </FieldGrid>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={useMyLocation}
                    loading={locating}
                    className="w-fit"
                  >
                    <Crosshair aria-hidden />
                    Use my current location
                  </Button>

                  <Field
                    label="Geofence radius (m)"
                    required
                    hint="Between 20 m and 5,000 m. Below 20 m, GPS is not precise enough to be fair."
                    error={firstError("radiusMeters")}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="number"
                        min={20}
                        max={5000}
                        step={10}
                        inputMode="numeric"
                        value={values.radiusMeters}
                        onChange={(event) => set("radiusMeters", event.target.value)}
                      />
                    )}
                  </Field>
                </FieldGrid>

                <div className="min-w-0">
                  <p className="mb-2 text-sm font-medium text-ink-secondary">Perimeter preview</p>
                  <GeofencePreview radiusMeters={previewRadius} officeName={values.name || "office"} />
                </div>
              </div>
            </FieldSection>

            <FieldSection
              title="Working hours"
              description="This office's local clock. Overrides the organisation default."
            >
              <FieldGrid columns={3}>
                <Field label="Opens" required error={firstError("workdayStartMinutes")}>
                  {(control) => (
                    <Input
                      {...control}
                      type="time"
                      value={values.workdayStart}
                      onChange={(event) => set("workdayStart", event.target.value)}
                    />
                  )}
                </Field>

                <Field label="Closes" required error={firstError("workdayEndMinutes")}>
                  {(control) => (
                    <Input
                      {...control}
                      type="time"
                      value={values.workdayEnd}
                      onChange={(event) => set("workdayEnd", event.target.value)}
                    />
                  )}
                </Field>

                <Field label="Grace period (min)" required error={firstError("gracePeriodMinutes")}>
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      min={0}
                      max={240}
                      inputMode="numeric"
                      value={values.gracePeriodMinutes}
                      onChange={(event) => set("gracePeriodMinutes", event.target.value)}
                    />
                  )}
                </Field>

                <FieldSpan>
                  <Field
                    label="Timezone"
                    required
                    hint="IANA name. Decides which calendar day a check-in belongs to."
                    error={firstError("timezone")}
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
                </FieldSpan>
              </FieldGrid>
            </FieldSection>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Building2 aria-hidden />
              {officeId ? "Save office" : "Create office"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Map a stored office onto form values. */
export function officeToFormValues(office: {
  name: string;
  code: string;
  addressLine: string;
  city: string;
  state: string | null;
  country: string;
  postalCode: string | null;
  timezone: string;
  latitude: number;
  longitude: number;
  workdayStartMinutes: number;
  workdayEndMinutes: number;
  gracePeriodMinutes: number;
  geofences: Array<{ radiusMeters: number; isPrimary: boolean }>;
}): OfficeFormValues {
  const primary = office.geofences.find((zone) => zone.isPrimary) ?? office.geofences[0];

  return {
    name: office.name,
    code: office.code,
    addressLine: office.addressLine,
    city: office.city,
    state: office.state ?? "",
    country: office.country,
    postalCode: office.postalCode ?? "",
    timezone: office.timezone,
    latitude: String(office.latitude),
    longitude: String(office.longitude),
    radiusMeters: String(primary?.radiusMeters ?? 100),
    workdayStart: minutesToClock(office.workdayStartMinutes),
    workdayEnd: minutesToClock(office.workdayEndMinutes),
    gracePeriodMinutes: String(office.gracePeriodMinutes),
  };
}
