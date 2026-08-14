/**
 * CSV serialisation (RFC 4180).
 *
 * Two details that matter more than they look:
 *
 * 1. **Formula injection.** A cell starting with `=`, `+`, `-`, `@`, tab or CR
 *    is executed as a formula when the file is opened in Excel or Sheets. An
 *    employee named `=cmd|…` would then run on the machine of whoever opened
 *    the export. Such cells are prefixed with a single quote, which Excel
 *    strips on display but does not execute.
 *
 * 2. **BOM.** Excel assumes the system codepage unless a UTF-8 byte-order mark
 *    is present, which mangles any non-ASCII name. `toCsvBlob` prepends one.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  } else if (typeof value === "boolean") {
    return value ? "true" : "false";
  } else {
    text = String(value);
  }

  // Neutralise spreadsheet formula injection before quoting.
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;

  if (NEEDS_QUOTING.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface CsvColumn<T> {
  /** Header text. */
  header: string;
  /** Pull the cell value out of a row. */
  value: (row: T) => unknown;
}

/** Serialise rows to a CSV string, headers included. */
export function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string {
  const lines: string[] = [columns.map((column) => escapeCell(column.header)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value(row))).join(","));
  }

  // CRLF per RFC 4180 — Excel is the primary consumer.
  return lines.join("\r\n");
}

/**
 * Reduce an arbitrary string to a safe `filename` value: word characters,
 * single dots and hyphens only. Path separators and `..` sequences are
 * collapsed so the header can never suggest a traversal.
 */
function safeFilename(filename: string): string {
  return (
    filename
      .replace(/[^\w.\-]/g, "_")
      // Collapse any run of dots to one, which kills "..".
      .replace(/\.{2,}/g, ".")
      .replace(/^[.\-]+/, "")
      .slice(0, 120) || "export.csv"
  );
}

/** A `Response` that downloads as a CSV file, UTF-8 BOM included. */
export function csvResponse(csv: string, filename: string): Response {
  // U+FEFF, written as an escape rather than a literal so it survives any
  // editor or tool that would otherwise strip an invisible leading character.
  const body = `\uFEFF${csv}`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // The quoted filename survives spaces; the header stays ASCII-only.
      "Content-Disposition": `attachment; filename="${safeFilename(filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** "attendance-2026-08-08.csv" */
export function timestampedFilename(base: string, extension = "csv"): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
