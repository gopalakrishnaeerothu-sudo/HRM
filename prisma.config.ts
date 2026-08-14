import path from "node:path";

import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration. Replaces the deprecated `package.json#prisma` key.
 * Runtime connection details still come from DATABASE_URL (see src/lib/env.ts).
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
