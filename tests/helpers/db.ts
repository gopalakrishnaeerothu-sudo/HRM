import { PrismaClient } from "@prisma/client";

/**
 * Integration-test database access.
 *
 * These tests need a real PostgreSQL instance, because the properties they
 * verify — tenant isolation, unique constraints, cascade behaviour — are
 * enforced by the database, and a mock would only assert that the mock works.
 *
 * They are skipped rather than failed when TEST_DATABASE_URL is unset, so
 * `npm test` passes on a fresh clone with no database. CI sets the variable and
 * gets the full suite.
 *
 * Point it at a THROWAWAY database. `resetDatabase` truncates every table.
 */

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** True when integration tests can run. Use with `describe.skipIf`. */
export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

let client: PrismaClient | null = null;

export function testDb(): PrismaClient {
  if (!TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is not set — this test should have been skipped.");
  }
  client ??= new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
    log: ["error"],
  });
  return client;
}

export async function disconnectTestDb(): Promise<void> {
  await client?.$disconnect();
  client = null;
}

/** Wipe every table. FK-safe order, mirroring prisma/seed.ts. */
export async function resetDatabase(): Promise<void> {
  const db = testDb();

  await db.$transaction([
    db.attendanceEvent.deleteMany(),
    db.breakRecord.deleteMany(),
    db.attendanceRecord.deleteMany(),
    db.taskActivity.deleteMany(),
    db.taskComment.deleteMany(),
    db.taskAttachment.deleteMany(),
    db.subtask.deleteMany(),
    db.taskAssignee.deleteMany(),
    db.task.deleteMany(),
    db.leave.deleteMany(),
    db.holiday.deleteMany(),
    db.notification.deleteMany(),
    db.auditLog.deleteMany(),
    db.session.deleteMany(),
    db.teamMember.deleteMany(),
    db.team.deleteMany(),
    db.employeeOffice.deleteMany(),
    db.officeGeofence.deleteMany(),
    db.rolePermission.deleteMany(),
    db.permission.deleteMany(),
  ]);

  await db.employee.updateMany({ data: { managerId: null } });
  await db.department.updateMany({ data: { headId: null } });
  await db.employee.deleteMany();
  await db.department.deleteMany();
  await db.office.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();
}

/**
 * Build a minimal but complete tenant: organisation, office with a geofence,
 * department, one employee and their user account.
 */
export async function createTenant(options: {
  slug: string;
  name: string;
  officeLatitude?: number;
  officeLongitude?: number;
  radiusMeters?: number;
}) {
  const db = testDb();

  const organization = await db.organization.create({
    data: {
      slug: options.slug,
      name: options.name,
      timezone: "Asia/Kolkata",
    },
  });

  const office = await db.office.create({
    data: {
      organizationId: organization.id,
      name: `${options.name} HQ`,
      code: "HQ",
      addressLine: "1 Test Street",
      city: "Guntur",
      latitude: options.officeLatitude ?? 16.30656,
      longitude: options.officeLongitude ?? 80.4365,
      geofences: {
        create: {
          name: "Main perimeter",
          latitude: options.officeLatitude ?? 16.30656,
          longitude: options.officeLongitude ?? 80.4365,
          radiusMeters: options.radiusMeters ?? 100,
          isPrimary: true,
        },
      },
    },
    include: { geofences: true },
  });

  const department = await db.department.create({
    data: {
      organizationId: organization.id,
      name: "Engineering",
      code: "ENG",
    },
  });

  const user = await db.user.create({
    data: {
      organizationId: organization.id,
      email: `owner@${options.slug}.example`,
      name: "Test Owner",
      role: "OWNER",
    },
  });

  const employee = await db.employee.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      employeeCode: "EMP-0001",
      firstName: "Test",
      lastName: "Owner",
      email: `owner@${options.slug}.example`,
      designation: "Founder",
      departmentId: department.id,
      primaryOfficeId: office.id,
      joinedAt: new Date("2024-01-01"),
    },
  });

  return { organization, office, department, user, employee };
}
