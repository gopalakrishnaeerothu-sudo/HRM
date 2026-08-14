import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/server/auth/password";
import { sessionStore } from "@/server/auth/session-store";
import { disconnectTestDb, hasTestDatabase, resetDatabase, testDb } from "../helpers/db";

/**
 * Session lifecycle, against a real database.
 *
 * These cover the properties that make a session a security boundary rather
 * than a cookie: the raw token is never stored, expiry and idle timeout are
 * enforced server-side, revocation is immediate, and rotation kills the old
 * token (the session-fixation defence).
 */
describe.skipIf(!hasTestDatabase)("session store", () => {
  let organizationId: string;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    const db = testDb();

    const organization = await db.organization.create({
      data: { slug: "session-co", name: "Session Co" },
    });
    organizationId = organization.id;

    const user = await db.user.create({
      data: {
        organizationId,
        email: "user@session-co.example",
        name: "Session User",
        role: "EMPLOYEE",
        passwordHash: await hashPassword("a-perfectly-fine-passphrase"),
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await resetDatabase();
    await disconnectTestDb();
  });

  it("stores only a hash, never the raw token", async () => {
    const { token } = await sessionStore.create(userId, organizationId);

    const rows = await testDb().session.findMany({ select: { tokenHash: true } });

    expect(rows).toHaveLength(1);
    // The token itself must appear nowhere in the table.
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("issues unpredictable tokens", async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const { token } = await sessionStore.create(userId, organizationId);
      tokens.add(token);
      expect(token.length).toBeGreaterThanOrEqual(40);
    }
    expect(tokens.size).toBe(20);
  });

  it("resolves a valid token to its identity", async () => {
    const { token } = await sessionStore.create(userId, organizationId);
    const resolved = await sessionStore.resolve(token);

    expect(resolved).not.toBeNull();
    expect(resolved?.userId).toBe(userId);
    expect(resolved?.organizationId).toBe(organizationId);
  });

  it.each([
    ["a forged token", "forged-token-that-was-never-issued-000000"],
    ["an empty token", ""],
    ["a short token", "abc"],
  ])("refuses %s", async (_label, token) => {
    expect(await sessionStore.resolve(token)).toBeNull();
  });

  it("refuses a revoked session immediately", async () => {
    const { token } = await sessionStore.create(userId, organizationId);
    expect(await sessionStore.resolve(token)).not.toBeNull();

    await sessionStore.revoke(token);

    expect(await sessionStore.resolve(token)).toBeNull();
  });

  it("refuses a session past its absolute expiry", async () => {
    const { token } = await sessionStore.create(userId, organizationId);

    await testDb().session.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await sessionStore.resolve(token)).toBeNull();
  });

  it("refuses — and revokes — a session that has been idle too long", async () => {
    const { token } = await sessionStore.create(userId, organizationId);

    // 13 hours idle, past the 12-hour window.
    await testDb().session.updateMany({
      where: { userId },
      data: { lastUsedAt: new Date(Date.now() - 13 * 60 * 60 * 1000) },
    });

    expect(await sessionStore.resolve(token)).toBeNull();

    // Revoked, not merely rejected — so it cannot be revived.
    const row = await testDb().session.findFirst({ where: { userId } });
    expect(row?.revokedAt).not.toBeNull();
  });

  it("rotation invalidates the previous token", async () => {
    const first = await sessionStore.create(userId, organizationId);
    expect(await sessionStore.resolve(first.token)).not.toBeNull();

    const second = await sessionStore.rotate(first.token, userId, organizationId);

    // This is the session-fixation defence: a token planted before sign-in is
    // dead afterwards.
    expect(await sessionStore.resolve(first.token)).toBeNull();
    expect(await sessionStore.resolve(second.token)).not.toBeNull();
    expect(second.token).not.toBe(first.token);
  });

  it("records which session replaced a rotated one", async () => {
    const first = await sessionStore.create(userId, organizationId);
    await sessionStore.rotate(first.token, userId, organizationId);

    const old = await testDb().session.findFirst({
      where: { revokedAt: { not: null } },
      select: { rotatedToId: true },
    });
    expect(old?.rotatedToId).not.toBeNull();
  });

  it("revokes every session for a user at once", async () => {
    const a = await sessionStore.create(userId, organizationId);
    const b = await sessionStore.create(userId, organizationId);
    const c = await sessionStore.create(userId, organizationId);

    const count = await sessionStore.revokeAllForUser(userId);
    expect(count).toBe(3);

    for (const session of [a, b, c]) {
      expect(await sessionStore.resolve(session.token)).toBeNull();
    }
  });

  it("does not touch another user's sessions", async () => {
    const other = await testDb().user.create({
      data: {
        organizationId,
        email: "other@session-co.example",
        name: "Other User",
        role: "EMPLOYEE",
      },
    });

    const mine = await sessionStore.create(userId, organizationId);
    const theirs = await sessionStore.create(other.id, organizationId);

    await sessionStore.revokeAllForUser(userId);

    expect(await sessionStore.resolve(mine.token)).toBeNull();
    expect(await sessionStore.resolve(theirs.token)).not.toBeNull();
  });

  it("prunes only long-expired rows", async () => {
    const live = await sessionStore.create(userId, organizationId);
    await sessionStore.create(userId, organizationId);

    // One expired two days ago.
    const rows = await testDb().session.findMany({ select: { id: true } });
    await testDb().session.update({
      where: { id: rows[1]!.id },
      data: { expiresAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });

    const pruned = await sessionStore.pruneExpired();

    expect(pruned).toBe(1);
    expect(await sessionStore.resolve(live.token)).not.toBeNull();
  });
});
