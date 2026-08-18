import { describe, expect, it } from "vitest";

import {
  MAX_IMPORT_ROWS,
  missingColumns,
  normaliseHeader,
  parseCsv,
} from "@/lib/csv-import";

describe("parseCsv", () => {
  it("reads a simple file", () => {
    const result = parseCsv("First Name,Last Name\nAsha,Rao\nVikram,Singh");

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { firstname: "Asha", lastname: "Rao" },
      { firstname: "Vikram", lastname: "Singh" },
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    // The whole reason not to use split(","): this is one field, not two.
    const result = parseCsv('name,address\nAsha,"12 MG Road, Guntur"');

    expect(result.rows[0]!.address).toBe("12 MG Road, Guntur");
  });

  it("keeps newlines inside quoted fields", () => {
    const result = parseCsv('name,notes\nAsha,"Line one\nLine two"');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.notes).toBe("Line one\nLine two");
  });

  it("unescapes doubled quotes", () => {
    const result = parseCsv('name,nickname\nAsha,"She said ""hello"""');

    expect(result.rows[0]!.nickname).toBe('She said "hello"');
  });

  it("handles CRLF line endings", () => {
    const result = parseCsv("a,b\r\n1,2\r\n3,4");

    expect(result.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("strips a UTF-8 BOM from the first header", () => {
    // Left in place, the first column becomes "﻿name" and every lookup
    // against it silently misses.
    const result = parseCsv("﻿name,email\nAsha,asha@example.test");

    expect(result.headers[0]).toBe("name");
    expect(result.rows[0]!.name).toBe("Asha");
  });

  it("normalises header spelling", () => {
    const result = parseCsv("First Name,employee_code,LastName\nAsha,E-1,Rao");

    expect(result.headers).toEqual(["firstname", "employeecode", "lastname"]);
  });

  it("ignores blank lines", () => {
    const result = parseCsv("a,b\n1,2\n\n\n3,4\n");

    expect(result.rows).toHaveLength(2);
  });

  it("reports a row with the wrong number of columns, and skips it", () => {
    const result = parseCsv("a,b,c\n1,2,3\n4,5\n6,7,8");

    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(3);
    expect(result.errors[0]!.message).toMatch(/expected 3 columns but found 2/i);
  });

  it("reports line numbers that match the file, counting quoted newlines", () => {
    const result = parseCsv('a,b\n"multi\nline",2\n3');

    // The bad row is the 4th line of the file, not the 3rd record.
    expect(result.errors[0]!.line).toBe(4);
  });

  it("reports unbalanced quotes", () => {
    const result = parseCsv('name\n"unterminated');

    expect(result.errors.some((error) => /unbalanced/i.test(error.message))).toBe(true);
  });

  it("reports a duplicate column rather than letting one silently win", () => {
    const result = parseCsv("name,Name\nAsha,Rao");

    expect(result.errors.some((error) => /duplicate/i.test(error.message))).toBe(true);
  });

  it("reports an unnamed column", () => {
    const result = parseCsv("name,,email\nAsha,x,a@b.test");

    expect(result.errors.some((error) => /no heading/i.test(error.message))).toBe(true);
  });

  it("reports an empty file", () => {
    expect(parseCsv("").errors[0]!.message).toMatch(/empty/i);
  });

  it("caps the number of rows", () => {
    const lines = ["a"];
    for (let index = 0; index < MAX_IMPORT_ROWS + 50; index += 1) lines.push(String(index));

    const result = parseCsv(lines.join("\n"));

    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(result.truncated).toBe(true);
  });

  it("does not flag a well-formed file as truncated", () => {
    expect(parseCsv("a\n1\n2").truncated).toBe(false);
  });

  it("keeps a formula-looking cell as text without executing anything", () => {
    // Import is the mirror of the export guard: the value is data either way.
    const result = parseCsv("name\n=SUM(A1:A2)");

    expect(result.rows[0]!.name).toBe("=SUM(A1:A2)");
  });

  it("round-trips a value containing every awkward character", () => {
    const nasty = 'Comma, "quote", \nnewline';
    const escaped = `"${nasty.replace(/"/g, '""')}"`;

    expect(parseCsv(`value\n${escaped}`).rows[0]!.value).toBe(nasty);
  });
});

describe("normaliseHeader", () => {
  it("collapses spacing, casing and separators", () => {
    for (const header of ["First Name", "first_name", "FIRST-NAME", "  firstName  "]) {
      expect(normaliseHeader(header)).toBe("firstname");
    }
  });
});

describe("missingColumns", () => {
  it("names the columns that are absent", () => {
    const headers = ["firstname", "lastname"];

    expect(missingColumns(headers, ["First Name", "Email", "Designation"])).toEqual([
      "Email",
      "Designation",
    ]);
  });

  it("returns nothing when everything is present", () => {
    expect(missingColumns(["firstname", "email"], ["First Name", "email"])).toEqual([]);
  });
});
