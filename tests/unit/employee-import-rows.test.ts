import { describe, expect, it } from "vitest";

import { missingColumns, parseCsv } from "@/lib/csv-import";

/**
 * The row-shaping rules the employee import route depends on.
 *
 * These test the contract between the parser and the route: that a file
 * exported from the app can be read back, that required columns are detected
 * by name however they are spelled, and that the line numbers reported to the
 * user point at the right row of their spreadsheet.
 */

const HEADER = "First name,Last name,Email,Designation,Department,Office,Joined at";

describe("employee import file shape", () => {
  it("accepts the documented header row", () => {
    const result = parseCsv(`${HEADER}\nAsha,Rao,asha@x.test,Engineer,Engineering,Guntur,2026-01-15`);

    expect(missingColumns(result.headers, ["First name", "Last name", "Email", "Designation"])).toEqual(
      [],
    );
    expect(result.rows[0]).toMatchObject({
      firstname: "Asha",
      lastname: "Rao",
      email: "asha@x.test",
      designation: "Engineer",
      department: "Engineering",
      office: "Guntur",
      joinedat: "2026-01-15",
    });
  });

  it("accepts the same columns however they are spelled", () => {
    const variants = [
      "first_name,last_name,email,designation",
      "FIRST NAME,LAST NAME,EMAIL,DESIGNATION",
      "firstName,lastName,Email,Designation",
    ];

    for (const header of variants) {
      const result = parseCsv(`${header}\nAsha,Rao,a@x.test,Engineer`);
      expect(
        missingColumns(result.headers, ["First name", "Last name", "Email", "Designation"]),
      ).toEqual([]);
    }
  });

  it("names the columns that are missing", () => {
    const result = parseCsv("First name,Last name\nAsha,Rao");

    expect(missingColumns(result.headers, ["First name", "Email", "Designation"])).toEqual([
      "Email",
      "Designation",
    ]);
  });

  it("reports the spreadsheet line, counting the header", () => {
    // Row index 0 is line 2 in the file the user is looking at.
    const result = parseCsv(`${HEADER}\nAsha,Rao,a@x.test,Engineer,Eng,Guntur,2026-01-15\nBroken,Row`);

    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(3);
  });

  it("survives a name containing a comma", () => {
    const result = parseCsv(`${HEADER}\n"Rao, Asha",Kumari,a@x.test,Engineer,Eng,Guntur,2026-01-15`);

    expect(result.rows[0]!.firstname).toBe("Rao, Asha");
  });

  it("does not treat a formula-looking designation as anything but text", () => {
    const result = parseCsv(`${HEADER}\nAsha,Rao,a@x.test,=SUM(A1),Eng,Guntur,2026-01-15`);

    expect(result.rows[0]!.designation).toBe("=SUM(A1)");
  });

  it("ignores trailing blank lines a spreadsheet leaves behind", () => {
    const result = parseCsv(`${HEADER}\nAsha,Rao,a@x.test,Engineer,Eng,Guntur,2026-01-15\n\n\n`);

    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
});
