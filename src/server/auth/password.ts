import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing — Argon2id.
 *
 * ─── Why Argon2id, and why this package ─────────────────────────────────────
 * Argon2id is the current recommendation: memory-hard, so an attacker with
 * GPUs gains far less than they would against bcrypt. `@node-rs/argon2` ships
 * prebuilt binaries for every platform this deploys to, so `npm ci` on Render
 * stays a download rather than becoming a compile step. No bcrypt fallback is
 * needed — the documented escape hatch in the brief does not apply.
 *
 * ─── Parameters ─────────────────────────────────────────────────────────────
 * OWASP's minimum for Argon2id: 19 MiB, two iterations, one lane. Roughly
 * 40-60 ms on a small Render instance — slow enough to make offline guessing
 * expensive, fast enough that a sign-in does not feel stalled. They are stated
 * here rather than left to the library's defaults so that a future upgrade of
 * the dependency cannot silently weaken every new hash.
 *
 * The parameters are also embedded in the PHC string each hash produces, so
 * raising them later does not invalidate existing passwords: an old hash stays
 * verifiable with the parameters it was made under, and `needsRehash` reports
 * that it should be upgraded next time the plaintext is briefly available.
 */

/**
 * The numeric literals are `Algorithm.Argon2id` and `Version.V0x13`. They are
 * written out because the library declares them as ambient `const enum`s,
 * which `isolatedModules` — required by Next's SWC pipeline — cannot read at
 * runtime. The values are fixed by the Argon2 specification, not by the
 * library, so writing them here is safe; `assertParams` below fails loudly if
 * that ever stops being true.
 */
const PARAMS = {
  /** Algorithm.Argon2id */
  algorithm: 2,
  /** Version.V0x13 — Argon2 v1.3, the current version. */
  version: 1,
  /** KiB. */
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Password policy.
 *
 * Length is the only rule. Composition requirements ("one uppercase, one
 * symbol") measurably push people towards `Password1!` and a sticky note,
 * which is worse than a long passphrase; NIST dropped them for that reason.
 * The maximum exists to bound the work an unauthenticated caller can ask the
 * server to do, not because longer passwords are unsafe.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** Hash a plaintext password for storage. Never log or return the input. */
export async function hashPassword(plaintext: string): Promise<string> {
  const digest = await hash(normalise(plaintext), PARAMS);
  assertArgon2id(digest);
  return digest;
}

/**
 * Confirm the library actually produced Argon2id at the version we asked for.
 *
 * The algorithm and version above are numeric literals standing in for the
 * library's ambient const enums, so a future release that renumbered them
 * would silently start writing a different algorithm. This turns that into a
 * loud failure on the first hash instead of a quiet weakening of every
 * password. Checked once — the answer cannot vary within a process.
 */
let paramsVerified = false;
function assertArgon2id(digest: string): void {
  if (paramsVerified) return;

  if (!digest.startsWith("$argon2id$v=19$")) {
    throw new Error(
      `Password hashing produced "${digest.slice(0, 20)}…" rather than Argon2id v1.3. ` +
        "Check the algorithm/version constants in src/server/auth/password.ts against @node-rs/argon2.",
    );
  }

  paramsVerified = true;
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or foreign hash: a corrupt
 * row must deny access, not surface an error that distinguishes it from a
 * merely wrong password.
 */
export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, normalise(plaintext), PARAMS);
  } catch {
    return false;
  }
}

/**
 * The cost of a verification, paid when no account matched.
 *
 * Without it, "no such user" returns in under a millisecond while a real
 * account takes fifty, and the difference enumerates your users. The sign-in
 * path calls this on every miss so both answers cost about the same.
 */
export async function equaliseTiming(): Promise<void> {
  await verifyPassword("timing-equalisation", await decoyHash());
}

/** True when `stored` was produced with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parsed = parseParams(stored);
  if (!parsed) return true;

  return (
    parsed.m < PARAMS.memoryCost || parsed.t < PARAMS.timeCost || parsed.p < PARAMS.parallelism
  );
}

/**
 * Unicode normalisation before hashing.
 *
 * The same characters typed on two keyboards can arrive as different byte
 * sequences — an accented letter as one code point or as two. Without this, a
 * password set on a Mac can fail to verify when typed on Windows.
 */
function normalise(plaintext: string): string {
  return plaintext.normalize("NFKC");
}

/**
 * A real hash to verify against on the miss path, computed once.
 *
 * Hashing a throwaway string would also burn time, but it is the *verify* cost
 * we need to match, and the two are not identical.
 */
let decoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  decoy ??= hashPassword("argon2id-timing-decoy-not-a-credential");
  return decoy;
}

/** Pull m/t/p out of a PHC string: $argon2id$v=19$m=19456,t=2,p=1$salt$hash */
function parseParams(stored: string): { m: number; t: number; p: number } | null {
  const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  if (!match) return null;

  return { m: Number(match[1]), t: Number(match[2]), p: Number(match[3]) };
}
