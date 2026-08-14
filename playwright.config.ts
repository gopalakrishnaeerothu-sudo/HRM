import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * End-to-end tests.
 *
 * Assumes a seeded database and the dev-auth adapter enabled, which together
 * are what let a test land on a signed-in workspace without a login form that
 * does not exist yet.
 *
 * Run with:
 *   npm run db:seed
 *   npm run test:e2e
 *
 * Both a desktop and a mobile project run, because the responsive behaviour —
 * bottom tab bar, drawer navigation, bottom-sheet dialogs — is real behaviour
 * worth testing rather than a CSS detail.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Geolocation is granted so the check-in flow can be driven; each test
    // sets its own coordinates via context.setGeolocation.
    permissions: ["geolocation"],
    locale: "en-GB",
    timezoneId: "Asia/Kolkata",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
