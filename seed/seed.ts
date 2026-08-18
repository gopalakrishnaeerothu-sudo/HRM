/**
 * Demo seed.
 *
 * Populates a full organisation — offices, departments, teams, 22 employees,
 * a task backlog and roughly two months of attendance history — so the
 * dashboards have something real to show the moment the app opens.
 *
 * Run with:  npm run db:seed
 * Add `--if-empty` to skip when the database already has an organisation, so a
 * redeploy never duplicates data.
 *
 * Determinism: a seeded PRNG drives every "random" choice, so two runs against
 * a fresh database produce identical data. That matters for screenshots, demos
 * and for tests that assert on seeded values.
 *
 * Everything runs inside ONE transaction. A seed that fails halfway leaves a
 * half-populated database that looks plausible but is not, which is worse than
 * an empty one — so it either all lands or none of it does.
 */

import { Pool, type PoolClient } from "pg";

import {
  DEPARTMENTS,
  EMPLOYEES,
  HOLIDAYS,
  OFFICES,
  ORGANIZATION,
  TASKS,
  TEAMS,
  type SeedEmployee,
} from "./data";

// --- Deterministic randomness ----------------------------------------------

/** Mulberry32 — small, fast, and reproducible from a fixed seed. */
function createRandom(seed: number) {
  let state = seed;
  return function next(): number {
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

const IST_OFFSET_MINUTES = 330;

function atLocalMinutes(day: Date, minutesOfDay: number): Date {
  return new Date(day.getTime() + (minutesOfDay - IST_OFFSET_MINUTES) * 60_000);
}

function isWeekend(day: Date): boolean {
  const weekday = day.getUTCDay();
  return weekday === 0 || weekday === 6;
}

// --- Seed steps -------------------------------------------------------------

/**
 * Clear application data.
 *
 * TRUNCATE ... CASCADE rather than a hand-ordered cascade of DELETEs: the
 * ordering is the database's problem, not ours, and it cannot drift when a
 * migration adds a table. schema_migrations is excluded — wiping it would make
 * the runner try to re-apply migrations over an existing schema.
 */
async function reset(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );

  if (rows.length === 0) {
    throw new Error("No tables found — run `npm run db:migrate` before seeding.");
  }

  const tables = rows.map((row) => `"${row.tablename}"`).join(", ");
  await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

async function seedPermissions(client: PoolClient): Promise<void> {
  const { PERMISSIONS } = await import("../src/server/auth/permissions");

  await client.query(
    `INSERT INTO permissions (key, label, category)
     SELECT k, l, c FROM UNNEST($1::text[], $2::text[], $3::text[]) AS t(k, l, c)
     ON CONFLICT (key) DO NOTHING`,
    [
      PERMISSIONS.map((key) => key),
      PERMISSIONS.map((key) =>
        key
          .split(":")
          .map((part) => part.replace(/-/g, " "))
          .join(" — "),
      ),
      PERMISSIONS.map((key) => key.split(":")[0] ?? "general"),
    ],
  );
}

const emailFor = (employee: SeedEmployee): string =>
  `${employee.firstName}.${employee.lastName}`.toLowerCase().replace(/\s+/g, "") +
  "@acmetech.example";

async function seed(client: PoolClient): Promise<{ attendance: number; events: number }> {
  console.log("→ Resetting existing data…");
  await reset(client);

  console.log("→ Seeding permission catalogue…");
  await seedPermissions(client);

  console.log(`→ Creating organisation “${ORGANIZATION.name}”…`);
  const { rows: orgRows } = await client.query<{ id: string }>(
    `INSERT INTO organizations (
       name, legal_name, slug, timezone, currency, locale, plan,
       workday_start_minutes, workday_end_minutes, grace_period_minutes,
       full_day_hours, half_day_hours, weekend_days,
       max_accuracy_meters, max_travel_speed_kmh,
       enforce_geofence, allow_manual_override, require_checkout_location
     )
     VALUES ($1,$2,$3,$4,$5,$6,'GROWTH',540,1080,15,8,4,
             ARRAY[6,7]::SMALLINT[],100,900,TRUE,TRUE,FALSE)
     RETURNING id`,
    [
      ORGANIZATION.name,
      ORGANIZATION.legalName,
      ORGANIZATION.slug,
      ORGANIZATION.timezone,
      ORGANIZATION.currency,
      ORGANIZATION.locale,
    ],
  );
  const organizationId = orgRows[0]!.id;

  // --- Offices + their primary geofence ------------------------------------
  console.log(`→ Creating ${OFFICES.length} offices with geofences…`);
  const officeIdByCode = new Map<string, string>();

  for (const office of OFFICES) {
    // The office and its perimeter are created together in one statement: an
    // office nobody can check in to is not a usable record.
    const { rows } = await client.query<{ id: string }>(
      `WITH new_office AS (
         INSERT INTO offices (
           organization_id, name, code, address_line, city, state, country,
           postal_code, timezone, latitude, longitude,
           workday_start_minutes, workday_end_minutes, grace_period_minutes, status
         )
         VALUES ($1,$2,$3,$4,$5,$6,'India',$7,$8,$9,$10,$11,$12,$13,'ACTIVE')
         RETURNING id, latitude, longitude
       )
       INSERT INTO office_geofences (
         office_id, name, latitude, longitude, radius_meters, is_primary, is_active
       )
       SELECT id, 'Main perimeter', latitude, longitude, $14, TRUE, TRUE
         FROM new_office
       RETURNING office_id AS id`,
      [
        organizationId,
        office.name,
        office.code,
        office.addressLine,
        office.city,
        office.state,
        office.postalCode,
        office.timezone,
        office.latitude,
        office.longitude,
        office.workdayStartMinutes,
        office.workdayEndMinutes,
        office.gracePeriodMinutes,
        office.radiusMeters,
      ],
    );
    officeIdByCode.set(office.code, rows[0]!.id);
  }

  // --- Departments ---------------------------------------------------------
  console.log(`→ Creating ${DEPARTMENTS.length} departments…`);
  const departmentIdByCode = new Map<string, string>();

  for (const department of DEPARTMENTS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO departments (organization_id, name, code, color, description)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [organizationId, department.name, department.code, department.color, department.description],
    );
    departmentIdByCode.set(department.code, rows[0]!.id);
  }

  // --- Users + employees ---------------------------------------------------
  console.log(`→ Creating ${EMPLOYEES.length} employees…`);
  const employeeIdByCode = new Map<string, string>();
  const employeeOfficeCode = new Map<string, string>();
  const userIdByCode = new Map<string, string>();

  // Pass 1: create everyone without a manager link, because a manager may
  // appear later in the list than the person reporting to them.
  for (const employee of EMPLOYEES) {
    const email = emailFor(employee);

    const { rows: userRows } = await client.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, name, role, status, provider, email_verified)
       VALUES ($1,$2,$3,$4::user_role,'ACTIVE','DEV',NOW()) RETURNING id`,
      [organizationId, email, `${employee.firstName} ${employee.lastName}`, employee.role],
    );
    const userId = userRows[0]!.id;

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO employees (
         organization_id, user_id, employee_code, first_name, last_name, email,
         phone, designation, bio, department_id, primary_office_id,
         employment_type, status, joined_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               $12::employment_type, $13::employee_status, $14)
       RETURNING id`,
      [
        organizationId,
        userId,
        employee.code,
        employee.firstName,
        employee.lastName,
        email,
        `+91 9${randomInt(100000000, 899999999)}`,
        employee.designation,
        employee.bio ?? null,
        departmentIdByCode.get(employee.departmentCode) ?? null,
        officeIdByCode.get(employee.officeCode) ?? null,
        employee.employmentType,
        employee.status ?? "ACTIVE",
        monthsAgo(employee.joinedMonthsAgo),
      ],
    );

    employeeIdByCode.set(employee.code, rows[0]!.id);
    employeeOfficeCode.set(employee.code, employee.officeCode);
    userIdByCode.set(employee.code, userId);
  }

  // Pass 2: wire up the reporting hierarchy.
  for (const employee of EMPLOYEES) {
    if (!employee.managerCode) continue;
    const id = employeeIdByCode.get(employee.code);
    const managerId = employeeIdByCode.get(employee.managerCode);
    if (!id || !managerId) continue;
    await client.query(`UPDATE employees SET manager_id = $2 WHERE id = $1`, [id, managerId]);
  }

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
      await client.query(`UPDATE departments SET head_id = $2 WHERE id = $1`, [
        departmentId,
        headId,
      ]);
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
    const managerCode = teamManagerBySlug[team.slug];

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO teams (organization_id, name, slug, description, color, department_id, manager_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        organizationId,
        team.name,
        team.slug,
        team.description,
        team.color,
        departmentIdByCode.get(team.departmentCode) ?? null,
        managerCode ? (employeeIdByCode.get(managerCode) ?? null) : null,
      ],
    );
    const teamId = rows[0]!.id;
    teamIdBySlug.set(team.slug, teamId);

    const members = EMPLOYEES.filter((employee) => employee.teamSlug === team.slug);
    if (members.length > 0) {
      await client.query(
        `INSERT INTO team_members (team_id, employee_id, role_label)
         SELECT $1, e, r FROM UNNEST($2::uuid[], $3::text[]) AS t(e, r)`,
        [
          teamId,
          members.map((member) => employeeIdByCode.get(member.code)).filter(Boolean),
          members
            .filter((member) => employeeIdByCode.has(member.code))
            .map((member) => (member.code === managerCode ? "Lead" : null)),
        ],
      );
    }
  }

  // --- Holidays ------------------------------------------------------------
  const year = new Date().getUTCFullYear();
  await client.query(
    `INSERT INTO holidays (organization_id, name, date, is_optional)
     SELECT $1, n, d::date, o
       FROM UNNEST($2::text[], $3::text[], $4::boolean[]) AS t(n, d, o)
     ON CONFLICT DO NOTHING`,
    [
      organizationId,
      HOLIDAYS.map((holiday) => holiday.name),
      HOLIDAYS.map((holiday) => `${year}-${holiday.monthDay}`),
      HOLIDAYS.map((holiday) => holiday.isOptional),
    ],
  );

  // --- Tasks ---------------------------------------------------------------
  console.log(`→ Creating ${TASKS.length} tasks with activity…`);
  const today = dateKey(new Date());
  let firstTask: { id: string; title: string } | null = null;

  for (const [index, task] of TASKS.entries()) {
    const creatorId = employeeIdByCode.get(task.creatorCode) ?? null;
    const assigneeIds = task.assigneeCodes
      .map((code) => employeeIdByCode.get(code))
      .filter((id): id is string => Boolean(id));

    const dueDate = addDays(today, task.dueInDays);
    const createdAt = addDays(dueDate, -randomInt(6, 20));

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO tasks (
         organization_id, reference, title, description, status, priority,
         creator_id, team_id, start_date, due_date, completed_at,
         estimated_hours, actual_hours, progress, tags, board_order, created_at
       )
       VALUES ($1,$2,$3,$4,$5::task_status,$6::task_priority,$7,$8,$9,$10,$11,
               $12,$13,$14,$15::text[],$16,$17)
       RETURNING id`,
      [
        organizationId,
        index + 1,
        task.title,
        task.description,
        task.status,
        task.priority,
        creatorId,
        task.teamSlug ? (teamIdBySlug.get(task.teamSlug) ?? null) : null,
        addDays(createdAt, 1),
        dueDate,
        task.status === "COMPLETED" ? addDays(dueDate, -1) : null,
        task.estimatedHours,
        task.status === "COMPLETED" ? task.estimatedHours * (0.8 + random() * 0.5) : 0,
        task.progress,
        [...task.tags],
        index,
        createdAt,
      ],
    );
    const taskId = rows[0]!.id;
    firstTask ??= { id: taskId, title: task.title };

    if (assigneeIds.length > 0) {
      await client.query(
        `INSERT INTO task_assignees (task_id, employee_id, is_owner)
         SELECT $1, e, (ordinality = 1)
           FROM UNNEST($2::uuid[]) WITH ORDINALITY AS t(e, ordinality)`,
        [taskId, assigneeIds],
      );
    }

    // A plausible activity trail, so the task timeline is not empty.
    const activities: Array<{
      actorId: string | null;
      type: string;
      message: string;
      fromValue: string | null;
      toValue: string | null;
      createdAt: Date;
    }> = [
      {
        actorId: creatorId,
        type: "CREATED",
        message: "created this task",
        fromValue: null,
        toValue: null,
        createdAt,
      },
    ];

    if (assigneeIds.length > 0) {
      activities.push({
        actorId: creatorId,
        type: "ASSIGNED",
        message: `assigned it to ${assigneeIds.length} ${assigneeIds.length === 1 ? "person" : "people"}`,
        fromValue: null,
        toValue: null,
        createdAt: addDays(createdAt, 0.02),
      });
    }

    if (task.status !== "TODO" && assigneeIds[0]) {
      activities.push({
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
        actorId: assigneeIds[0],
        type: "COMPLETED",
        message: "completed this task",
        fromValue: null,
        toValue: null,
        createdAt: addDays(dueDate, -1),
      });
    }

    await client.query(
      `INSERT INTO task_activity (
         organization_id, task_id, actor_id, type, message, from_value, to_value, created_at
       )
       SELECT $1, $2, a, t::task_activity_type, m, f, v, c
         FROM UNNEST($3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[])
              AS x(a, t, m, f, v, c)`,
      [
        organizationId,
        taskId,
        activities.map((activity) => activity.actorId),
        activities.map((activity) => activity.type),
        activities.map((activity) => activity.message),
        activities.map((activity) => activity.fromValue),
        activities.map((activity) => activity.toValue),
        activities.map((activity) => activity.createdAt),
      ],
    );

    // Subtasks on the larger pieces of work.
    //
    // Migration 010 requires is_completed and completed_at to agree, so the
    // date is derived from the flag rather than supplied alongside it. Setting
    // them independently is what let the old seed mark work finished with no
    // date on it.
    if (task.estimatedHours >= 14) {
      const done = [true, task.progress >= 60, task.status === "COMPLETED"];

      await client.query(
        `INSERT INTO subtasks (task_id, title, is_completed, position, completed_at)
         SELECT $1, t, c, p, CASE WHEN c THEN d ELSE NULL END
           FROM UNNEST($2::text[], $3::boolean[], $4::int[], $5::timestamptz[]) AS x(t, c, p, d)`,
        [
          taskId,
          ["Agree the approach", "Implement", "Tests and review"],
          done,
          [0, 1, 2],
          [addDays(createdAt, 1), addDays(createdAt, 4), addDays(dueDate, -1)],
        ],
      );
    }

    // A comment or two on active work.
    if (task.status === "IN_PROGRESS" || task.status === "IN_REVIEW" || task.status === "BLOCKED") {
      const commenter = assigneeIds[0] ?? creatorId;
      if (commenter) {
        await client.query(
          `INSERT INTO task_comments (organization_id, task_id, author_id, body, created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            organizationId,
            taskId,
            commenter,
            task.status === "BLOCKED"
              ? "Parked until the migration window is agreed — flagged with the platform team."
              : "Making progress. Should have something reviewable by the end of the week.",
            addDays(createdAt, 3),
          ],
        );
      }
    }
  }

  // --- Attendance history --------------------------------------------------
  console.log("→ Generating 60 days of attendance history…");

  const HISTORY_DAYS = 60;
  const activeEmployees = EMPLOYEES.filter((employee) => employee.status !== "INACTIVE");

  interface AttendanceRow {
    employeeId: string;
    officeId: string | null;
    date: Date;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    status: string;
    workedMinutes: number;
    breakMinutes: number;
    overtimeMinutes: number;
    lateByMinutes: number;
    earlyByMinutes: number;
  }

  interface EventRow {
    recordKey: string;
    employeeId: string;
    officeId: string | null;
    type: string;
    occurredAt: Date;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    distanceMeters: number;
    verification: string;
    source: string;
    riskFlags: string[];
  }

  const attendanceRows: AttendanceRow[] = [];
  const eventRows: EventRow[] = [];

  for (let dayOffset = HISTORY_DAYS; dayOffset >= 0; dayOffset -= 1) {
    const day = addDays(today, -dayOffset);
    const weekend = isWeekend(day);

    for (const employee of activeEmployees) {
      const employeeId = employeeIdByCode.get(employee.code);
      const officeCode = employeeOfficeCode.get(employee.code);
      const officeId = officeCode ? (officeIdByCode.get(officeCode) ?? null) : null;
      const office = OFFICES.find((entry) => entry.code === officeCode);
      if (!employeeId || !office) continue;

      // Nobody has attendance before they joined.
      if (day < monthsAgo(employee.joinedMonthsAgo)) continue;

      const base = {
        employeeId,
        officeId,
        date: day,
        checkInAt: null,
        checkOutAt: null,
        workedMinutes: 0,
        breakMinutes: 0,
        overtimeMinutes: 0,
        lateByMinutes: 0,
        earlyByMinutes: 0,
      };

      if (weekend) {
        attendanceRows.push({ ...base, status: "WEEKEND" });
        continue;
      }

      // Someone marked ON_LEAVE is away for the recent stretch.
      if (employee.status === "ON_LEAVE" && dayOffset <= 6) {
        attendanceRows.push({ ...base, status: "ON_LEAVE" });
        continue;
      }

      if (random() > employee.attendanceReliability) {
        attendanceRows.push({ ...base, status: "ABSENT" });
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

      let status: string;
      if (workedMinutes < 4 * 60) status = "HALF_DAY";
      else if (lateByMinutes > 0) status = "LATE";
      else status = "PRESENT";

      // Today: some people are still checked in.
      const stillIn = dayOffset === 0 && random() < 0.55;

      const checkInAt = atLocalMinutes(day, checkInMinutes);
      const checkOutAt = stillIn ? null : atLocalMinutes(day, checkOutMinutes);
      const recordKey = `${employee.code}:${day.toISOString()}`;

      attendanceRows.push({
        employeeId,
        officeId,
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
      const distance = clean
        ? randomInt(4, office.radiusMeters - 10)
        : office.radiusMeters + randomInt(30, 260);

      eventRows.push({
        recordKey,
        employeeId,
        officeId,
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
          recordKey,
          employeeId,
          officeId,
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

  // Bulk insert via UNNEST — one statement for ~1,300 rows rather than 1,300
  // round trips, which is the difference between a seed that takes a second
  // and one that takes a minute.
  await client.query(
    `INSERT INTO attendance_records (
       organization_id, employee_id, office_id, date, check_in_at, check_out_at,
       status, worked_minutes, break_minutes, overtime_minutes,
       late_by_minutes, early_by_minutes
     )
     SELECT $1, e, o, d::date, ci, co, s::attendance_status, w, b, ot, lt, eb
       FROM UNNEST(
         $2::uuid[], $3::uuid[], $4::timestamptz[], $5::timestamptz[], $6::timestamptz[],
         $7::text[], $8::int[], $9::int[], $10::int[], $11::int[], $12::int[]
       ) AS t(e, o, d, ci, co, s, w, b, ot, lt, eb)
     ON CONFLICT (employee_id, date) DO NOTHING`,
    [
      organizationId,
      attendanceRows.map((row) => row.employeeId),
      attendanceRows.map((row) => row.officeId),
      attendanceRows.map((row) => row.date),
      attendanceRows.map((row) => row.checkInAt),
      attendanceRows.map((row) => row.checkOutAt),
      attendanceRows.map((row) => row.status),
      attendanceRows.map((row) => row.workedMinutes),
      attendanceRows.map((row) => row.breakMinutes),
      attendanceRows.map((row) => row.overtimeMinutes),
      attendanceRows.map((row) => row.lateByMinutes),
      attendanceRows.map((row) => row.earlyByMinutes),
    ],
  );

  // Link events to the records just written.
  const { rows: savedRecords } = await client.query<{
    id: string;
    employee_id: string;
    date: Date;
  }>(`SELECT id, employee_id, date FROM attendance_records WHERE organization_id = $1`, [
    organizationId,
  ]);

  const employeeCodeById = new Map(
    Array.from(employeeIdByCode.entries()).map(([code, id]) => [id, code]),
  );
  const recordIdByKey = new Map(
    savedRecords.map((record) => [
      `${employeeCodeById.get(record.employee_id)}:${record.date.toISOString()}`,
      record.id,
    ]),
  );

  await client.query(
    `INSERT INTO attendance_events (
       organization_id, employee_id, attendance_record_id, office_id, type,
       occurred_at, latitude, longitude, accuracy_meters, distance_meters,
       verification, source, risk_flags
     )
     SELECT $1, e, r, o, t::attendance_event_type, oa, la, lo, ac, di,
            v::location_verification, s::attendance_source,
            -- UNNEST flattens a 2-D array, losing the per-row grouping, so the
            -- flag lists travel as delimited strings and are split back here.
            CASE WHEN rf = '' THEN ARRAY[]::text[] ELSE string_to_array(rf, ',') END
       FROM UNNEST(
         $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::timestamptz[],
         $7::numeric[], $8::numeric[], $9::int[], $10::int[],
         $11::text[], $12::text[], $13::text[]
       ) AS x(e, r, o, t, oa, la, lo, ac, di, v, s, rf)`,
    [
      organizationId,
      eventRows.map((row) => row.employeeId),
      eventRows.map((row) => recordIdByKey.get(row.recordKey) ?? null),
      eventRows.map((row) => row.officeId),
      eventRows.map((row) => row.type),
      eventRows.map((row) => row.occurredAt),
      eventRows.map((row) => row.latitude),
      eventRows.map((row) => row.longitude),
      eventRows.map((row) => row.accuracyMeters),
      eventRows.map((row) => row.distanceMeters),
      eventRows.map((row) => row.verification),
      eventRows.map((row) => row.source),
      eventRows.map((row) => row.riskFlags.join(",")),
    ],
  );

  console.log(
    `   ${attendanceRows.length} attendance records, ${eventRows.length} location events.`,
  );

  // --- Leave ---------------------------------------------------------------
  const onLeaveEmployee = employeeIdByCode.get("ACME-0022");
  const leaveReviewer = employeeIdByCode.get("ACME-0021");
  if (onLeaveEmployee && leaveReviewer) {
    await client.query(
      `INSERT INTO leaves (organization_id, employee_id, type, status, start_date, end_date,
                           days, reason, reviewer_id, reviewed_at, review_note)
       VALUES ($1,$2,'SICK','APPROVED',$3::date,$4::date,7,$5,$6,$7,$8)`,
      [
        organizationId,
        onLeaveEmployee,
        addDays(today, -6),
        addDays(today, 2),
        "Medical leave, certificate submitted to HR.",
        leaveReviewer,
        addDays(today, -7),
        "Approved. Get well soon.",
      ],
    );
  }

  const pendingRequester = employeeIdByCode.get("ACME-0011");
  if (pendingRequester) {
    await client.query(
      `INSERT INTO leaves (organization_id, employee_id, type, status, start_date, end_date,
                           days, reason)
       VALUES ($1,$2,'CASUAL','PENDING',$3::date,$4::date,2,$5)`,
      [
        organizationId,
        pendingRequester,
        addDays(today, 9),
        addDays(today, 10),
        "Family function out of town.",
      ],
    );
  }

  // --- Notifications -------------------------------------------------------
  console.log("→ Creating notifications…");
  const targets = EMPLOYEES.slice(0, 12)
    .map((employee) => userIdByCode.get(employee.code))
    .filter((id): id is string => Boolean(id));

  const notifications = targets.flatMap((userId) => [
    {
      userId,
      type: "ANNOUNCEMENT",
      title: "Attendance policy updated",
      body: "The grace period is now 15 minutes at Guntur HQ and 20 minutes in Hyderabad.",
      linkUrl: "/app/settings",
      createdAt: addDays(today, -2),
    },
    ...(firstTask
      ? [
          {
            userId,
            type: "TASK_ASSIGNED",
            title: "New task assigned",
            body: `You were added to “${firstTask.title}”.`,
            linkUrl: `/app/tasks/${firstTask.id}`,
            createdAt: addDays(today, -1),
          },
        ]
      : []),
  ]);

  if (notifications.length > 0) {
    await client.query(
      `INSERT INTO notifications (organization_id, user_id, type, channel, title, body, link_url, created_at)
       SELECT $1, u, t::notification_type, 'IN_APP', ti, b, l, c
         FROM UNNEST($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[])
              AS x(u, t, ti, b, l, c)`,
      [
        organizationId,
        notifications.map((notification) => notification.userId),
        notifications.map((notification) => notification.type),
        notifications.map((notification) => notification.title),
        notifications.map((notification) => notification.body),
        notifications.map((notification) => notification.linkUrl),
        notifications.map((notification) => notification.createdAt),
      ],
    );
  }

  // --- Audit log -----------------------------------------------------------
  const adminCode = EMPLOYEES.find(
    (employee) => employee.role === "ADMIN" || employee.role === "OWNER",
  )?.code;
  const adminUserId = adminCode ? userIdByCode.get(adminCode) : null;

  if (adminUserId) {
    await client.query(
      `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type,
                               entity_id, summary, changes, created_at)
       SELECT $1, $2, a::audit_action, et, ei, s, c::jsonb, ca
         FROM UNNEST($3::text[], $4::text[], $5::uuid[], $6::text[], $7::text[], $8::timestamptz[])
              AS x(a, et, ei, s, c, ca)`,
      [
        organizationId,
        adminUserId,
        ["GEOFENCE_CHANGE", "UPDATE"],
        ["office_geofences", "organizations"],
        [officeIdByCode.get("HYD-01") ?? null, null],
        [
          "Changed Hyderabad Office geofence: radius 100m → 150m",
          "Updated attendance policy: grace period 10 → 15 minutes",
        ],
        [
          JSON.stringify({ radiusMeters: { from: 100, to: 150 } }),
          JSON.stringify({ gracePeriodMinutes: { from: 10, to: 15 } }),
        ],
        [addDays(today, -5), addDays(today, -2)],
      ],
    );
  }

  return { attendance: attendanceRows.length, events: eventRows.length };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    if (process.argv.includes("--if-empty")) {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM organizations`,
      );
      if (Number(rows[0]!.count) > 0) {
        console.log("↷ Database already contains an organisation — skipping seed.");
        return;
      }
    }

    await client.query("BEGIN");
    const counts = await seed(client);
    await client.query("COMMIT");

    const owner = EMPLOYEES.find((employee) => employee.role === "OWNER");

    console.log("\n✔ Seed complete.\n");
    console.log(`   Organisation : ${ORGANIZATION.name}`);
    console.log(`   Offices      : ${OFFICES.length}`);
    console.log(`   Departments  : ${DEPARTMENTS.length}`);
    console.log(`   Teams        : ${TEAMS.length}`);
    console.log(`   Employees    : ${EMPLOYEES.length}`);
    console.log(`   Tasks        : ${TASKS.length}`);
    console.log(`   Attendance   : ${counts.attendance} records, ${counts.events} events\n`);
    if (owner) {
      console.log(`   Default dev sign-in : ${emailFor(owner)}`);
      console.log(`   (set DEV_AUTH_DEFAULT_USER to any seeded email, or use the`);
      console.log(`    flask icon in the top bar to switch between roles)\n`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("\n✖ Seed failed:\n", error);
  process.exitCode = 1;
});
