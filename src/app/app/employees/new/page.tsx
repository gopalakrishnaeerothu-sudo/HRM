import type { Metadata } from "next";

import { requirePagePermission } from "@/server/auth";
import { employeeService } from "@/server/services/employee-service";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmployeeForm } from "@/components/employees/employee-form";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  // Gated server-side; the "Add employee" button is merely hidden for others.
  const session = await requirePagePermission("employee:create");

  const [options, employees] = await Promise.all([
    employeeService.filterOptions(session),
    employeeService.listAll(session),
  ]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Employees", href: "/app/employees" }, { label: "Add employee" }]}
        title="Add employee"
        description="Create a profile. Assigning an office is what lets them check in from its geofence."
      />
      <PageBody>
        <EmployeeForm
          options={{
            departments: options.departments,
            offices: options.offices,
            managers: employees.map((employee) => ({
              id: employee.id,
              name: `${employee.firstName} ${employee.lastName}`,
              designation: employee.designation,
            })),
          }}
        />
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
