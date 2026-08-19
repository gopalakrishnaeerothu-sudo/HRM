import { describe, expect, it } from "vitest";

import {
  assignableRoles,
  canActOn,
  canAssignRole,
  hasPermission,
} from "@/server/auth/permissions";
import type { UserRole } from "@/server/db/types";

/**
 * Role seniority.
 *
 * These are the rules that stop privilege escalation, and they are pure
 * functions precisely so they can be tested exhaustively rather than sampled.
 * Every case below is a real escalation someone would attempt.
 */

const ALL_ROLES: UserRole[] = ["OWNER", "ADMIN", "HR", "MANAGER", "EMPLOYEE"];

describe("canActOn", () => {
  it("lets nobody act on their own rank", () => {
    for (const role of ALL_ROLES) {
      expect(canActOn(role, role)).toBe(false);
    }
  });

  it("refuses every attempt to act upwards", () => {
    // Exhaustive rather than illustrative: any pair that slipped through is a
    // route by which a junior role manages a senior one.
    const ranked: UserRole[] = ["EMPLOYEE", "MANAGER", "HR", "ADMIN", "OWNER"];

    for (let actor = 0; actor < ranked.length; actor += 1) {
      for (let target = actor; target < ranked.length; target += 1) {
        expect(canActOn(ranked[actor]!, ranked[target]!)).toBe(false);
      }
    }
  });

  it("nobody at all can act on the owner", () => {
    for (const role of ALL_ROLES) {
      expect(canActOn(role, "OWNER")).toBe(false);
    }
  });

  it("lets seniors act on juniors", () => {
    expect(canActOn("OWNER", "ADMIN")).toBe(true);
    expect(canActOn("ADMIN", "HR")).toBe(true);
    expect(canActOn("HR", "MANAGER")).toBe(true);
    expect(canActOn("MANAGER", "EMPLOYEE")).toBe(true);
  });
});

describe("canAssignRole", () => {
  it("refuses OWNER to everyone, including the owner", () => {
    // Ownership transfer is deliberately not a dropdown on the users table.
    for (const role of ALL_ROLES) {
      expect(canAssignRole(role, "OWNER")).toBe(false);
    }
  });

  it("refuses an actor their own role, so nobody can clone themselves", () => {
    for (const role of ALL_ROLES) {
      expect(canAssignRole(role, role)).toBe(false);
    }
  });

  it("stops HR minting administrators", () => {
    expect(canAssignRole("HR", "ADMIN")).toBe(false);
    expect(canAssignRole("HR", "HR")).toBe(false);
    expect(canAssignRole("HR", "MANAGER")).toBe(true);
    expect(canAssignRole("HR", "EMPLOYEE")).toBe(true);
  });

  it("stops a manager granting anything at all above employee", () => {
    expect(canAssignRole("MANAGER", "HR")).toBe(false);
    expect(canAssignRole("MANAGER", "MANAGER")).toBe(false);
    expect(canAssignRole("MANAGER", "EMPLOYEE")).toBe(true);
  });

  it("gives an employee nothing to grant", () => {
    expect(assignableRoles("EMPLOYEE")).toEqual([]);
  });

  it("never offers a role the actor could not assign", () => {
    for (const actor of ALL_ROLES) {
      for (const role of assignableRoles(actor)) {
        expect(canAssignRole(actor, role)).toBe(true);
      }
    }
  });
});

describe("access permissions", () => {
  it("keeps employees and managers out of access management entirely", () => {
    for (const role of ["EMPLOYEE", "MANAGER"] as const) {
      expect(hasPermission(role, "user:read")).toBe(false);
      expect(hasPermission(role, "user:approve")).toBe(false);
      expect(hasPermission(role, "user:manage")).toBe(false);
      expect(hasPermission(role, "user:role:assign")).toBe(false);
      expect(hasPermission(role, "user:invite")).toBe(false);
    }
  });

  it("gives HR and above the access surface", () => {
    for (const role of ["HR", "ADMIN", "OWNER"] as const) {
      expect(hasPermission(role, "user:read")).toBe(true);
      expect(hasPermission(role, "user:approve")).toBe(true);
    }
  });

  it("keeps the signup code behind settings:manage, not user:manage", () => {
    // Rotating the code opens or closes the front door for the whole tenant,
    // so it sits with the organisation settings and out of HR's reach.
    expect(hasPermission("HR", "user:manage")).toBe(true);
    expect(hasPermission("HR", "settings:manage")).toBe(false);
    expect(hasPermission("ADMIN", "settings:manage")).toBe(true);
  });
});
