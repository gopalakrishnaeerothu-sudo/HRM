import { describe, expect, it } from "vitest";

import {
  hashPassword,
  needsRehash,
  PASSWORD_MIN_LENGTH,
  validatePasswordStrength,
  verifyPassword,
} from "@/server/auth/password";

/**
 * Password hashing.
 *
 * The properties asserted here are the ones whose absence causes a breach:
 * salting, rejection of tampered digests, and refusal to accept a wrong
 * password under any encoding trick.
 */

describe("hashPassword", () => {
  it("produces a self-describing scrypt digest", async () => {
    const digest = await hashPassword("correct horse battery staple");
    const parts = digest.split("$");

    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBeGreaterThanOrEqual(2 ** 15);
    expect(parts).toHaveLength(6);
  });

  it("never stores the plaintext", async () => {
    const password = "a-very-distinctive-passphrase";
    const digest = await hashPassword(password);
    expect(digest).not.toContain(password);
  });

  it("salts — the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);

    // Without a per-hash salt, identical passwords would collide and a single
    // rainbow table would break every account at once.
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", async () => {
    const digest = await hashPassword("Tr0ubad0ur&3");
    expect(await verifyPassword("Tr0ubad0ur&3", digest)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const digest = await hashPassword("Tr0ubad0ur&3");
    expect(await verifyPassword("Tr0ubad0ur&4", digest)).toBe(false);
  });

  it("rejects an empty password against a real digest", async () => {
    const digest = await hashPassword("something");
    expect(await verifyPassword("", digest)).toBe(false);
  });

  it("is case sensitive", async () => {
    const digest = await hashPassword("CaseSensitive123!");
    expect(await verifyPassword("casesensitive123!", digest)).toBe(false);
  });

  it("normalises unicode so the same characters verify across encodings", async () => {
    // "é" as one code point vs. "e" + combining accent. A user typing the same
    // thing on a different keyboard must still get in.
    const composed = "café-password-1";
    const decomposed = "café-password-1";

    const digest = await hashPassword(composed);
    expect(await verifyPassword(decomposed, digest)).toBe(true);
  });

  it.each([
    ["empty string", ""],
    ["not a digest", "hunter2"],
    ["wrong algorithm", "bcrypt$10$abc$def$ghi$jkl"],
    ["too few fields", "scrypt$32768$8$salt"],
    ["non-numeric cost", "scrypt$abc$8$1$c2FsdA==$aGFzaA=="],
    ["absurd cost", "scrypt$99999999$8$1$c2FsdA==$aGFzaA=="],
    ["empty salt", "scrypt$32768$8$1$$aGFzaA=="],
  ])("returns false for a malformed digest: %s", async (_label, digest) => {
    // Must return false, never throw — a corrupted row should look exactly
    // like a wrong password to every caller.
    await expect(verifyPassword("anything", digest)).resolves.toBe(false);
  });

  it("rejects a digest whose hash was tampered with", async () => {
    const digest = await hashPassword("original");
    const parts = digest.split("$");
    parts[5] = Buffer.from("attacker-controlled").toString("base64");

    expect(await verifyPassword("original", parts.join("$"))).toBe(false);
  });
});

describe("needsRehash", () => {
  it("is false for a digest at current parameters", async () => {
    expect(needsRehash(await hashPassword("current"))).toBe(false);
  });

  it("is true for a weaker cost factor", () => {
    expect(needsRehash("scrypt$16384$8$1$c2FsdA==$aGFzaA==")).toBe(true);
  });

  it("is true for anything unparseable", () => {
    expect(needsRehash("not-a-digest")).toBe(true);
  });
});

describe("validatePasswordStrength", () => {
  it("accepts a reasonable passphrase", () => {
    expect(validatePasswordStrength("morning-coffee-window")).toBeNull();
  });

  it("rejects anything shorter than the minimum", () => {
    expect(validatePasswordStrength("a".repeat(PASSWORD_MIN_LENGTH - 1))).toMatch(/at least/i);
  });

  it("rejects a common word padded out to the minimum length", () => {
    // The length check alone would let these through, which is exactly the
    // trick the blocklist exists to catch.
    expect(validatePasswordStrength("password12345")).toMatch(/too common/i);
    expect(validatePasswordStrength("Welcome-2026!")).toMatch(/too common/i);
  });

  it("sees through leet substitutions", () => {
    expect(validatePasswordStrength("P@ssw0rd-2026")).toMatch(/too common/i);
    expect(validatePasswordStrength("l3tm31n-98765")).toMatch(/too common/i);
  });

  it("does not reject an ordinary passphrase that merely contains letters", () => {
    expect(validatePasswordStrength("harbour-lantern-quiet")).toBeNull();
  });

  it("rejects a single repeated character", () => {
    expect(validatePasswordStrength("aaaaaaaaaaaaaaa")).toMatch(/repeated/i);
  });

  it("rejects a password containing the user's email local part", () => {
    expect(
      validatePasswordStrength("aarav.mehta-is-here", { email: "aarav@acme.example" }),
    ).toMatch(/email/i);
  });

  it("rejects a password containing the user's name", () => {
    expect(validatePasswordStrength("mehta-goes-walking", { name: "Aarav Mehta" })).toMatch(/name/i);
  });

  it("does not reject on a short name fragment", () => {
    // "Li" is too short to be a meaningful signal; rejecting on it would be noise.
    expect(validatePasswordStrength("brilliant-morning-run", { name: "Li Wei" })).toBeNull();
  });

  it("caps length so a huge input cannot burn CPU", () => {
    expect(validatePasswordStrength("x".repeat(500))).toMatch(/or fewer/i);
  });
});
