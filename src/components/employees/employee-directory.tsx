"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, Pencil, Search, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/time";
import type { EmployeeQuery } from "@/lib/validation/employee";
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS } from "@/lib/validation/employee";
import type { EmployeeSummary } from "@/server/repositories/employee-repository";
import type { Paginated } from "@/server/repositories/tenant";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NoResultsState } from "@/components/ui/states";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from "@/components/ui/table";

/**
 * Directory with URL-driven filters.
 *
 * All filter state lives in the query string. That makes a filtered view
 * linkable, keeps the back button meaningful, and means the server does the
 * filtering — the client never holds the full employee list in memory.
 */

interface FilterOptions {
  departments: Array<{ id: string; name: string; color: string }>;
  offices: Array<{ id: string; name: string; city: string }>;
  teams: Array<{ id: string; name: string; color: string }>;
}

const STATUS_TONE = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  ON_LEAVE: "info",
  SUSPENDED: "critical",
} as const;

const ALL = "__all__";

export function EmployeeDirectory({
  initialResult,
  options,
  query,
  canManage,
}: {
  initialResult: Paginated<EmployeeSummary>;
  options: FilterOptions;
  query: EmployeeQuery;
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = React.useState(query.search ?? "");
  const [view, setView] = React.useState<"table" | "grid">("table");
  const [pending, startTransition] = React.useTransition();

  /** Merge params, resetting to page 1 whenever a filter changes. */
  const setParam = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === ALL) next.delete(key);
        else next.set(key, value);
      }
      if (!("page" in updates)) next.delete("page");
      startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Debounce the search box so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const current = query.search ?? "";
    if (search === current) return;
    const timer = window.setTimeout(() => setParam({ search: search || undefined }), 350);
    return () => window.clearTimeout(timer);
  }, [search, query.search, setParam]);

  const { items, total, page, pageCount } = initialResult;
  const hasFilters = Boolean(
    query.search || query.status || query.departmentId || query.officeId || query.teamId,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filter row: one line on desktop, wrapping on smaller screens. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[12rem] flex-1 sm:max-w-sm">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, email or ID…"
            leadingIcon={<Search />}
            aria-label="Search employees"
          />
        </div>

        <Select
          value={query.status ?? ALL}
          onValueChange={(value) => setParam({ status: value })}
        >
          <SelectTrigger className="w-auto min-w-[9rem]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {Object.entries(EMPLOYEE_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={query.departmentId ?? ALL}
          onValueChange={(value) => setParam({ departmentId: value })}
        >
          <SelectTrigger className="w-auto min-w-[10rem]" aria-label="Filter by department">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {options.departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={query.officeId ?? ALL} onValueChange={(value) => setParam({ officeId: value })}>
          <SelectTrigger className="w-auto min-w-[9rem]" aria-label="Filter by office">
            <SelectValue placeholder="Office" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All offices</SelectItem>
            {options.offices.map((office) => (
              <SelectItem key={office.id} value={office.id}>
                {office.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1 rounded-lg border border-line p-0.5">
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="icon-xs"
            onClick={() => setView("table")}
            aria-label="Table view"
            aria-pressed={view === "table"}
          >
            <List aria-hidden />
          </Button>
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon-xs"
            onClick={() => setView("grid")}
            aria-label="Card view"
            aria-pressed={view === "grid"}
          >
            <LayoutGrid aria-hidden />
          </Button>
        </div>
      </div>

      <Card variant="glass" className={cn("overflow-hidden", pending && "opacity-70 transition-opacity")}>
        {items.length === 0 ? (
          hasFilters ? (
            <NoResultsState
              query={query.search}
              onClear={() =>
                setParam({
                  search: undefined,
                  status: undefined,
                  departmentId: undefined,
                  officeId: undefined,
                  teamId: undefined,
                })
              }
            />
          ) : (
            <div className="px-6 py-16 text-center">
              <Users className="mx-auto size-8 text-ink-muted" aria-hidden />
              <p className="mt-3 text-base font-semibold text-ink">No employees yet</p>
              <p className="mt-1 text-sm text-ink-muted">
                Add your first employee, or run the seed script for demo data.
              </p>
            </div>
          )
        ) : view === "table" ? (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? (
                    <TableHead className="w-16 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((employee) => (
                  <TableRow key={employee.id} interactive>
                    <TableCell>
                      <Link
                        href={`/app/employees/${employee.id}`}
                        className="flex min-w-0 items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                      >
                        <Avatar
                          name={`${employee.firstName} ${employee.lastName}`}
                          src={employee.avatarUrl}
                          size="sm"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">
                            {employee.firstName} {employee.lastName}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">
                            {employee.designation} · {employee.employeeCode}
                          </span>
                        </span>
                      </Link>
                    </TableCell>

                    <TableCell>
                      {employee.department ? (
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: employee.department.color }}
                            aria-hidden
                          />
                          <span className="truncate text-ink-secondary">
                            {employee.department.name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-ink-secondary">
                      {employee.primaryOffice?.name ?? "—"}
                    </TableCell>

                    <TableCell className="text-ink-secondary">
                      {EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-ink-secondary">
                      {formatDate(employee.joinedAt)}
                    </TableCell>

                    <TableCell>
                      <Badge tone={STATUS_TONE[employee.status]} size="sm">
                        {EMPLOYEE_STATUS_LABELS[employee.status]}
                      </Badge>
                    </TableCell>

                    {canManage ? (
                      <TableCell className="text-right">
                        <Link
                          href={`/app/employees/${employee.id}/edit`}
                          className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                          aria-label={`Edit ${employee.firstName} ${employee.lastName}`}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Link>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((employee) => (
              <li key={employee.id}>
                <Link
                  href={`/app/employees/${employee.id}`}
                  className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4 transition-all hover:-translate-y-0.5 hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 motion-reduce:hover:translate-y-0"
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={`${employee.firstName} ${employee.lastName}`}
                      src={employee.avatarUrl}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">
                        {employee.firstName} {employee.lastName}
                      </p>
                      <p className="truncate text-xs text-ink-muted">{employee.designation}</p>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-1.5">
                    <Badge tone={STATUS_TONE[employee.status]} size="sm">
                      {EMPLOYEE_STATUS_LABELS[employee.status]}
                    </Badge>
                    {employee.department ? (
                      <Badge tone="outline" size="sm">
                        {employee.department.name}
                      </Badge>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
          <p className="text-sm text-ink-muted">
            Page {page} of {pageCount} · {total} total
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setParam({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setParam({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
