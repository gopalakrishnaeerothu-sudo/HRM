import type { Metadata } from "next";

import { taskQuerySchema, type TaskQuery } from "@/lib/validation/task";
import { can, requirePermission } from "@/server/auth";
import { taskService } from "@/server/services/task-service";
import { teamRepository } from "@/server/repositories/org-repository";
import { tenantScopeFor } from "@/server/services/access-service";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { TaskWorkspace } from "@/components/tasks/task-workspace";

export const metadata: Metadata = { title: "Tasks" };

/**
 * Tasks page.
 *
 * The board needs the whole (capped) result set rather than a page of it, so
 * this uses `taskService.board`, which applies the same visibility envelope as
 * the paginated list. `scope` in the URL is a request, not a grant — the
 * service intersects it with what the caller may see.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission("task:read");
  const params = await searchParams;

  const parsed = taskQuerySchema.safeParse(params);
  const query: TaskQuery = parsed.success ? parsed.data : taskQuerySchema.parse({});

  const [tasks, teams] = await Promise.all([
    taskService.board(session, query),
    teamRepository.list(tenantScopeFor(session)),
  ]);

  const openCount = tasks.filter((task) => task.status !== "COMPLETED").length;

  return (
    <>
      <PageHeader
        title="Tasks"
        description={`${openCount} open of ${tasks.length} visible to you.`}
      />
      <PageBody>
        <TaskWorkspace
          tasks={tasks}
          teams={teams.map((team) => ({ id: team.id, name: team.name, color: team.color }))}
          canCreate={can(session, "task:create")}
        />
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
