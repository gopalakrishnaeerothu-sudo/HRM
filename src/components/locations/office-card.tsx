"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Clock, MapPin, Pencil, Radar, Save, Users } from "lucide-react";
import { toast } from "sonner";

import { cn, formatDistance, minutesToClock12 } from "@/lib/utils";
import { geofenceRadiusSchema } from "@/lib/validation/common";
import type { OfficeRecord } from "@/server/repositories/office-repository";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { GeofencePreview } from "@/components/locations/geofence-preview";
import {
  OfficeFormDialog,
  officeToFormValues,
} from "@/components/locations/office-form-dialog";

/**
 * One office, with an inline geofence editor.
 *
 * Radius changes are audited as `GEOFENCE_CHANGE` rather than a plain update,
 * because widening a perimeter changes who can record attendance. The preview
 * redraws live as the number changes, so the person editing can see what
 * "250 m" actually covers before saving.
 */
export function OfficeCard({
  office,
  canManageGeofence,
  canManageOffice = false,
}: {
  office: OfficeRecord;
  canManageGeofence: boolean;
  canManageOffice?: boolean;
}) {
  const router = useRouter();
  const primary = office.geofences.find((zone) => zone.isPrimary) ?? office.geofences[0] ?? null;

  const [radius, setRadius] = React.useState(primary?.radiusMeters ?? 100);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRadius(primary?.radiusMeters ?? 100);
  }, [primary?.radiusMeters]);

  const dirty = primary !== null && radius !== primary.radiusMeters;

  const save = async () => {
    if (!primary) return;

    const parsed = geofenceRadiusSchema.safeParse(radius);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid radius");
      return;
    }
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/offices/${office.id}/geofences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: primary.id,
          name: primary.name,
          latitude: primary.latitude,
          longitude: primary.longitude,
          radiusMeters: parsed.data,
          isPrimary: true,
          isActive: true,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        toast.error(body?.error?.message ?? "Couldn't update the perimeter");
        return;
      }

      toast.success("Geofence updated", {
        description: `${office.name}: ${primary.radiusMeters} m → ${parsed.data} m. Recorded in the audit log.`,
      });
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Building2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate">{office.name}</CardTitle>
            <p className="mt-1 truncate text-xs text-ink-muted">
              {office.addressLine}, {office.city}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={office.status === "ACTIVE" ? "success" : "neutral"} size="sm">
            {office.status === "ACTIVE" ? "Active" : "Inactive"}
          </Badge>
          {canManageOffice ? (
            <OfficeFormDialog
              officeId={office.id}
              initial={officeToFormValues(office)}
              trigger={
                <Button variant="ghost" size="icon-xs" aria-label={`Edit ${office.name}`}>
                  <Pencil aria-hidden />
                </Button>
              }
            />
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5">
        <GeofencePreview radiusMeters={radius} officeName={office.name} />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          <Detail icon={MapPin} label="Coordinates">
            <span className="font-mono text-xs">
              {office.latitude.toFixed(5)}, {office.longitude.toFixed(5)}
            </span>
          </Detail>
          <Detail icon={Radar} label="Perimeter">
            {primary ? formatDistance(primary.radiusMeters) : "No zone"}
          </Detail>
          <Detail icon={Clock} label="Working hours">
            {minutesToClock12(office.workdayStartMinutes)} – {minutesToClock12(office.workdayEndMinutes)}
          </Detail>
          <Detail icon={Users} label="Assigned staff">
            {office.assignedEmployeeCount}
          </Detail>
        </dl>

        <p className="text-[0.6875rem] text-ink-muted">
          Timezone {office.timezone} · {office.gracePeriodMinutes} min grace period
          {office.geofences.length > 1 ? ` · ${office.geofences.length} zones` : ""}
        </p>

        {canManageGeofence && primary ? (
          <div className="mt-auto border-t border-line pt-4">
            <Field
              label="Geofence radius"
              hint="Between 20 m and 5,000 m. Below 20 m, GPS is not precise enough to be fair."
              error={error}
            >
              {(control) => (
                <div className="flex gap-2">
                  <Input
                    {...control}
                    type="number"
                    inputMode="numeric"
                    min={20}
                    max={5000}
                    step={10}
                    value={radius}
                    onChange={(event) => {
                      setRadius(Number(event.target.value));
                      setError(null);
                    }}
                    trailingIcon={<span className="text-xs">m</span>}
                  />
                  <Button
                    onClick={save}
                    loading={saving}
                    disabled={!dirty}
                    variant={dirty ? "primary" : "secondary"}
                  >
                    <Save aria-hidden />
                    Save
                  </Button>
                </div>
              )}
            </Field>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[0.6875rem] text-ink-muted">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className={cn("mt-0.5 truncate text-sm text-ink")}>{children}</dd>
    </div>
  );
}
