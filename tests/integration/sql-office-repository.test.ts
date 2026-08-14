import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { sqlOfficeRepository } from "@/server/repositories/sql/office-repository";
import type { Executor } from "@/server/db/query";
import type { TenantScope } from "@/server/db/tenant";
import {
  createSqlTenant,
  disconnectSqlTestDb,
  hasSqlTestDatabase,
  resetSqlDatabase,
  sqlTestPool,
} from "../helpers/sql-db";

/**
 * Offices and geofence zones on the SQL stack.
 *
 * The zone lookup gets the most attention here, because it is the
 * authorisation envelope for attendance: whatever it returns is the complete
 * set of perimeters an employee can be verified against. A bug that widened it
 * would let someone check in from a site they have no relationship to.
 */
describe.skipIf(!hasSqlTestDatabase)("sql office repository", () => {
  let alpha: string;
  let beta: string;
  let alphaScope: TenantScope;
  let betaScope: TenantScope;

  const GUNTUR = { latitude: 16.30656, longitude: 80.4365 };
  const HYDERABAD = { latitude: 17.44855, longitude: 78.39109 };

  async function createOffice(
    scope: TenantScope,
    overrides: Partial<{ name: string; code: string; radiusMeters: number; latitude: number; longitude: number; status: "ACTIVE" | "INACTIVE" }> = {},
  ) {
    return sqlOfficeRepository.create(scope, {
      name: overrides.name ?? "Head Office",
      code: overrides.code ?? `HQ-${Math.random().toString(36).slice(2, 7)}`,
      addressLine: "1 Test Street",
      city: "Guntur",
      state: null,
      country: "India",
      postalCode: null,
      timezone: "Asia/Kolkata",
      latitude: overrides.latitude ?? GUNTUR.latitude,
      longitude: overrides.longitude ?? GUNTUR.longitude,
      radiusMeters: overrides.radiusMeters ?? 100,
      workdayStartMinutes: 540,
      workdayEndMinutes: 1080,
      gracePeriodMinutes: 15,
      status: overrides.status ?? "ACTIVE",
    });
  }

  async function createEmployee(organizationId: string, primaryOfficeId: string | null) {
    const code = `E-${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await sqlTestPool().query<{ id: string }>(
      `INSERT INTO employees (organization_id, employee_code, first_name, last_name, email, designation, primary_office_id, joined_at)
       VALUES ($1,$2,'Test','Person',$3,'Engineer',$4,NOW()) RETURNING id`,
      [organizationId, code, `${code.toLowerCase()}@example.test`, primaryOfficeId],
    );
    return rows[0]!.id;
  }

  beforeEach(async () => {
    await resetSqlDatabase();
    alpha = await createSqlTenant("alpha", "Alpha Corp");
    beta = await createSqlTenant("beta", "Beta Corp");
    alphaScope = { organizationId: alpha, tx: sqlTestPool() as unknown as Executor };
    betaScope = { organizationId: beta, tx: sqlTestPool() as unknown as Executor };
  });

  afterAll(async () => {
    await resetSqlDatabase();
    await disconnectSqlTestDb();
  });

  describe("creation", () => {
    it("creates an office together with a primary perimeter", async () => {
      const office = await createOffice(alphaScope, { radiusMeters: 150 });

      // An office with no zone is a site nobody can check in to, so the two
      // are created in one statement.
      expect(office.geofences).toHaveLength(1);
      expect(office.geofences[0]?.isPrimary).toBe(true);
      expect(office.geofences[0]?.radiusMeters).toBe(150);
      expect(office.geofences[0]?.latitude).toBeCloseTo(GUNTUR.latitude, 5);
    });

    it("rejects a radius below the GPS-usable minimum", async () => {
      // 20 m is the floor: consumer GPS is rarely better than ~10 m, so a
      // tighter perimeter would reject people at their own desk.
      await expect(createOffice(alphaScope, { radiusMeters: 5 })).rejects.toThrow();
    });

    it("rejects (0, 0) as a location", async () => {
      await expect(createOffice(alphaScope, { latitude: 0, longitude: 0 })).rejects.toThrow();
    });

    it("allows the same office code in two organisations", async () => {
      await createOffice(alphaScope, { code: "HQ" });
      await expect(createOffice(betaScope, { code: "HQ" })).resolves.toBeTruthy();
      await expect(createOffice(alphaScope, { code: "HQ" })).rejects.toThrow();
    });
  });

  describe("tenant isolation", () => {
    it("cannot read another tenant's office", async () => {
      const office = await createOffice(betaScope);
      expect(await sqlOfficeRepository.findById(alphaScope, office.id)).toBeNull();
    });

    it("cannot update another tenant's office", async () => {
      const office = await createOffice(betaScope, { name: "Beta HQ" });

      expect(await sqlOfficeRepository.update(alphaScope, office.id, { name: "Hijacked" })).toBeNull();

      const untouched = await sqlOfficeRepository.findById(betaScope, office.id);
      expect(untouched?.name).toBe("Beta HQ");
    });

    it("cannot widen another tenant's perimeter", async () => {
      const office = await createOffice(betaScope, { radiusMeters: 100 });
      const zone = office.geofences[0]!;

      const updated = await sqlOfficeRepository.updateGeofence(alphaScope, zone.id, {
        name: zone.name,
        latitude: zone.latitude,
        longitude: zone.longitude,
        radiusMeters: 5000,
        isPrimary: true,
        isActive: true,
      });

      expect(updated).toBe(false);

      const after = await sqlOfficeRepository.findById(betaScope, office.id);
      expect(after?.geofences[0]?.radiusMeters).toBe(100);
    });

    it("cannot read another tenant's zone through the office join", async () => {
      const office = await createOffice(betaScope);
      expect(await sqlOfficeRepository.findGeofence(alphaScope, office.geofences[0]!.id)).toBeNull();
    });
  });

  describe("check-in zone envelope", () => {
    it("returns the employee's primary office zone", async () => {
      const office = await createOffice(alphaScope, { name: "Guntur HQ" });
      const employee = await createEmployee(alpha, office.id);

      const zones = await sqlOfficeRepository.listZonesForEmployee(alphaScope, employee);

      expect(zones).toHaveLength(1);
      expect(zones[0]?.officeName).toBe("Guntur HQ");
      expect(zones[0]?.radiusMeters).toBe(100);
    });

    it("includes additionally assigned offices", async () => {
      const primary = await createOffice(alphaScope, { name: "Guntur HQ", code: "GNT" });
      const secondary = await createOffice(alphaScope, {
        name: "Hyderabad",
        code: "HYD",
        ...HYDERABAD,
      });
      const employee = await createEmployee(alpha, primary.id);

      await sqlTestPool().query(
        `INSERT INTO employee_offices (employee_id, office_id) VALUES ($1, $2)`,
        [employee, secondary.id],
      );

      const zones = await sqlOfficeRepository.listZonesForEmployee(alphaScope, employee);
      expect(zones.map((zone) => zone.officeName).sort()).toEqual(["Guntur HQ", "Hyderabad"]);
    });

    it("returns nothing for an employee with no office", async () => {
      const employee = await createEmployee(alpha, null);

      // An empty set is meaningful: the verification engine refuses the
      // check-in rather than falling back to something permissive.
      expect(await sqlOfficeRepository.listZonesForEmployee(alphaScope, employee)).toEqual([]);
    });

    it("excludes inactive offices", async () => {
      const office = await createOffice(alphaScope, { status: "INACTIVE" });
      const employee = await createEmployee(alpha, office.id);

      expect(await sqlOfficeRepository.listZonesForEmployee(alphaScope, employee)).toEqual([]);
    });

    it("excludes deactivated zones", async () => {
      const office = await createOffice(alphaScope);
      const employee = await createEmployee(alpha, office.id);

      await sqlOfficeRepository.deleteGeofence(alphaScope, office.geofences[0]!.id);

      expect(await sqlOfficeRepository.listZonesForEmployee(alphaScope, employee)).toEqual([]);
    });

    it("returns nothing for an employee in another tenant", async () => {
      const office = await createOffice(betaScope);
      const employee = await createEmployee(beta, office.id);

      // The most important assertion in this file: asking about another
      // organisation's employee must not reveal that organisation's perimeters.
      expect(await sqlOfficeRepository.listZonesForEmployee(alphaScope, employee)).toEqual([]);
    });
  });

  describe("zones", () => {
    it("enforces a single primary zone per office", async () => {
      const office = await createOffice(alphaScope);

      await expect(
        sqlOfficeRepository.createGeofence(alphaScope, office.id, {
          name: "Annexe",
          ...GUNTUR,
          radiusMeters: 80,
          isPrimary: true,
          isActive: true,
        }),
      ).rejects.toThrow();
    });

    it("allows a second zone once the first is demoted", async () => {
      const office = await createOffice(alphaScope);

      await sqlOfficeRepository.clearPrimaryFlag(alphaScope, office.id);
      await expect(
        sqlOfficeRepository.createGeofence(alphaScope, office.id, {
          name: "Annexe",
          ...GUNTUR,
          radiusMeters: 80,
          isPrimary: true,
          isActive: true,
        }),
      ).resolves.toBeTruthy();

      const after = await sqlOfficeRepository.requireById(alphaScope, office.id);
      expect(after.geofences).toHaveLength(2);
      expect(after.geofences.filter((zone) => zone.isPrimary)).toHaveLength(1);
    });

    it("counts active zones, so the last one can be protected", async () => {
      const office = await createOffice(alphaScope);
      expect(await sqlOfficeRepository.countActiveZones(alphaScope, office.id)).toBe(1);

      await sqlOfficeRepository.deleteGeofence(alphaScope, office.geofences[0]!.id);
      expect(await sqlOfficeRepository.countActiveZones(alphaScope, office.id)).toBe(0);
    });
  });

  describe("assignment counts", () => {
    it("counts employees whose primary office this is", async () => {
      const office = await createOffice(alphaScope);
      await createEmployee(alpha, office.id);
      await createEmployee(alpha, office.id);
      await createEmployee(alpha, null);

      expect(await sqlOfficeRepository.countAssignedEmployees(alphaScope, office.id)).toBe(2);

      const loaded = await sqlOfficeRepository.requireById(alphaScope, office.id);
      expect(loaded.assignedEmployeeCount).toBe(2);
    });
  });

  describe("listing", () => {
    it("can exclude inactive offices", async () => {
      await createOffice(alphaScope, { code: "A", status: "ACTIVE" });
      await createOffice(alphaScope, { code: "B", status: "INACTIVE" });

      expect(await sqlOfficeRepository.list(alphaScope, true)).toHaveLength(2);
      expect(await sqlOfficeRepository.list(alphaScope, false)).toHaveLength(1);
    });

    it("lists only this tenant's offices", async () => {
      await createOffice(alphaScope, { name: "Alpha HQ" });
      await createOffice(betaScope, { name: "Beta HQ" });

      const offices = await sqlOfficeRepository.list(alphaScope);
      expect(offices).toHaveLength(1);
      expect(offices[0]?.name).toBe("Alpha HQ");
    });

    it("returns an empty array, not [null], for an office with no active zone", async () => {
      const office = await createOffice(alphaScope);
      await sqlOfficeRepository.deleteGeofence(alphaScope, office.geofences[0]!.id);

      const reloaded = await sqlOfficeRepository.requireById(alphaScope, office.id);
      expect(reloaded.geofences).toEqual([]);
    });
  });
});
