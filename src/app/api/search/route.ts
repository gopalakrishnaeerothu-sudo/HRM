import { z } from "zod";

import { likePattern, query } from "@/server/db/query";
import { exec } from "@/server/db/tenant";
import { parseQuery, route } from "@/server/api/handler";
import { resolveVisibleEmployeeIds, tenantScopeFor } from "@/server/services/access-service";

/**
 * GET /api/search?q=…
 *
 * Backs the ⌘K / Ctrl-K command palette. Tenant-scoped by construction, and
 * tasks are further narrowed to the caller's visibility envelope, so search is
 * not a way around the permissions applied to the list views.
 */

const querySchema = z.object({
  q: z.string().trim().min(1).max(80),
});

export const GET = route({
  handler: async ({ session, request }) => {
    const { q } = parseQuery(request, querySchema);
    const scope = tenantScopeFor(session);
    const envelope = await resolveVisibleEmployeeIds(session);
    const term = q;

    // Prisma's `contains` escaped LIKE metacharacters for us. Raw SQL does not:
    // parameterising the value stops injection but leaves % and _ acting as
    // wildcards, so searching "%" would return the entire tenant.
    const pattern = likePattern(term);

    const [employees, tasks, teams, offices] = await Promise.all([
      query<{
        id: string;
        first_name: string;
        last_name: string;
        designation: string;
        avatar_url: string | null;
      }>(
        `SELECT id, first_name, last_name, designation, avatar_url
           FROM employees
          WHERE organization_id = $1
            AND deleted_at IS NULL
            AND (first_name ILIKE $2 ESCAPE '\'
              OR last_name ILIKE $2 ESCAPE '\'
              OR email ILIKE $2 ESCAPE '\'
              OR employee_code ILIKE $2 ESCAPE '\'
              OR designation ILIKE $2 ESCAPE '\')
          ORDER BY first_name ASC
          LIMIT 6`,
        [scope.organizationId, pattern],
        exec(scope),
      ),

      query<{
        id: string;
        reference: number;
        title: string;
        status: string;
        priority: string;
      }>(
        `SELECT t.id, t.reference, t.title, t.status, t.priority
           FROM tasks t
          WHERE t.organization_id = $1
            AND t.deleted_at IS NULL
            AND (t.title ILIKE $2 ESCAPE '\' OR $3 = ANY(t.tags))
            AND ($4::uuid[] IS NULL
                 OR t.creator_id = ANY($4::uuid[])
                 OR EXISTS (SELECT 1 FROM task_assignees ta
                             WHERE ta.task_id = t.id
                               AND ta.employee_id = ANY($4::uuid[])))
          ORDER BY t.reference DESC
          LIMIT 6`,
        [scope.organizationId, pattern, term.toLowerCase(), envelope ? [...envelope] : null],
        exec(scope),
      ),

      query<{ id: string; name: string; color: string; member_count: string }>(
        `SELECT t.id, t.name, t.color,
                (SELECT count(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count
           FROM teams t
          WHERE t.organization_id = $1
            AND t.deleted_at IS NULL
            AND t.name ILIKE $2 ESCAPE '\'
          ORDER BY t.name ASC
          LIMIT 4`,
        [scope.organizationId, pattern],
        exec(scope),
      ),

      query<{ id: string; name: string; city: string }>(
        `SELECT id, name, city
           FROM offices
          WHERE organization_id = $1
            AND deleted_at IS NULL
            AND (name ILIKE $2 ESCAPE '\' OR city ILIKE $2 ESCAPE '\')
          ORDER BY name ASC
          LIMIT 4`,
        [scope.organizationId, pattern],
        exec(scope),
      ),
    ]);

    return {
      employees: employees.map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        designation: row.designation,
        avatarUrl: row.avatar_url,
      })),
      tasks,
      teams: teams.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        _count: { members: Number(row.member_count) },
      })),
      offices,
    };
  },
});
