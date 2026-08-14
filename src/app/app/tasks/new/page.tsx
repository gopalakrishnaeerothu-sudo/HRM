import type { Metadata } from "next";

import { requirePermission } from "@/server/auth";
import { employeeService } from "@/server/services/employee-service";
import { teamRepository } from "@/server/repositories/org-repository";
import { tenantScopeFor } from "@/server/services/access-service";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { TaskForm } from "@/components/tasks/task-form";

export const metadata: Metadata = { title: "New task" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePermission("task:create");
  const { status } = await searchParams;

  const [employees, teams] = await Promise.all([
    employeeService.listAll(session),
    teamRepository.list(tenantScopeFor(session)),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Tasks", href: "/app/tasks" }, { label: "New task" }]}
        title="New task"
        description="Assignees are notified as soon as the task is created."
      />
      <PageBody>
        <TaskForm
          defaultStatus={status ?? "TODO"}
          employees={employees.map((employee) => ({
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
            designation: employee.designation,
            avatarUrl: employee.avatarUrl,
          }))}
          teams={teams.map((team) => ({ id: team.id, name: team.name, color: team.color }))}
        />
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
