import { describe, expect, it } from "vitest";

import { safeRedirect } from "@/lib/validation/auth";

/**
 * Post-login redirect validation.
 *
 * Without this, `/login?next=https://evil.example` is an open redirect: a
 * phishing link that genuinely begins on your own domain, which is exactly
 * what makes it convincing.
 */
describe("safeRedirect", () => {
  it("allows a local path", () => {
    expect(safeRedirect("/app/tasks")).toBe("/app/tasks");
    expect(safeRedirect("/app/employees?status=ACTIVE")).toBe("/app/employees?status=ACTIVE");
  });

  it("falls back when nothing is supplied", () => {
    expect(safeRedirect(undefined)).toBe("/app");
    expect(safeRedirect(null)).toBe("/app");
    expect(safeRedirect("")).toBe("/app");
  });

  it.each([
    ["absolute http", "http://evil.example/steal"],
    ["absolute https", "https://evil.example/steal"],
    ["protocol-relative", "//evil.example/steal"],
    ["backslash trick", "/\\evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["no leading slash", "evil.example"],
  ])("rejects %s", (_label, target) => {
    expect(safeRedirect(target)).toBe("/app");
  });

  it("refuses to bounce back to the login page", () => {
    // Otherwise a login → login loop is trivially constructible.
    expect(safeRedirect("/login")).toBe("/app");
    expect(safeRedirect("/login?next=/login")).toBe("/app");
  });

  it("refuses to redirect into the API", () => {
    expect(safeRedirect("/api/employees")).toBe("/app");
  });

  it("honours a custom fallback", () => {
    expect(safeRedirect("https://evil.example", "/somewhere")).toBe("/somewhere");
  });
});
