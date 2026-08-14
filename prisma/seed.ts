/**
 * Demo seed.
 *
 * Populates a full organisation — offices, departments, teams, 22 employees,
 * a task backlog and roughly two months of attendance history — so the
 * dashboards have something real to show the moment the app opens.
 *
 * Run with:  npm run db:seed
 * Add `--if-empty` to skip when the database already has an organisation;
 * that is what the Railway release command uses, so a redeploy never
 * duplicates data.
 *
 * Determinism: a seeded PRNG drives every "random" choice, so two runs against
 * a fresh database produce identical data. That matters for screenshots, demos
 * and for tests that assert on seeded values.
 */

import {
  PrismaClient,
  type AttendanceStatus,
  type Prisma,
  type UserRole,
} from "@prisma/client";

import { hashPassword } from "../src/server/auth/password";
import {
  DEPARTMENTS,
  EMPLOYEES,
  HOLIDAYS,
  OFFICES,
  ORGANIZATION,
  TASKS,
  TEAMS,
  type SeedEmployee,
} from "./seed-data";

const prisma = new PrismaClient();

// --- Deterministic randomness ----------------------------------------------

/** Mulberry32 — small, fast, and reproducible from a fixed seed. */
function createRandom(seed: number) {
  let state = seed;
  return function random(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20260808);

const randomInt = (min: number, max: number): number =>
  Math.floor(random() * (max - min + 1)) + min;

const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

// --- Date helpers (UTC date keys, matching the app's convention) -------------

const DAY_MS = 86_400_000;

function dateKey(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function monthsAgo(months: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
}

/** Combine a date key with a local minute-of-day, in IST (UTC+5:30). */
const IST_OFFSET_MINUTES = 330;

function atLocalMinutes(day: Date, minutesOfDay: number): Date {
  return new Date(day.getTime() + (minutesOfDay - IST_OFFSET_MINUTES) * 60_000);
}

function isWeekend(day: Date): boolean {
  const weekday = day.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return weekday === 0 || weekday === 6;
}

// --- Seed steps -------------------------------------------------------------

async function reset(): Promise<void> {
  // Truncate in FK-safe order. `deleteMany` rather than TRUNCATE so this works
  // on a database where the app user lacks table-owner rights.
  await prisma.$transaction([
    prisma.attendanceEvent.deleteMany(),
    prisma.breakRecord.deleteMany(),
    prisma.attendanceRecord.deleteMany(),
    prisma.taskActivity.deleteMany(),
    prisma.taskComment.deleteMany(),
    prisma.taskAttachment.deleteMany(),
    prisma.subtask.deleteMany(),
    prisma.taskAssignee.deleteMany(),
    prisma.task.deleteMany(),
    prisma.leave.deleteMany(),
    prisma.holiday.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.session.deleteMany(),
    prisma.teamMember.deleteMany(),
    prisma.team.deleteMany(),
    prisma.employeeOffice.deleteMany(),
    prisma.officeGeofence.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.permission.deleteMany(),
  ]);

  // Employees reference each other (manager) and departments reference
  // employees (head), so break those links before deleting either.
  await prisma.employee.updateMany({ data: { managerId: null } });
  await prisma.department.updateMany({ data: { headId: null } });
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.office.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}

async function seedPermissions(): Promise<void> {
  const { PERMISSIONS } = await import("../src/server/auth/permissions");

  await prisma.permission.createMany({
    data: PERMISSIONS.map((key) => ({
      key,
      label: key
        .split(":")
        .map((part) => part.replace(/-/g, " "))
        .join(" — "),
      category: key.split(":")[0] ?? "general",
    })),
    skipDuplicates: true,
  });
}

/** Well-known development password. See the note where it is hashed. */
const DEV_SEED_PASSWORD = "taskflow-dev-2026";

async function main(): Promise<void> {
  /**
   * Hard refusal in production. This script truncates every table and creates
   * accounts with a publicly-known password; running it against a real
   * database would be catastrophic. `prisma/bootstrap.ts` is the production
   * path.
   */
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--i-know-this-is-destructive")) {
    console.error(
      [
        "",
        "✖ Refusing to run the development seed with NODE_ENV=production.",
        "  This script deletes all data and creates accounts with a known password.",
        "  Use `npm run db:bootstrap` to initialise a production database.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const skipIfPopulated = process.argv.includes("--if-empty");

  if (skipIfPopulated) {
    const existing = await prisma.organization.count();
    if (existing > 0) {
      console.log("↷ Database already contains an organisation — skipping seed.");
      return;
    }
  }

  console.log("→ Resetting existing data…");
  await reset();

  console.log("→ Seeding permission catalogue…");
  await seedPermissions();

  console.log(`→ Creating organisation “${ORGANIZATION.name}”…`);
  const organization = await prisma.organization.create({
    data: {
      name: ORGANIZATION.name,
      legalName: ORGANIZATION.legalName,
      slug: ORGANIZATION.slug,
      timezone: ORGANIZATION.timezone,
      currency: ORGANIZATION.currency,
      locale: ORGANIZATION.locale,
      plan: "GROWTH",
      workdayStartMinutes: 9 * 60,
      workdayEndMinutes: 18 * 60,
      gracePeriodMinutes: 15,
      fullDayHours: 8,
      halfDayHours: 4,
      weekendDays: [6, 7],
      maxAccuracyMeters: 100,
      maxTravelSpeedKmh: 900,
      enforceGeofence: true,
      allowManualOverride: true,
      requireCheckoutLocation: false,
    },
  });

  const organizationId = organization.id;

  // --- Offices + their primary geofence ------------------------------------
  console.log(`→ Creating ${OFFICES.length} offices with geofences…`);
  const officeIdByCode = new Map<string, string>();

  for (const office of OFFICES) {
    const created = await prisma.office.create({
      data: {
        organizationId,
        name: office.name,
        code: office.code,
        addressLine: office.addressLine,
        city: office.city,
        state: office.state,
        country: "India",
        postalCode: office.postalCode,
        timezone: office.timezone,
        latitude: office.latitude,
        longitude: office.longitude,
        workdayStartMinutes: office.workdayStartMinutes,
        workdayEndMinutes: office.workdayEndMinutes,
        gracePeriodMinutes: office.gracePeriodMinutes,
        status: "ACTIVE",
        geofences: {
          create: {
            name: "Main perimeter",
            latitude: office.latitude,
            longitude: office.longitude,
            radiusMeters: office.radiusMeters,
            isPrimary: true,
            isActive: true,
          },
        },
      },
      select: { id: true },
    });
    officeIdByCode.set(office.code, created.id);
  }

  // --- Departments ---------------------------------------------------------
  console.log(`→ Creating ${DEPARTMENTS.length} departments…`);
  const departmentIdByCode = new Map<string, string>();

  for (const department of DEPARTMENTS) {
    const created = await prisma.department.create({
      data: {
        organizationId,
        name: department.name,
        code: department.code,
        color: department.color,
        description: department.description,
      },
      select: { id: true },
    });
    departmentIdByCode.set(department.code, created.id);
  }

  // --- Users + employees ---------------------------------------------------
  console.log(`→ Creating ${EMPLOYEES.length} employees…`);
  const employeeIdByCode = new Map<string, string>();
  const employeeOfficeCode = new Map<string, string>();

  /**
   * Every seeded account gets the same well-known development password, hashed
   * with the production hasher — so the sign-in path exercised locally is
   * byte-for-byte the one that runs in production.
   *
   * This is a DEVELOPMENT seed. The password is intentionally public and
   * intentionally useless: `npm run db:seed` refuses to run against a
   * production database (see the guard in main()), and the production
   * bootstrap generates a random password instead.
   *
   * Hashed once and reused: 22 × scrypt at 32 MiB would otherwise make the
   * seed needlessly slow.
   */
  const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

  const emailFor = (employee: SeedEmployee): string =>
    `${employee.firstName}.${employee.lastName}`.toLowerCase().replace(/\s+/g, "") +
    "@acmetech.example";

  // Pass 1: create everyone without a manager link.
  for (const employee of EMPLOYEES) {
    const email = emailFor(employee);
    const officeId = officeIdByCode.get(employee.officeCode);
    const departmentId = departmentIdByCode.get(employee.departmentCode);

    const user = await prisma.user.create({
      data: {
        organizationId,
        email,
        name: `${employee.firstName} ${employee.lastName}`,
        role: employee.role as UserRole,
        status: "ACTIVE",
        provider: "PASSWORD",
        emailVerified: new Date(),
        passwordHash: seedPasswordHash,
        passwordUpdatedAt: new Date(),
      },
      select: { id: true },
    });

    const created = await prisma.employee.create({
      data: {
        organizationId,
        userId: user.id,
        employeeCode: employee.code,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email,
        phone: `+91 9${randomInt(100000000, 899999999)}`,
        designation: employee.designation,
        bio: employee.bio ?? null,
        departmentId: departmentId ?? null,
        primaryOfficeId: officeId ?? null,
        employmentType: employee.employmentType,
        status: employee.status ?? "ACTIVE",
        joinedAt: monthsAgo(employee.joinedMonthsAgo),
      },
      select: { id: true },
    });

    employeeIdByCode.set(employee.code, created.id);
    employeeOfficeCode.set(employee.code, employee.officeCode);
  }

  // Pass 2: wire up the reporting hierarchy.
  for (const employee of EMPLOYEES) {
    if (!employee.managerCode) continue;
    const id = employeeIdByCode.get(employee.code);
    const managerId = employeeIdByCode.get(employee.managerCode);
    if (!id || !managerId) continue;
    await prisma.employee.update({ where: { id }, data: { managerId } });
  }

  // Department heads.
  const headByDepartment: Record<string, string> = {
    ENG: "ACME-0005",
    MKT: "ACME-0015",
    SLS: "ACME-0018",
    HR: "ACME-0003",
    FIN: "ACME-0021",
  };
  for (const [code, employeeCode] of Object.entries(headByDepartment)) {
    const departmentId = departmentIdByCode.get(code);
    const headId = employeeIdByCode.get(employeeCode);
    if (departmentId && headId) {
      await prisma.department.update({ where: { id: departmentId }, data: { headId } });
    }
  }

  // --- Teams ---------------------------------------------------------------
  console.log(`→ Creating ${TEAMS.length} teams…`);
  const teamIdBySlug = new Map<string, string>();

  const teamManagerBySlug: Record<string, string> = {
    frontend: "ACME-0006",
    backend: "ACME-0005",
    marketing: "ACME-0015",
    people: "ACME-0003",
  };

  for (const team of TEAMS) {
    const members = EMPLOYEES.filter((employee) => employee.teamSlug === team.slug);
    const managerCode = teamManagerBySlug[team.slug];

    const created = await prisma.team.create({
      data: {
        organizationId,
        name: team.name,
        slug: team.slug,
        description: team.description,
        color: team.color,
        departmentId: departmentIdByCode.get(team.departmentCode) ?? null,
        managerId: managerCode ? (employeeIdByCode.get(managerCode) ?? null) : null,
        members: {
          create: members.flatMap((member) => {
            const employeeId = employeeIdByCode.get(member.code);
            if (!employeeId) return [];
            return [
              {
                employeeId,
                roleLabel: member.code === managerCode ? "Lead" : null,
              },
            ];
          }),
        },
      },
      select: { id: true },
    });

    teamIdBySlug.set(team.slug, created.id);
  }

  // --- Holidays ------------------------------------------------------------
  const year = new Date().getUTCFullYear();
  await prisma.holiday.createMany({
    data: HOLIDAYS.map((holiday) => ({
      organizationId,
      name: holiday.name,
      date: new Date(`${year}-${holiday.monthDay}T00:00:00.000Z`),
      isOptional: holiday.isOptional,
    })),
    skipDuplicates: true,
  });

  // --- Tasks ---------------------------------------------------------------
  console.log(`→ Creating ${TASKS.length} tasks with activity…`);
  const today = dateKey(new Date());

  for (const [index, task] of TASKS.entries()) {
    const creatorId = employeeIdByCode.get(task.creatorCode) ?? null;
    const assigneeIds = task.assigneeCodes
      .map((code) => employeeIdByCode.get(code))
      .filter((id): id is string => Boolean(id));

    const dueDate = addDays(today, task.dueInDays);
    const createdAt = addDays(dueDate, -randomInt(6, 20));

    const created = await prisma.task.create({
      data: {
        organizationId,
        reference: index + 1,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        creatorId,
        teamId: task.teamSlug ? (teamIdBySlug.get(task.teamSlug) ?? null) : null,
        startDate: addDays(createdAt, 1),
        dueDate,
        completedAt: task.status === "COMPLETED" ? addDays(dueDate, -1) : null,
        estimatedHours: task.estimatedHours,
        actualHours: task.status === "COMPLETED" ? task.estimatedHours * (0.8 + random() * 0.5) : 0,
        progress: task.progress,
        tags: task.tags,
        boardOrder: index,
        createdAt,
        assignees: {
          create: assigneeIds.map((employeeId, position) => ({
            employeeId,
            isOwner: position === 0,
          })),
        },
      },
      select: { id: true },
    });

    // A plausible activity trail, so the task timeline is not empty.
    const activities: Prisma.TaskActivityUncheckedCreateInput[] = [
      {
        organizationId,
        taskId: created.id,
        actorId: creatorId,
        type: "CREATED",
        message: "created this task",
        createdAt,
      },
    ];

    if (assigneeIds.length > 0) {
      activities.push({
        organizationId,
        taskId: created.id,
        actorId: creatorId,
        type: "ASSIGNED",
        message: `assigned it to ${assigneeIds.length} ${assigneeIds.length === 1 ? "person" : "people"}`,
        createdAt: addDays(createdAt, 0.02),
      });
    }

    if (task.status !== "TODO" && assigneeIds[0]) {
      activities.push({
        organizationId,
        taskId: created.id,
        actorId: assigneeIds[0],
        type: "STATUS_CHANGED",
        message: "started working on it",
        fromValue: "To do",
        toValue: "In progress",
        createdAt: addDays(createdAt, 1),
      });
    }

    if (task.progress > 0 && task.progress < 100 && assigneeIds[0]) {
      activities.push({
        organizationId,
        taskId: created.id,
        actorId: assigneeIds[0],
        type: "PROGRESS_UPDATED",
        message: `updated progress to ${task.progress}%`,
        fromValue: "0%",
        toValue: `${task.progress}%`,
        createdAt: addDays(createdAt, 2),
      });
    }

    if (task.status === "COMPLETED" && assigneeIds[0]) {
      activities.push({
        organizationId,
        taskId: created.id,
        actorId: assigneeIds[0],
        type: "COMPLETED",
        message: "completed this task",
        createdAt: addDays(dueDate, -1),
      });
    }

    await prisma.taskActivity.createMany({ data: activities });

    // Subtasks on the larger pieces of work.
    if (task.estimatedHours >= 14) {
      await prisma.subtask.createMany({
        data: [
          { taskId: created.id, title: "Agree the approach", isCompleted: true, position: 0, completedAt: addDays(createdAt, 1) },
          { taskId: created.id, title: "Implement", isCompleted: task.progress >= 60, position: 1 },
          { taskId: created.id, title: "Tests and review", isCompleted: task.status === "COMPLETED", position: 2 },
        ],
      });
    }

    // A comment or two on active work.
    if (task.status === "IN_PROGRESS" || task.status === "IN_REVIEW" || task.status === "BLOCKED") {
      const commenter = assigneeIds[0] ?? creatorId;
      if (commenter) {
        await prisma.taskComment.create({
          data: {
            organizationId,
            taskId: created.id,
            authorId: commenter,
            body:
              task.status === "BLOCKED"
                ? "Parked until the migration window is agreed — flagged with the platform team."
                : "Making progress. Should have something reviewable by the end of the week.",
            createdAt: addDays(createdAt, 3),
          },
        });
      }
    }
  }

  // --- Attendance history --------------------------------------------------
  console.log("→ Generating 60 days of attendance history…");

  const HISTORY_DAYS = 60;
  const activeEmployees = EMPLOYEES.filter((employee) => employee.status !== "INACTIVE");

  const attendanceRows: Prisma.AttendanceRecordUncheckedCreateInput[] = [];
  const eventRows: Array<Prisma.AttendanceEventUncheckedCreateInput & { _recordKey: string }> = [];

  for (let dayOffset = HISTORY_DAYS; dayOffset >= 0; dayOffset -= 1) {
    const day = addDays(today, -dayOffset);
    const weekend = isWeekend(day);

    for (const employee of activeEmployees) {
      const employeeId = employeeIdByCode.get(employee.code);
      const officeCode = employeeOfficeCode.get(employee.code);
      const officeId = officeCode ? officeIdByCode.get(officeCode) : undefined;
      const office = OFFICES.find((entry) => entry.code === officeCode);
      if (!employeeId || !office) continue;

      // Nobody has attendance before they joined.
      if (day < monthsAgo(employee.joinedMonthsAgo)) continue;

      if (weekend) {
        attendanceRows.push({
          organizationId,
          employeeId,
          officeId: officeId ?? null,
          date: day,
          status: "WEEKEND",
          workedMinutes: 0,
        });
        continue;
      }

      // Someone marked ON_LEAVE is away for the recent stretch.
      if (employee.status === "ON_LEAVE" && dayOffset <= 6) {
        attendanceRows.push({
          organizationId,
          employeeId,
          officeId: officeId ?? null,
          date: day,
          status: "ON_LEAVE",
          workedMinutes: 0,
        });
        continue;
      }

      // Absent?
      if (random() > employee.attendanceReliability) {
        attendanceRows.push({
          organizationId,
          employeeId,
          officeId: officeId ?? null,
          date: day,
          status: "ABSENT",
          workedMinutes: 0,
        });
        continue;
      }

      // Present — decide arrival, departure and breaks.
      const late = random() < employee.latenessTendency;
      const lateThreshold = office.workdayStartMinutes + office.gracePeriodMinutes;

      const checkInMinutes = late
        ? lateThreshold + randomInt(5, 75)
        : office.workdayStartMinutes + randomInt(-20, office.gracePeriodMinutes);

      const dayLength = randomInt(7 * 60 + 30, 10 * 60);
      const checkOutMinutes = Math.min(23 * 60 + 30, checkInMinutes + dayLength);
      const breakMinutes = randomInt(25, 65);

      const workedMinutes = Math.max(0, checkOutMinutes - checkInMinutes - breakMinutes);
      const lateByMinutes = Math.max(0, checkInMinutes - lateThreshold);
      const earlyByMinutes = Math.max(0, office.workdayEndMinutes - checkOutMinutes);
      const overtimeMinutes = Math.max(0, workedMinutes - 8 * 60);

      let status: AttendanceStatus;
      if (workedMinutes < 4 * 60) status = "HALF_DAY";
      else if (lateByMinutes > 0) status = "LATE";
      else status = "PRESENT";

      // Today: some people are still checked in.
      const stillIn = dayOffset === 0 && random() < 0.55;

      const checkInAt = atLocalMinutes(day, checkInMinutes);
      const checkOutAt = stillIn ? null : atLocalMinutes(day, checkOutMinutes);

      const recordKey = `${employee.code}:${day.toISOString()}`;

      attendanceRows.push({
        organizationId,
        employeeId,
        officeId: officeId ?? null,
        date: day,
        checkInAt,
        checkOutAt,
        status: stillIn ? (lateByMinutes > 0 ? "LATE" : "PRESENT") : status,
        workedMinutes: stillIn ? 0 : workedMinutes,
        breakMinutes: stillIn ? 0 : breakMinutes,
        overtimeMinutes: stillIn ? 0 : overtimeMinutes,
        lateByMinutes,
        earlyByMinutes: stillIn ? 0 : earlyByMinutes,
      });

      // Location evidence for the check-in. Most are clean; a small number are
      // deliberately flagged so the Location Review tab has something to show.
      const clean = random() > 0.04;
      const distance = clean ? randomInt(4, office.radiusMeters - 10) : office.radiusMeters + randomInt(30, 260);

      eventRows.push({
        _recordKey: recordKey,
        organizationId,
        employeeId,
        officeId: officeId ?? null,
        type: "CHECK_IN",
        occurredAt: checkInAt,
        latitude: office.latitude + (random() - 0.5) * 0.001,
        longitude: office.longitude + (random() - 0.5) * 0.001,
        accuracyMeters: randomInt(5, 38),
        distanceMeters: distance,
        verification: clean ? "VERIFIED" : "OUTSIDE_GEOFENCE",
        source: random() > 0.35 ? "WEB" : "MOBILE",
        riskFlags: clean ? [] : ["OUTSIDE_ALL_GEOFENCES"],
      });

      if (checkOutAt) {
        eventRows.push({
          _recordKey: recordKey,
          organizationId,
          employeeId,
          officeId: officeId ?? null,
          type: "CHECK_OUT",
          occurredAt: checkOutAt,
          latitude: office.latitude + (random() - 0.5) * 0.001,
          longitude: office.longitude + (random() - 0.5) * 0.001,
          accuracyMeters: randomInt(5, 40),
          distanceMeters: randomInt(4, office.radiusMeters - 10),
          verification: "VERIFIED",
          source: "WEB",
          riskFlags: [],
        });
      }
    }
  }

  // Bulk insert, then link events to their records.
  await prisma.attendanceRecord.createMany({ data: attendanceRows, skipDuplicates: true });

  const savedRecords = await prisma.attendanceRecord.findMany({
    where: { organizationId },
    select: { id: true, employeeId: true, date: true },
  });

  const employeeCodeById = new Map(
    Array.from(employeeIdByCode.entries()).map(([code, id]) => [id, code]),
  );
  const recordIdByKey = new Map(
    savedRecords.map((record) => [
      `${employeeCodeById.get(record.employeeId)}:${record.date.toISOString()}`,
      record.id,
    ]),
  );

  await prisma.attendanceEvent.createMany({
    data: eventRows.map(({ _recordKey, ...event }) => ({
      ...event,
      attendanceRecordId: recordIdByKey.get(_recordKey) ?? null,
    })),
  });

  console.log(
    `   ${attendanceRows.length} attendance records, ${eventRows.length} location events.`,
  );

  // --- Leave ---------------------------------------------------------------
  const onLeaveEmployee = employeeIdByCode.get("ACME-0022");
  const leaveReviewer = employeeIdByCode.get("ACME-0021");
  if (onLeaveEmployee && leaveReviewer) {
    await prisma.leave.create({
      data: {
        organizationId,
        employeeId: onLeaveEmployee,
        type: "SICK",
        status: "APPROVED",
        startDate: addDays(today, -6),
        endDate: addDays(today, 2),
        days: 7,
        reason: "Medical leave, certificate submitted to HR.",
        reviewerId: leaveReviewer,
        reviewedAt: addDays(today, -7),
        reviewNote: "Approved. Get well soon.",
      },
    });
  }

  const pendingRequester = employeeIdByCode.get("ACME-0011");
  const pendingReviewer = employeeIdByCode.get("ACME-0006");
  if (pendingRequester && pendingReviewer) {
    await prisma.leave.create({
      data: {
        organizationId,
        employeeId: pendingRequester,
        type: "CASUAL",
        status: "PENDING",
        startDate: addDays(today, 9),
        endDate: addDays(today, 10),
        days: 2,
        reason: "Family function out of town.",
      },
    });
  }

  // --- Notifications -------------------------------------------------------
  console.log("→ Creating notifications…");
  const notificationTargets = await prisma.employee.findMany({
    where: { organizationId, userId: { not: null } },
    select: { id: true, userId: true, firstName: true },
    take: 12,
  });

  const firstTask = await prisma.task.findFirst({
    where: { organizationId },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });

  await prisma.notification.createMany({
    data: notificationTargets.flatMap((target) => {
      if (!target.userId) return [];
      return [
        {
          organizationId,
          userId: target.userId,
          type: "ANNOUNCEMENT" as const,
          channel: "IN_APP" as const,
          title: "Attendance policy updated",
          body: "The grace period is now 15 minutes at Guntur HQ and 20 minutes in Hyderabad.",
          linkUrl: "/app/settings",
          createdAt: addDays(today, -2),
        },
        ...(firstTask
          ? [
              {
                organizationId,
                userId: target.userId,
                type: "TASK_ASSIGNED" as const,
                channel: "IN_APP" as const,
                title: "New task assigned",
                body: `You were added to “${firstTask.title}”.`,
                linkUrl: `/app/tasks/${firstTask.id}`,
                createdAt: addDays(today, -1),
              },
            ]
          : []),
      ];
    }),
  });

  // --- Audit log -----------------------------------------------------------
  const adminUser = await prisma.user.findFirst({
    where: { organizationId, role: "ADMIN" },
    select: { id: true },
  });

  if (adminUser) {
    const hyderabad = officeIdByCode.get("HYD-01");
    await prisma.auditLog.createMany({
      data: [
        {
          organizationId,
          actorUserId: adminUser.id,
          action: "GEOFENCE_CHANGE",
          entityType: "office_geofences",
          entityId: hyderabad ?? null,
          summary: "Changed Hyderabad Office geofence: radius 100m → 150m",
          changes: { radiusMeters: { from: 100, to: 150 } },
          createdAt: addDays(today, -5),
        },
        {
          organizationId,
          actorUserId: adminUser.id,
          action: "UPDATE",
          entityType: "organizations",
          summary: "Updated attendance policy: grace period 10 → 15 minutes",
          changes: { gracePeriodMinutes: { from: 10, to: 15 } },
          createdAt: addDays(today, -2),
        },
      ],
    });
  }

  // --- Summary -------------------------------------------------------------
  const owner = EMPLOYEES.find((employee) => employee.role === "OWNER");

  console.log("\n✔ Seed complete.\n");
  console.log(`   Organisation : ${ORGANIZATION.name}`);
  console.log(`   Offices      : ${OFFICES.length}`);
  console.log(`   Departments  : ${DEPARTMENTS.length}`);
  console.log(`   Teams        : ${TEAMS.length}`);
  console.log(`   Employees    : ${EMPLOYEES.length}`);
  console.log(`   Tasks        : ${TASKS.length}`);
  console.log(`   Attendance   : ${attendanceRows.length} records over ${HISTORY_DAYS} days\n`);
  if (owner) {
    const ownerEmail = `${owner.firstName}.${owner.lastName}`.toLowerCase() + "@acmetech.example";
    console.log(`   Sign in as          : ${ownerEmail}`);
    console.log(`   Password            : ${DEV_SEED_PASSWORD}   (development only)`);
    console.log(`   (set DEV_AUTH_DEFAULT_USER to any seeded email, or use the`);
    console.log(`    flask icon in the top bar to switch between roles)\n`);
  }
}

main()
  .catch((error) => {
    console.error("\n✖ Seed failed:\n", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
