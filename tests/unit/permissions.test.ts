import { describe, expect, it } from "vitest";

import {
  hasAnyPermission,
  hasPermission,
  isManagerialRole,
  isOrgWideRole,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
} from "@/server/auth/permissions";

/**
 * The role → capability map.
 *
 * These tests exist mainly to catch *widening*: it is easy to add a permission
 * to a shared array and silently hand it to every role beneath. The escalation
 * assertions below fail loudly if that happens.
 */

describe("role escalation", () => {
  it("gives each role at least everything the one below it has", () => {
    const ladder: Array<[Permission[], Permission[]]> = [
      [[...ROLE_PERMISSIONS.EMPLOYEE], [...ROLE_PERMISSIONS.MANAGER]],
      [[...ROLE_PERMISSIONS.MANAGER], [...ROLE_PERMISSIONS.HR]],
      [[...ROLE_PERMISSIONS.HR], [...ROLE_PERMISSIONS.ADMIN]],
      [[...ROLE_PERMISSIONS.ADMIN], [...ROLE_PERMISSIONS.OWNER]],
    ];

    for (const [lower, higher] of ladder) {
      for (const permission of lower) {
        expect(higher).toContain(permission);
      }
    }
  });

  it("gives strictly more to each successive role", () => {
    expect(ROLE_PERMISSIONS.MANAGER.size).toBeGreaterThan(ROLE_PERMISSIONS.EMPLOYEE.size);
    expect(ROLE_PERMISSIONS.HR.size).toBeGreaterThan(ROLE_PERMISSIONS.MANAGER.size);
    expect(ROLE_PERMISSIONS.ADMIN.size).toBeGreaterThan(ROLE_PERMISSIONS.HR.size);
  });
});

describe("employee boundaries", () => {
  it("cannot read the whole organisation's people data", () => {
    expect(hasPermission("EMPLOYEE", "employee:read:all")).toBe(false);
    expect(hasPermission("EMPLOYEE", "attendance:read:all")).toBe(false);
    expect(hasPermission("EMPLOYEE", "attendance:read:team")).toBe(false);
  });

  it("cannot manage people, offices or settings", () => {
    expect(hasPermission("EMPLOYEE", "employee:create")).toBe(false);
    expect(hasPermission("EMPLOYEE", "employee:update")).toBe(false);
    expect(hasPermission("EMPLOYEE", "office:manage")).toBe(false);
    expect(hasPermission("EMPLOYEE", "geofence:manage")).toBe(false);
    expect(hasPermission("EMPLOYEE", "settings:manage")).toBe(false);
    expect(hasPermission("EMPLOYEE", "audit:read")).toBe(false);
  });

  it("cannot edit anyone else's attendance", () => {
    expect(hasPermission("EMPLOYEE", "attendance:override")).toBe(false);
  });

  it("can do their own day-to-day work", () => {
    expect(hasPermission("EMPLOYEE", "attendance:check-in")).toBe(true);
    expect(hasPermission("EMPLOYEE", "attendance:read:self")).toBe(true);
    expect(hasPermission("EMPLOYEE", "task:create")).toBe(true);
    expect(hasPermission("EMPLOYEE", "leave:request")).toBe(true);
  });
});

describe("manager boundaries", () => {
  it("can see their team but not the whole organisation", () => {
    expect(hasPermission("MANAGER", "attendance:read:team")).toBe(true);
    expect(hasPermission("MANAGER", "attendance:read:all")).toBe(false);
    expect(hasPermission("MANAGER", "employee:read:all")).toBe(false);
  });

  it("cannot create employees or change the geofence", () => {
    expect(hasPermission("MANAGER", "employee:create")).toBe(false);
    expect(hasPermission("MANAGER", "geofence:manage")).toBe(false);
    expect(hasPermission("MANAGER", "attendance:override")).toBe(false);
  });

  it("can approve leave and manage their team's tasks", () => {
    expect(hasPermission("MANAGER", "leave:approve")).toBe(true);
    expect(hasPermission("MANAGER", "task:update:any")).toBe(true);
    expect(hasPermission("MANAGER", "team:manage")).toBe(true);
  });
});

describe("HR boundaries", () => {
  it("can manage people and correct attendance", () => {
    expect(hasPermission("HR", "employee:create")).toBe(true);
    expect(hasPermission("HR", "employee:update")).toBe(true);
    expect(hasPermission("HR", "attendance:override")).toBe(true);
    expect(hasPermission("HR", "attendance:read:all")).toBe(true);
  });

  it("cannot delete employees, change geofences or read the audit log", () => {
    // Those are administrative acts, deliberately held one level up.
    expect(hasPermission("HR", "employee:delete")).toBe(false);
    expect(hasPermission("HR", "geofence:manage")).toBe(false);
    expect(hasPermission("HR", "settings:manage")).toBe(false);
    expect(hasPermission("HR", "audit:read")).toBe(false);
  });
});

describe("admin and owner", () => {
  it("admin holds every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission("ADMIN", permission)).toBe(true);
    }
  });

  it("owner holds every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission("OWNER", permission)).toBe(true);
    }
  });
});

describe("per-tenant overrides", () => {
  it("an explicit grant beats the role default", () => {
    const overrides = new Map<Permission, boolean>([["geofence:manage", true]]);

    expect(hasPermission("MANAGER", "geofence:manage")).toBe(false);
    expect(hasPermission("MANAGER", "geofence:manage", overrides)).toBe(true);
  });

  it("an explicit revoke beats the role default", () => {
    const overrides = new Map<Permission, boolean>([["attendance:override", false]]);

    expect(hasPermission("HR", "attendance:override")).toBe(true);
    expect(hasPermission("HR", "attendance:override", overrides)).toBe(false);
  });

  it("revokes apply to admins too — no implicit bypass", () => {
    const overrides = new Map<Permission, boolean>([["employee:delete", false]]);
    expect(hasPermission("ADMIN", "employee:delete", overrides)).toBe(false);
  });

  it("leaves unrelated permissions untouched", () => {
    const overrides = new Map<Permission, boolean>([["geofence:manage", true]]);
    expect(hasPermission("EMPLOYEE", "employee:create", overrides)).toBe(false);
  });
});

describe("helpers", () => {
  it("identifies org-wide roles", () => {
    expect(isOrgWideRole("OWNER")).toBe(true);
    expect(isOrgWideRole("ADMIN")).toBe(true);
    expect(isOrgWideRole("HR")).toBe(true);
    expect(isOrgWideRole("MANAGER")).toBe(false);
    expect(isOrgWideRole("EMPLOYEE")).toBe(false);
  });

  it("identifies managerial roles", () => {
    expect(isManagerialRole("MANAGER")).toBe(true);
    expect(isManagerialRole("HR")).toBe(true);
    expect(isManagerialRole("EMPLOYEE")).toBe(false);
  });

  it("hasAnyPermission is a true disjunction", () => {
    expect(hasAnyPermission("EMPLOYEE", ["employee:create", "task:create"])).toBe(true);
    expect(hasAnyPermission("EMPLOYEE", ["employee:create", "settings:manage"])).toBe(false);
    expect(hasAnyPermission("EMPLOYEE", [])).toBe(false);
  });
});

describe("catalogue integrity", () => {
  it("has no duplicate permission keys", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("only grants permissions that exist in the catalogue", () => {
    const catalogue = new Set<string>(PERMISSIONS);
    for (const [role, granted] of Object.entries(ROLE_PERMISSIONS)) {
      for (const permission of granted) {
        expect(catalogue.has(permission), `${role} grants unknown "${permission}"`).toBe(true);
      }
    }
  });
});
