import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { employeeQuerySchema } from "@/lib/validation/employee";
import { requirePagePermission, getSession, can } from "@/server/auth";
import { employeeService } from "@/server/services/employee-service";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmployeeDirectory } from "@/components/employees/employee-directory";

export const metadata: Metadata = { title: "Employees" };

/**
 * Employee directory.
 *
 * Filters travel in the URL, so a filtered view is shareable and survives a
 * refresh. They are parsed with the same Zod schema the API uses; anything
 * malformed falls back to defaults rather than erroring the page.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("employee:read");
  const session = await getSession();

  const params = await searchParams;
  const parsed = employeeQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : employeeQuerySchema.parse({});

  const [result, options] = await Promise.all([
    employeeService.list(session!, query),
    employeeService.filterOptions(session!),
  ]);

  const canCreate = can(session, "employee:create");

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${result.total} ${result.total === 1 ? "person" : "people"} in ${session!.organization.name}.`}
        actions={
          canCreate ? (
            <Button size="sm" asChild>
              <Link href="/app/employees/new">
                <Plus aria-hidden />
                Add employee
              </Link>
            </Button>
          ) : null
        }
      />

      <PageBody>
        <EmployeeDirectory
          initialResult={result}
          options={options}
          query={query}
          canManage={can(session, "employee:update")}
        />
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
