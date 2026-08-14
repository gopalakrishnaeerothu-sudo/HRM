/** Quick row-count probe for a database. Usage: node scripts/db-counts.mjs [url] */
import { PrismaClient } from "@prisma/client";

const url = process.argv[2] ?? process.env.DATABASE_URL;
const db = new PrismaClient({ datasources: { db: { url } } });

try {
  const [organizations, users, employees, attendanceRecords, attendanceEvents, tasks] =
    await Promise.all([
      db.organization.count(),
      db.user.count(),
      db.employee.count(),
      db.attendanceRecord.count(),
      db.attendanceEvent.count(),
      db.task.count(),
    ]);
  console.log({ organizations, users, employees, attendanceRecords, attendanceEvents, tasks });
} catch (error) {
  console.log("ERROR:", String(error.message).split("\n").slice(0, 3).join(" | "));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
