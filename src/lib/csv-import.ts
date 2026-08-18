/**
 * CSV parsing (RFC 4180) for data import.
 *
 * Deliberately hand-written rather than a split(","): a real spreadsheet
 * export contains quoted fields with commas and newlines inside them, and
 * splitting on the delimiter corrupts exactly the rows a user is most likely
 * to care about — addresses, notes, names with commas.
 *
 * This module only turns text into rows and reports what it could not read.
 * It performs no authorisation and writes nothing; validating the values and
 * deciding who may import them is the caller's job.
 */

/** Rows are capped so a pasted 200MB file cannot exhaust server memory. */
export const MAX_IMPORT_ROWS = 5_000;

export interface CsvParseError {
  /** 1-based line in the source file, so it matches what the user sees. */
  line: number;
  message: string;
}

export interface CsvParseResult {
  headers: string[];
  rows: Array<Record<string, string>>;
  errors: CsvParseError[];
  /** True when parsing stopped early because MAX_IMPORT_ROWS was reached. */
  truncated: boolean;
}

interface RawRecord {
  fields: string[];
  /** 1-based line the record STARTS on, which is not its index once a quoted
   *  field contains a newline. Error messages must point at the real line. */
  line: number;
}

/**
 * Split CSV text into raw fields, honouring quotes.
 *
 * Handles: quoted fields, escaped quotes (`""`), commas and newlines inside
 * quotes, CRLF and LF line endings, and a UTF-8 BOM.
 */
function splitRecords(text: string): { records: RawRecord[]; errors: CsvParseError[] } {
  // Excel writes a BOM; left in place it becomes part of the first header name
  // and every lookup against that column silently misses.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: RawRecord[] = [];
  const errors: CsvParseError[] = [];

  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let fieldStartLine = 1;
  let recordStartLine = 1;

  const endField = () => {
    record.push(field);
    field = "";
    fieldStartLine = line;
  };

  const endRecord = () => {
    endField();
    // A trailing newline produces one empty field; that is not a record.
    if (record.length > 1 || record[0] !== "") {
      records.push({ fields: record, line: recordStartLine });
    }
    record = [];
    // The next record begins on whatever line follows the one just closed.
    recordStartLine = line + 1;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) {
        // A quote appearing mid-field is malformed. Keep it literally rather
        // than discarding the row: a slightly odd value beats a missing person.
        errors.push({
          line,
          message: "Unexpected quote inside an unquoted field; treated as text.",
        });
        field += char;
      } else {
        inQuotes = true;
        fieldStartLine = line;
      }
      continue;
    }

    if (char === ",") {
      endField();
      continue;
    }

    if (char === "\r") {
      if (input[index + 1] === "\n") index += 1;
      endRecord();
      line += 1;
      continue;
    }

    if (char === "\n") {
      endRecord();
      line += 1;
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    errors.push({
      line: fieldStartLine,
      message: "File ended inside a quoted value — the quotes are unbalanced.",
    });
  }

  // Whatever is left after the last newline is a final record.
  if (field.length > 0 || record.length > 0) endRecord();

  return { records, errors };
}

/** Normalise a header so "First Name", "first_name" and "firstName" all match. */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/**
 * Parse CSV text into keyed rows.
 *
 * Rows are keyed by NORMALISED header, so callers look up `firstname`
 * regardless of how the spreadsheet spelled it.
 */
export function parseCsv(text: string): CsvParseResult {
  const { records, errors } = splitRecords(text);

  if (records.length === 0) {
    return { headers: [], rows: [], errors: [{ line: 1, message: "The file is empty." }], truncated: false };
  }

  const rawHeaders = records[0]!.fields.map((header) => header.trim());
  const headers = rawHeaders.map(normaliseHeader);

  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (header === "") {
      errors.push({ line: 1, message: `Column ${index + 1} has no heading.` });
      return;
    }
    if (seen.has(header)) {
      // Two columns mapping to one key means the later one silently wins,
      // which is how an import quietly writes the wrong field.
      errors.push({ line: 1, message: `Duplicate column “${rawHeaders[index]}”.` });
    }
    seen.add(header);
  });

  const rows: Array<Record<string, string>> = [];
  let truncated = false;

  for (let index = 1; index < records.length; index += 1) {
    if (rows.length >= MAX_IMPORT_ROWS) {
      truncated = true;
      break;
    }

    const { fields, line } = records[index]!;

    if (fields.every((cell) => cell.trim() === "")) continue;

    if (fields.length !== headers.length) {
      errors.push({
        line,
        message: `Expected ${headers.length} columns but found ${fields.length}.`,
      });
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (header === "") return;
      row[header] = fields[column]!.trim();
    });
    rows.push(row);
  }

  return { headers, rows, errors, truncated };
}

/**
 * Confirm the columns a caller depends on are present.
 *
 * Returns the missing ones so the UI can name them, rather than importing a
 * file that is quietly missing half its fields.
 */
export function missingColumns(
  headers: readonly string[],
  required: readonly string[],
): string[] {
  const present = new Set(headers);
  return required.filter((column) => !present.has(normaliseHeader(column)));
}
