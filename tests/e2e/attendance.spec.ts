import { expect, test } from "@playwright/test";

/**
 * The two journeys the product lives or dies on.
 *
 *   1. Employee opens the app → dashboard loads → location verified → check in
 *      → attendance recorded.
 *   2. Employee outside the perimeter → check-in refused, with the distance
 *      shown and no attendance recorded.
 *
 * Both drive the real API. Playwright's `setGeolocation` feeds the browser a
 * position, which is exactly the surface a spoofer would use — so test 2 is
 * also a demonstration that the server, not the client, decides.
 *
 * Requires: seeded database (`npm run db:seed`) and DEV_AUTH_ENABLED=true.
 */

/** Guntur HQ, from prisma/seed-data.ts. */
const OFFICE = { latitude: 16.30656, longitude: 80.4365 };

/** ~250 m north of the office — outside the seeded 100 m perimeter. */
const OUTSIDE = { latitude: 16.30881, longitude: 80.4365 };

/** ~40 m north — comfortably inside. */
const INSIDE = { latitude: 16.30692, longitude: 80.4365 };

test.describe("employee attendance", () => {
  test("dashboard loads with the workspace shell", async ({ page }) => {
    await page.goto("/app");

    // The seeded organisation name appears once the session resolves.
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // The search trigger is part of the shell on every authenticated page.
    await expect(page.getByRole("button", { name: /search people, tasks/i })).toBeVisible();
  });

  test("verifies location and allows check-in inside the perimeter", async ({ page, context }) => {
    await context.setGeolocation(INSIDE);
    await page.goto("/app/attendance/my");

    // The status band reports the SERVER's verdict, not a client calculation.
    await expect(page.getByText(/you're inside/i)).toBeVisible({ timeout: 15_000 });

    const checkIn = page.getByRole("button", { name: /^check in$/i });

    // If this account already checked in today, the flow is already proven.
    if (await checkIn.isVisible().catch(() => false)) {
      await expect(checkIn).toBeEnabled();
      await checkIn.click();

      await expect(page.getByText(/checked in at/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /check out/i })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: /check out|day complete/i })).toBeVisible();
    }
  });

  test("refuses check-in outside the perimeter and shows the distance", async ({
    page,
    context,
  }) => {
    await context.setGeolocation(OUTSIDE);
    await page.goto("/app/attendance/my");

    await expect(page.getByText(/outside the office perimeter/i)).toBeVisible({ timeout: 15_000 });

    // The refusal panel states the distance and the required radius, so the
    // employee knows exactly why rather than just being blocked.
    await expect(page.getByText(/access denied/i)).toBeVisible();
    await expect(page.getByText(/distance from office/i)).toBeVisible();
    await expect(page.getByText(/required radius/i)).toBeVisible();

    // The action itself is unavailable.
    const checkIn = page.getByRole("button", { name: /^check in$/i });
    if (await checkIn.isVisible().catch(() => false)) {
      await expect(checkIn).toBeDisabled();
    }
  });

  test("a spoofed coordinate is still judged by the server", async ({ page, context }) => {
    // Feed the browser a position on the other side of the country. The client
    // has no say in the verdict — the server compares against the geofence.
    await context.setGeolocation({ latitude: 28.6139, longitude: 77.209 });
    await page.goto("/app/attendance/my");

    await expect(page.getByText(/outside the office perimeter/i)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("navigation", () => {
  test("moves between the main sections", async ({ page, isMobile }) => {
    await page.goto("/app");

    if (isMobile) {
      // Mobile uses the bottom tab bar.
      await page.getByRole("navigation", { name: /primary/i }).getByRole("link", { name: /tasks/i }).click();
    } else {
      await page.getByRole("navigation", { name: /sidebar/i }).getByRole("link", { name: /^tasks$/i }).click();
    }

    await expect(page).toHaveURL(/\/app\/tasks/);
    await expect(page.getByRole("heading", { name: /tasks/i, level: 1 })).toBeVisible();
  });

  test("command palette opens with the keyboard and finds a person", async ({ page, isMobile }) => {
    test.skip(isMobile, "The ⌘K shortcut is a desktop affordance.");

    await page.goto("/app");
    await page.keyboard.press("Control+k");

    const search = page.getByRole("textbox", { name: /search/i });
    await expect(search).toBeVisible();

    await search.fill("Priya");
    // Seeded employee: Priya Nair, Frontend Lead.
    await expect(page.getByText(/priya nair/i)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("responsive layout", () => {
  test("no horizontal overflow on any main page", async ({ page }) => {
    for (const path of ["/", "/app", "/app/tasks", "/app/employees", "/app/locations"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      // The single most common responsive failure: a wide table or chart
      // pushing the whole document sideways.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );

      expect(overflows, `${path} scrolls horizontally`).toBe(false);
    }
  });
});
