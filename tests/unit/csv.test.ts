import { describe, expect, it } from "vitest";

import { csvResponse, timestampedFilename, toCsv } from "@/lib/csv";

/**
 * CSV serialisation.
 *
 * The formula-injection cases are the reason this module exists rather than a
 * `rows.map(r => r.join(","))` one-liner: an exported employee name beginning
 * with `=` executes when the file is opened in Excel.
 */

interface Row {
  name: string;
  hours: number;
  note: string | null;
}

const columns = [
  { header: "Name", value: (row: Row) => row.name },
  { header: "Hours", value: (row: Row) => row.hours },
  { header: "Note", value: (row: Row) => row.note },
];

describe("toCsv", () => {
  it("writes a header row even with no data", () => {
    expect(toCsv<Row>([], columns)).toBe("Name,Hours,Note");
  });

  it("serialises simple rows with CRLF line endings", () => {
    const csv = toCsv<Row>([{ name: "Priya Nair", hours: 8, note: "on time" }], columns);
    expect(csv).toBe("Name,Hours,Note\r\nPriya Nair,8,on time");
  });

  it("quotes cells containing a comma", () => {
    const csv = toCsv<Row>([{ name: "Nair, Priya", hours: 8, note: null }], columns);
    expect(csv).toContain('"Nair, Priya"');
  });

  it("doubles embedded quotes", () => {
    const csv = toCsv<Row>([{ name: 'She said "hi"', hours: 1, note: null }], columns);
    expect(csv).toContain('"She said ""hi"""');
  });

  it("quotes cells containing newlines", () => {
    const csv = toCsv<Row>([{ name: "line one\nline two", hours: 1, note: null }], columns);
    expect(csv).toContain('"line one\nline two"');
  });

  it("renders null and undefined as empty, not as the word", () => {
    const csv = toCsv<Row>([{ name: "Ann", hours: 0, note: null }], columns);
    expect(csv).toBe("Name,Hours,Note\r\nAnn,0,");
    expect(csv).not.toContain("null");
  });

  it("renders non-finite numbers as empty rather than NaN", () => {
    const csv = toCsv<Row>([{ name: "Ann", hours: Number.NaN, note: null }], columns);
    expect(csv).toBe("Name,Hours,Note\r\nAnn,,");
  });

  it("serialises dates as ISO strings", () => {
    const csv = toCsv([{ at: new Date("2026-08-08T09:14:00.000Z") }], [
      { header: "At", value: (row: { at: Date }) => row.at },
    ]);
    expect(csv).toContain("2026-08-08T09:14:00.000Z");
  });
});

describe("formula injection", () => {
  const dangerous = ["=1+1", "+1", "-1", "@SUM(A1)", "\tTAB", "\rCR"];

  it.each(dangerous)("neutralises a cell starting with %j", (value) => {
    const csv = toCsv([{ name: value }], [{ header: "Name", value: (row: { name: string }) => row.name }]);
    const cell = csv.split("\r\n")[1];

    // The cell is prefixed with a single quote so a spreadsheet treats it as
    // text. Quoting alone would NOT prevent execution.
    expect(cell.startsWith("'") || cell.startsWith("\"'")).toBe(true);
  });

  it("handles the classic command-injection payload", () => {
    const payload = '=cmd|\' /C calc\'!A0';
    const csv = toCsv([{ name: payload }], [
      { header: "Name", value: (row: { name: string }) => row.name },
    ]);

    expect(csv).not.toMatch(/\r\n=/);
    expect(csv).toContain("'=cmd");
  });

  it("leaves an ordinary name untouched", () => {
    const csv = toCsv([{ name: "Priya Nair" }], [
      { header: "Name", value: (row: { name: string }) => row.name },
    ]);
    expect(csv).toBe("Name\r\nPriya Nair");
  });

  it("does not mangle a negative number passed as a number", () => {
    // Numbers bypass the text path entirely, so -5 stays -5 and stays numeric.
    const csv = toCsv([{ value: -5 }], [
      { header: "Value", value: (row: { value: number }) => row.value },
    ]);
    expect(csv).toBe("Value\r\n-5");
  });
});

describe("csvResponse", () => {
  it("sets the download headers and a UTF-8 BOM", async () => {
    const response = csvResponse("Name\r\nPriya", "attendance.csv");

    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain('filename="attendance.csv"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    // Assert on the raw bytes, not on `.text()`: the UTF-8 decoder strips a
    // leading BOM, so the string would look identical whether or not it was
    // sent. Excel reads the bytes, and without EF BB BF it mis-decodes any
    // non-ASCII name.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("sanitises a filename containing path characters", () => {
    const response = csvResponse("a", "../../etc/passwd.csv");
    const disposition = response.headers.get("Content-Disposition") ?? "";

    expect(disposition).not.toContain("..");
    expect(disposition).not.toContain("/");
  });
});

describe("timestampedFilename", () => {
  it("appends an ISO date and the extension", () => {
    expect(timestampedFilename("attendance")).toMatch(/^attendance-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
