import type { Metadata } from "next";
import Link from "next/link";
import { UsersRound } from "lucide-react";

import { formatNumber } from "@/lib/utils";
import { can, requirePermission } from "@/server/auth";
import { teamRepository } from "@/server/repositories/org-repository";
import { taskRepository } from "@/server/repositories/task-repository";
import { employeeService } from "@/server/services/employee-service";
import { tenantScopeFor } from "@/server/services/access-service";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { TeamFormDialog } from "@/components/teams/team-form-dialog";
import { Pencil } from "lucide-react";

export const metadata: Metadata = { title: "Teams" };

/**
 * Teams overview.
 *
 * Workload is normalised against the busiest team rather than an absolute
 * target, because "busy" only means anything relative to the rest of the
 * organisation — an absolute bar would be a number nobody could interpret.
 */
export default async function TeamsPage() {
  const session = await requirePermission("team:read");
  const scope = tenantScopeFor(session);

  const canManage = can(session, "team:manage");

  const [teams, allEmployees, filterOptions] = await Promise.all([
    teamRepository.list(scope),
    employeeService.listAll(session),
    employeeService.filterOptions(session),
  ]);

  const formOptions = {
    employees: allEmployees.map((employee) => ({
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      designation: employee.designation,
      avatarUrl: employee.avatarUrl,
    })),
    departments: filterOptions.departments.map((department) => ({
      id: department.id,
      name: department.name,
    })),
  };

  const allMemberIds = Array.from(
    new Set(teams.flatMap((team) => team.members.map((member) => member.employee.id))),
  );
  const workload = await taskRepository.workloadByEmployee(scope, allMemberIds);
  const loadById = new Map(workload.map((row) => [row.employeeId, row.openTasks]));

  const teamLoads = teams.map((team) => ({
    team,
    openTasks: team.members.reduce(
      (sum, member) => sum + (loadById.get(member.employee.id) ?? 0),
      0,
    ),
  }));
  const maxLoad = Math.max(1, ...teamLoads.map((entry) => entry.openTasks));

  const totalMembers = new Set(
    teams.flatMap((team) => team.members.map((member) => member.employee.id)),
  ).size;

  return (
    <>
      <PageHeader
        title="Teams"
        description={`${teams.length} ${teams.length === 1 ? "team" : "teams"} · ${formatNumber(totalMembers)} people assigned.`}
        actions={canManage ? <TeamFormDialog options={formOptions} /> : null}
      />

      <PageBody>
        {teams.length === 0 ? (
          <Card>
            <EmptyState
              icon={<UsersRound />}
              size="page"
              title="No teams yet"
              description="Group people into teams to track workload and attendance together."
              action={canManage ? <TeamFormDialog options={formOptions} /> : null}
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {teamLoads.map(({ team, openTasks }) => (
              <Card key={team.id} interactive className="flex flex-col">
                <CardHeader>
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="mt-1 size-3 shrink-0 rounded-full"
                      style={{ background: team.color }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <CardTitle className="truncate">{team.name}</CardTitle>
                      {team.department ? (
                        <p className="mt-1 truncate text-xs text-ink-muted">
                          {team.department.name}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="outline" size="sm">
                      {team._count.members} {team._count.members === 1 ? "member" : "members"}
                    </Badge>
                    {canManage ? (
                      <TeamFormDialog
                        teamId={team.id}
                        options={formOptions}
                        initial={{
                          name: team.name,
                          description: team.description ?? "",
                          color: team.color,
                          departmentId: team.department?.id ?? null,
                          managerId: team.manager?.id ?? null,
                          memberIds: team.members.map((member) => member.employee.id),
                        }}
                        trigger={
                          <Button variant="ghost" size="icon-xs" aria-label={`Edit ${team.name}`}>
                            <Pencil aria-hidden />
                          </Button>
                        }
                      />
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col gap-5">
                  {team.description ? (
                    <p className="line-clamp-2-safe text-sm leading-relaxed text-ink-muted">
                      {team.description}
                    </p>
                  ) : null}

                  {team.manager ? (
                    <div>
                      <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
                        Manager
                      </p>
                      <Link
                        href={`/app/employees/${team.manager.id}`}
                        className="flex min-w-0 items-center gap-2.5 rounded-lg transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                      >
                        <Avatar
                          name={`${team.manager.firstName} ${team.manager.lastName}`}
                          src={team.manager.avatarUrl}
                          size="sm"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">
                            {team.manager.firstName} {team.manager.lastName}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">
                            {team.manager.designation}
                          </span>
                        </span>
                      </Link>
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
                      Members
                    </p>
                    <AvatarGroup
                      size="sm"
                      max={6}
                      people={team.members.map((member) => ({
                        id: member.employee.id,
                        name: `${member.employee.firstName} ${member.employee.lastName}`,
                        avatarUrl: member.employee.avatarUrl,
                      }))}
                    />
                  </div>

                  <div className="mt-auto border-t border-line pt-4">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <span className="text-xs text-ink-muted">Open task load</span>
                      <span className="text-xs font-medium tabular text-ink">
                        {openTasks} open · {team._count.tasks} total
                      </span>
                    </div>
                    <Progress
                      value={(openTasks / maxLoad) * 100}
                      tone={openTasks / maxLoad > 0.8 ? "warning" : "brand"}
                      barSize="sm"
                      label={`${team.name} workload`}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
