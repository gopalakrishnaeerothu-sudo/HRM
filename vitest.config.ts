import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Unit and integration tests.
 *
 * Integration tests hit a real PostgreSQL database and skip themselves when
 * TEST_DATABASE_URL is unset (see tests/helpers/db.ts), so `npm test` is
 * always runnable on a fresh clone. E2E lives in tests/e2e under Playwright.
 *
 * The `@/` alias is declared here rather than via vite-tsconfig-paths: this
 * config is loaded as CommonJS (the package has no "type": "module"), and that
 * plugin is ESM-only.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws when imported outside a React Server Component.
      // Under Vitest there is no RSC boundary to enforce, so it is stubbed —
      // the guard still does its job in the Next build, which is where it
      // matters.
      "server-only": path.resolve(__dirname, "./tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    globals: false,
    testTimeout: 20_000,
    // Repoints DATABASE_URL at the test database before @/lib/db is imported.
    setupFiles: ["./tests/helpers/setup-env.ts"],
    /**
     * Test files run one at a time.
     *
     * The integration suites each truncate the whole database in their setup,
     * so running two of them concurrently means one wipes the other's fixtures
     * mid-run. Sharing a database is the point — these tests exist to verify
     * constraints PostgreSQL enforces — so the fix is to serialise rather than
     * to isolate per file. The unit suite is ~100 ms, so this costs nothing.
     */
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/lib/**"],
      exclude: ["src/lib/db.ts", "src/lib/env.ts"],
    },
  },
});
