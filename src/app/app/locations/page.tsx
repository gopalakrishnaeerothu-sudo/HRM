import type { Metadata } from "next";
import { Building2, ShieldCheck } from "lucide-react";

import { can, requirePermission } from "@/server/auth";
import { officeService } from "@/server/services/office-service";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { OfficeCard } from "@/components/locations/office-card";
import { OfficeFormDialog } from "@/components/locations/office-form-dialog";

export const metadata: Metadata = { title: "Office locations" };

/**
 * Offices and their geofences.
 *
 * Coordinates are shown to users who can read offices (admins, HR, managers).
 * Employees' own live positions are never shown here — only office centres and
 * radii, which are organisational configuration rather than personal data.
 */
export default async function LocationsPage() {
  const session = await requirePermission("office:read");
  const offices = await officeService.list(session);

  const canManageGeofence = can(session, "geofence:manage");
  const canManageOffices = can(session, "office:manage");
  const totalZones = offices.reduce((sum, office) => sum + office.geofences.length, 0);

  return (
    <>
      <PageHeader
        title="Office locations"
        description={`${offices.length} ${offices.length === 1 ? "office" : "offices"} · ${totalZones} active ${totalZones === 1 ? "zone" : "zones"}. Attendance is verified against these perimeters.`}
        actions={canManageOffices ? <OfficeFormDialog /> : null}
      />

      <PageBody>
        {offices.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Building2 />}
              size="page"
              title="No offices yet"
              description="Add an office with its coordinates and radius so employees can check in against a perimeter."
              action={canManageOffices ? <OfficeFormDialog /> : null}
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {offices.map((office) => (
                <OfficeCard
                  key={office.id}
                  office={office}
                  canManageGeofence={canManageGeofence}
                  canManageOffice={canManageOffices}
                />
              ))}
            </div>

            <Card variant="inset" className="p-5">
              <div className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <ShieldCheck className="size-[1.125rem]" aria-hidden />
                </span>
                <div className="min-w-0 text-sm leading-relaxed text-ink-secondary">
                  <p className="font-semibold text-ink">How verification works</p>
                  <p className="mt-1.5 text-ink-muted">
                    When someone checks in, their browser reports coordinates and nothing else. The
                    server resolves which offices that employee is assigned to, computes the
                    great-circle distance to each perimeter, and decides. Every attempt — accepted or
                    refused — is written to an append-only log with the coordinates, accuracy and any
                    risk flags behind the decision.
                  </p>
                  <p className="mt-2 text-ink-muted">
                    Browser GPS can be spoofed, so this is not tamper-proof. What it gives you is
                    server-side truth, refusal of invalid or low-confidence readings, and a trail
                    that makes tampering visible after the fact.
                  </p>
                </div>
              </div>
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
