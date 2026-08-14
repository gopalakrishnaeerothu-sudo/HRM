import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePagePermission } from "@/server/auth";
import { employeeRepository } from "@/server/repositories/employee-repository";
import { employeeService } from "@/server/services/employee-service";
import { tenantScopeFor } from "@/server/services/access-service";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmployeeForm, toFormValues } from "@/components/employees/employee-form";

export const metadata: Metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePagePermission("employee:update");
  const { id } = await params;

  const [employee, options, employees] = await Promise.all([
    employeeRepository.findById(tenantScopeFor(session), id),
    employeeService.filterOptions(session),
    employeeService.listAll(session),
  ]);

  if (!employee) notFound();

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Employees", href: "/app/employees" },
          { label: `${employee.firstName} ${employee.lastName}`, href: `/app/employees/${id}` },
          { label: "Edit" },
        ]}
        title={`Edit ${employee.firstName} ${employee.lastName}`}
        description="Changes are recorded in the audit log with your name against them."
      />
      <PageBody>
        <EmployeeForm
          employeeId={id}
          initialValues={toFormValues(employee)}
          options={{
            departments: options.departments,
            offices: options.offices,
            managers: employees.map((candidate) => ({
              id: candidate.id,
              name: `${candidate.firstName} ${candidate.lastName}`,
              designation: candidate.designation,
            })),
          }}
        />
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
