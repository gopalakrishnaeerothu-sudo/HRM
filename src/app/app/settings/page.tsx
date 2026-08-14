import type { Metadata } from "next";
import Link from "next/link";
import {
  Building2,
  Clock,
  FileClock,
  KeyRound,
  MapPin,
  ShieldCheck,
  Users,
} from "lucide-react";

import { minutesToClock12 } from "@/lib/utils";
import { WEEKDAY_LABELS } from "@/lib/validation/organization";
import { can, requireSession } from "@/server/auth";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/server/auth/permissions";
import { organizationRepository } from "@/server/repositories/org-repository";
import { officeService } from "@/server/services/office-service";
import { settingsService } from "@/server/services/settings-service";
import {
  AttendancePolicyForm,
  HolidayManager,
  OrganizationProfileForm,
  WorkingHoursForm,
} from "@/components/settings/settings-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Settings" };

/**
 * Organisation settings.
 *
 * Read-only for roles without `settings:manage`. Attendance policy values are
 * shown alongside what they *do*, because "grace period: 15" means nothing
 * without the sentence explaining that it decides who is marked late.
 */
export default async function SettingsPage() {
  const session = await requireSession();
  const [organization, full, offices, holidays] = await Promise.all([
    organizationRepository.policy(session.organization.id),
    organizationRepository.requireById(session.organization.id),
    officeService.list(session),
    settingsService.listHolidays(session),
  ]);

  const canManage = can(session, "settings:manage");
  const weekendLabels = organization.weekendDays.map((day) => WEEKDAY_LABELS[day]).join(", ");

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          canManage
            ? "Organisation-wide configuration. Changes are recorded in the audit log."
            : "Read-only. Ask an administrator to change these."
        }
        meta={
          canManage ? null : (
            <Badge tone="neutral" size="sm">
              View only
            </Badge>
          )
        }
      />

      <PageBody>
        <Tabs defaultValue="organization">
          <TabsList>
            <TabsTrigger value="organization">
              <Building2 aria-hidden />
              Organisation
            </TabsTrigger>
            <TabsTrigger value="attendance">
              <Clock aria-hidden />
              Attendance
            </TabsTrigger>
            <TabsTrigger value="locations">
              <MapPin aria-hidden />
              Locations
            </TabsTrigger>
            <TabsTrigger value="roles">
              <Users aria-hidden />
              Roles
            </TabsTrigger>
          </TabsList>

          <TabsContent value="organization">
            {/* Editable for settings:manage, read-only otherwise — the same
                data either way, so nobody sees a different set of facts. */}
            {canManage ? (
              <div className="flex flex-col gap-4">
                <OrganizationProfileForm
                  initial={{
                    name: full.name,
                    legalName: full.legalName ?? "",
                    logoUrl: full.logoUrl ?? "",
                    timezone: full.timezone,
                    currency: full.currency,
                    locale: full.locale,
                  }}
                />
                <WorkingHoursForm
                  initial={{
                    workdayStartMinutes: organization.workdayStartMinutes,
                    workdayEndMinutes: organization.workdayEndMinutes,
                    gracePeriodMinutes: organization.gracePeriodMinutes,
                    fullDayHours: organization.fullDayHours,
                    halfDayHours: organization.halfDayHours,
                    weekendDays: organization.weekendDays,
                  }}
                />
                <HolidayManager holidays={holidays} canManage />
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Profile</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3.5">
                    <Row label="Name" value={session.organization.name} />
                    <Row label="Workspace slug" value={session.organization.slug} mono />
                    <Row label="Timezone" value={organization.timezone} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Working week</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3.5">
                    <Row
                      label="Standard hours"
                      value={`${minutesToClock12(organization.workdayStartMinutes)} – ${minutesToClock12(organization.workdayEndMinutes)}`}
                    />
                    <Row label="Weekend" value={weekendLabels || "None"} />
                    <Row label="Full day" value={`${organization.fullDayHours} hours`} />
                    <Row label="Half day threshold" value={`${organization.halfDayHours} hours`} />
                  </CardContent>
                </Card>

                <div className="lg:col-span-2">
                  <HolidayManager holidays={holidays} canManage={false} />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="attendance">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>Timing rules</CardTitle>
                    <p className="mt-1 text-sm text-ink-muted">
                      What counts as late, and what counts as a full day.
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <Setting
                    title="Grace period"
                    value={`${organization.gracePeriodMinutes} minutes`}
                    description="An arrival after the workday start plus this window is marked Late."
                  />
                  <Setting
                    title="Full-day hours"
                    value={`${organization.fullDayHours} h`}
                    description="Time worked beyond this counts as overtime."
                  />
                  <Setting
                    title="Half-day threshold"
                    value={`${organization.halfDayHours} h`}
                    description="A day shorter than this is recorded as a half day."
                  />
                </CardContent>
              </Card>

              {canManage ? (
                <AttendancePolicyForm
                  initial={{
                    maxAccuracyMeters: organization.maxAccuracyMeters,
                    maxTravelSpeedKmh: organization.maxTravelSpeedKmh,
                    enforceGeofence: organization.enforceGeofence,
                    allowManualOverride: organization.allowManualOverride,
                    requireCheckoutLocation: organization.requireCheckoutLocation,
                  }}
                />
              ) : (
                <Card>
                  <CardHeader>
                    <div className="min-w-0">
                      <CardTitle>Location policy</CardTitle>
                      <p className="mt-1 text-sm text-ink-muted">
                        How strictly check-in location is enforced.
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <Setting
                      title="Enforce geofence"
                      value={organization.enforceGeofence ? "Enabled" : "Advisory only"}
                      description={
                        organization.enforceGeofence
                          ? "Check-ins outside a perimeter are refused."
                          : "Out-of-perimeter check-ins are recorded and flagged, but allowed."
                      }
                    />
                    <Setting
                      title="Maximum GPS accuracy"
                      value={`${organization.maxAccuracyMeters} m`}
                      description="A reading vaguer than this is refused — it cannot decide a perimeter either way."
                    />
                    <Setting
                      title="Impossible-travel threshold"
                      value={`${organization.maxTravelSpeedKmh} km/h`}
                      description="Movement faster than this between two fixes raises a risk flag."
                    />
                    <Setting
                      title="Manual corrections"
                      value={organization.allowManualOverride ? "Allowed" : "Disabled"}
                      description="HR can amend a record, always with a reason and an audit entry."
                    />
                    <Setting
                      title="Location on check-out"
                      value={organization.requireCheckoutLocation ? "Required" : "Optional"}
                      description="Whether leaving also needs a verified position."
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="locations">
            <Card>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>Offices</CardTitle>
                  <p className="mt-1 text-sm text-ink-muted">
                    Each office carries its own coordinates, radius, hours and timezone.
                  </p>
                </div>
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/app/locations">Manage geofences</Link>
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {offices.map((office) => {
                  const primary = office.geofences.find((zone) => zone.isPrimary) ?? office.geofences[0];
                  return (
                    <div
                      key={office.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{office.name}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {office.city} · {office.timezone} ·{" "}
                          {minutesToClock12(office.workdayStartMinutes)}–
                          {minutesToClock12(office.workdayEndMinutes)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone="brand" size="sm">
                          {primary?.radiusMeters ?? "—"} m
                        </Badge>
                        <Badge tone={office.status === "ACTIVE" ? "success" : "neutral"} size="sm">
                          {office.status === "ACTIVE" ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="roles">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>Roles</CardTitle>
                    <p className="mt-1 text-sm text-ink-muted">
                      What each role can do. Enforced server-side on every request.
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
                    <div key={role} className="rounded-xl border border-line bg-surface-2/40 p-4">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{ROLE_LABELS[role]}</p>
                        {session.user.role === role ? (
                          <Badge tone="brand" size="sm">
                            You
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                        {ROLE_DESCRIPTIONS[role]}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <div className="min-w-0">
                      <CardTitle>
                        <span className="flex items-center gap-2">
                          <KeyRound className="size-4 text-ink-muted" aria-hidden />
                          Authentication
                        </span>
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft/40 p-4">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      <div className="min-w-0 text-xs leading-relaxed text-ink-secondary">
                        <p className="font-semibold text-ink">
                          Session strategy: {session.strategy}
                        </p>
                        <p className="mt-1">
                          {session.strategy === "dev-impersonation"
                            ? "This deployment uses the development impersonation adapter — no credentials are verified. It is refused outright in production."
                            : "Sessions are established by the configured authentication provider."}
                        </p>
                        <p className="mt-1.5">
                          Register a real provider by implementing <code className="font-mono">AuthAdapter</code>{" "}
                          in <code className="font-mono">src/server/auth/index.ts</code>. Email/password,
                          phone OTP, Google, Microsoft and SSO all fit the same interface.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {can(session, "audit:read") ? (
                  <Card>
                    <CardHeader>
                      <div className="min-w-0">
                        <CardTitle>
                          <span className="flex items-center gap-2">
                            <FileClock className="size-4 text-ink-muted" aria-hidden />
                            Audit log
                          </span>
                        </CardTitle>
                        <p className="mt-1 text-sm text-ink-muted">
                          Every sensitive change, with who made it and when.
                        </p>
                      </div>
                      <Button variant="secondary" size="sm" asChild>
                        <Link href="/app/settings/audit">Open</Link>
                      </Button>
                    </CardHeader>
                  </Card>
                ) : null}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-sm text-ink-muted">{label}</span>
      <span className={`min-w-0 truncate text-sm text-ink ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Setting({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-sm font-semibold tabular text-brand">{value}</p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
