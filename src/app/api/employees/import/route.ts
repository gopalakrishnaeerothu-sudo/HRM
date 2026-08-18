import { z } from "zod";

import { missingColumns, parseCsv, type CsvParseError } from "@/lib/csv-import";
import { createEmployeeSchema } from "@/lib/validation/employee";
import { route } from "@/server/api/handler";
import { tenantScopeFor } from "@/server/services/access-service";
import { auditService } from "@/server/services/audit-service";
import { employeeService } from "@/server/services/employee-service";

/**
 * POST /api/employees/import
 *
 * Bulk-create employees from a CSV file.
 *
 * Design decisions worth stating, because a bulk import is the easiest place
 * to do a lot of damage quickly:
 *
 *  - **Dry run by default.** Nothing is written unless `commit` is explicitly
 *    true. The caller gets back exactly what would happen, row by row, and has
 *    to ask a second time to actually do it.
 *  - **Names, not ids.** The file references departments and offices by name
 *    or code, resolved against THIS tenant. A raw id in a spreadsheet would
 *    let someone paste an id belonging to another organisation.
 *  - **Per-row isolation.** One malformed row is reported and skipped; it does
 *    not abort the other 400. The response names the file line so the user can
 *    fix it in their spreadsheet.
 *  - **Audited.** Creating people in bulk is exactly the action an
 *    administrator would later need to account for.
 */

const REQUIRED_COLUMNS = ["First name", "Last name", "Email", "Designation"] as const;

/** Cap on the file itself, before parsing, so a huge upload is rejected early. */
const MAX_BYTES = 2 * 1024 * 1024;

const bodySchema = z.object({
  csv: z.string().min(1, "The file is empty.").max(MAX_BYTES, "The file is too large (2MB limit)."),
  /** Must be sent explicitly. Absent or false means "tell me what would happen". */
  commit: z.boolean().default(false),
});

interface RowOutcome {
  line: number;
  employeeCode?: string;
  name: string;
  status: "created" | "skipped" | "invalid";
  message?: string;
}

/** Accepts "12/03/2026", "2026-03-12" and Excel's "12-Mar-2026". */
function parseDate(value: string): Date | null {
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (dmy) {
    // Day-first: the app's locale is en-IN, and reading 03/12 as March 12th
    // when the user meant 3 December silently shifts someone's start date.
    return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const POST = route({
  permission: "employee:create",
  schema: bodySchema,
  handler: async ({ session, body }) => {
    const parsed = parseCsv(body.csv);

    const absent = missingColumns(parsed.headers, REQUIRED_COLUMNS);
    if (absent.length > 0) {
      return Response.json(
        {
          ok: false,
          error: `The file is missing required columns: ${absent.join(", ")}.`,
          expected: REQUIRED_COLUMNS,
          found: parsed.headers,
        },
        { status: 422 },
      );
    }

    // Resolve departments and offices by name/code within this tenant only.
    const options = await employeeService.filterOptions(session);

    const departmentByName = new Map<string, string>();
    for (const department of options.departments) {
      departmentByName.set(department.name.trim().toLowerCase(), department.id);
    }

    const officeByName = new Map<string, string>();
    for (const office of options.offices) {
      officeByName.set(office.name.trim().toLowerCase(), office.id);
      if (office.city) officeByName.set(office.city.trim().toLowerCase(), office.id);
    }

    const outcomes: RowOutcome[] = [];
    const parseErrors: CsvParseError[] = [...parsed.errors];

    // Catch duplicates within the file itself. Two rows with one email would
    // otherwise fail on the second insert, after the first had been written.
    const emailsInFile = new Set<string>();

    for (const [index, row] of parsed.rows.entries()) {
      // +2: one for the header, one because lines are 1-based.
      const line = index + 2;
      const name = [row.firstname, row.lastname].filter(Boolean).join(" ") || "(no name)";
      const email = (row.email ?? "").toLowerCase();

      if (emailsInFile.has(email)) {
        outcomes.push({
          line,
          name,
          status: "invalid",
          message: `Duplicate email “${email}” — it appears earlier in this file.`,
        });
        continue;
      }
      emailsInFile.add(email);

      const departmentId = row.department
        ? departmentByName.get(row.department.toLowerCase())
        : undefined;
      if (row.department && !departmentId) {
        outcomes.push({
          line,
          name,
          status: "invalid",
          message: `Unknown department “${row.department}”.`,
        });
        continue;
      }

      const officeId = row.office ? officeByName.get(row.office.toLowerCase()) : undefined;
      if (row.office && !officeId) {
        outcomes.push({ line, name, status: "invalid", message: `Unknown office “${row.office}”.` });
        continue;
      }

      const joinedAt = row.joinedat ? parseDate(row.joinedat) : new Date();
      if (row.joinedat && !joinedAt) {
        outcomes.push({
          line,
          name,
          status: "invalid",
          message: `Could not read the joining date “${row.joinedat}”. Use YYYY-MM-DD.`,
        });
        continue;
      }

      const candidate = {
        firstName: row.firstname,
        lastName: row.lastname,
        email: row.email,
        phone: row.phone || undefined,
        designation: row.designation,
        employeeCode: row.employeecode || undefined,
        departmentId: departmentId ?? null,
        primaryOfficeId: officeId ?? null,
        employmentType: (row.employmenttype || "FULL_TIME").toUpperCase(),
        status: (row.status || "ACTIVE").toUpperCase(),
        joinedAt: joinedAt ?? new Date(),
      };

      const validated = createEmployeeSchema.safeParse(candidate);
      if (!validated.success) {
        const first = validated.error.issues[0];
        outcomes.push({
          line,
          name,
          status: "invalid",
          message: first ? `${first.path.join(".")}: ${first.message}` : "Invalid row.",
        });
        continue;
      }

      if (!body.commit) {
        outcomes.push({ line, name, status: "created", message: "Would be created." });
        continue;
      }

      try {
        const created = await employeeService.create(session, validated.data);
        outcomes.push({ line, name, employeeCode: created.employeeCode, status: "created" });
      } catch (error) {
        // A unique-constraint clash (email or code already used) is a per-row
        // problem, not a reason to abandon the rest of the file.
        outcomes.push({
          line,
          name,
          status: "skipped",
          message: error instanceof Error ? error.message : "Could not be created.",
        });
      }
    }

    const created = outcomes.filter((outcome) => outcome.status === "created").length;
    const invalid = outcomes.filter((outcome) => outcome.status === "invalid").length;
    const skipped = outcomes.filter((outcome) => outcome.status === "skipped").length;

    if (body.commit && created > 0) {
      await auditService.record(tenantScopeFor(session), session, {
        action: "CREATE",
        entityType: "employees",
        summary: `Imported ${created} employee${created === 1 ? "" : "s"} from CSV`,
        changes: { created, invalid, skipped, rows: parsed.rows.length },
      });
    }

    return Response.json({
      ok: true,
      committed: body.commit,
      summary: {
        rows: parsed.rows.length,
        created,
        invalid,
        skipped,
        truncated: parsed.truncated,
      },
      parseErrors,
      // Cap the detail so a 5,000-row file does not return a 5,000-entry body.
      outcomes: outcomes.slice(0, 200),
    });
  },
});
