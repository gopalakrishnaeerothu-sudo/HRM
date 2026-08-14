import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * NOTE: deliberately *not* marked `server-only`, unlike the rest of
 * `src/server/`. This module is pure functions over strings — no cookies, no
 * database, no request context — and the seed and bootstrap scripts must be
 * able to import it so that they hash passwords with the exact same code the
 * login path verifies against. A second implementation for scripts is how
 * hashes end up subtly incompatible.
 *
 * It still never reaches the browser: nothing in `src/components` or
 * `src/app/**\/page.tsx` imports it, and its only callers are server modules.
 */

/**
 * Promise wrapper around `crypto.scrypt`.
 *
 * Hand-written rather than `promisify`, because promisify resolves to the
 * three-argument overload and loses the options parameter that carries the
 * cost factors.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing.
 *
 * ─── Why scrypt ─────────────────────────────────────────────────────────────
 * scrypt is memory-hard, is on OWASP's list of acceptable password KDFs, and
 * ships inside Node's standard library. That last part matters more than it
 * looks: argon2 and bcrypt both pull in a native module, which is one more
 * thing that can fail to compile on a Railway builder or a contributor's
 * laptop. No dependency is the simplest thing that is still correct.
 *
 * ─── Parameters ─────────────────────────────────────────────────────────────
 * N = 2^15, r = 8, p = 1 → 32 MiB and roughly 50–100 ms per hash.
 *
 * OWASP's floor is N = 2^17 (128 MiB). That is deliberately *not* used here:
 * memory cost is paid per concurrent login, so 128 MiB × a burst of sign-ins
 * is a denial-of-service vector on a small Railway instance. 32 MiB with a
 * hard rate limit on the login route (5 attempts / 15 min / account, plus
 * per-IP) is the trade this codebase makes. Raise `SCRYPT_N` if the deployment
 * has memory to spare — `verify` reads the parameters from each stored digest,
 * so old hashes keep working and `needsRehash` flags them for upgrade on the
 * user's next successful sign-in.
 *
 * ─── Format ─────────────────────────────────────────────────────────────────
 *     scrypt$N$r$p$<base64 salt>$<base64 hash>
 * Self-describing, so the cost can change without a migration.
 */

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** scrypt refuses to run unless maxmem exceeds roughly 128 * N * r. */
const maxmem = (n: number, r: number) => 256 * n * r;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);

  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmem(SCRYPT_N, SCRYPT_R),
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verification.
 *
 * Returns false for a malformed digest rather than throwing, so a corrupted
 * row cannot be told apart from a wrong password by the caller — or by anyone
 * watching response codes.
 */
export async function verifyPassword(password: string, digest: string): Promise<boolean> {
  const parts = digest.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse absurd parameters from a tampered row rather than allocating GiBs.
  if (n < 1024 || n > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let expected: Buffer;
  let salt: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: maxmem(n, r),
    });
  } catch {
    return false;
  }

  // Lengths are equal by construction, but timingSafeEqual throws if they are
  // not, so guard before comparing.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** True when a stored digest used weaker parameters than the current policy. */
export function needsRehash(digest: string): boolean {
  const parts = digest.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < SCRYPT_N || Number(parts[2]) < SCRYPT_R;
}

/**
 * Burn roughly the same CPU as a real verification.
 *
 * Called when the email does not exist, so that "no such account" and "wrong
 * password" take comparable time. Without it, response latency reveals which
 * addresses are registered.
 */
export async function fakeVerify(): Promise<void> {
  await scrypt("timing-equalisation", randomBytes(SALT_LENGTH), KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmem(SCRYPT_N, SCRYPT_R),
  });
}

/**
 * Password policy.
 *
 * Length first, because it dominates entropy, plus a small blocklist of the
 * passwords that actually show up in breach corpora. Deliberately no
 * composition rules ("one uppercase, one symbol") — NIST 800-63B advises
 * against them, since they push people towards `Password1!`.
 */
/**
 * Base words, not whole passwords.
 *
 * Matching whole strings would be useless here: the 12-character minimum
 * already rejects "password123", so a literal blocklist of short passwords can
 * never fire. What actually shows up in breach corpora is a common word padded
 * to length — `password123456`, `Welcome@2026`. So the candidate is reduced to
 * its letters before comparison, which catches the padding trick.
 */
const COMMON_BASE_WORDS = new Set([
  "password",
  "passwd",
  "qwerty",
  "qwertyuiop",
  "letmein",
  "welcome",
  "admin",
  "administrator",
  "changeme",
  "iloveyou",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "taskflow",
  "taskflowhr",
  "abcdefgh",
]);

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export function validatePasswordStrength(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    // Bounded so a huge input cannot be used to burn CPU.
    return `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }

  const lowered = password.toLowerCase();

  // Undo common leet substitutions, then drop everything that is not a letter.
  // "P@ssw0rd-2026" → "password"; "l3tm31n-98765" → "letmein".
  const reduced = lowered
    .replace(/[@4]/g, "a")
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "");

  // Substring rather than equality, so padding a common word does not evade
  // the check. Only words of six or more letters are matched this way —
  // shorter ones ("admin") would fire on innocent passphrases.
  for (const word of COMMON_BASE_WORDS) {
    const hit = word.length >= 6 ? reduced.includes(word) : reduced === word;
    if (hit) {
      return "That password is too common. Choose something less predictable.";
    }
  }
  if (/^(.)\1+$/.test(password)) {
    return "That password is a single repeated character.";
  }

  const localPart = context.email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lowered.includes(localPart)) {
    return "Don't include your email address in your password.";
  }
  if (context.name) {
    for (const part of context.name.toLowerCase().split(/\s+/)) {
      if (part.length >= 4 && lowered.includes(part)) {
        return "Don't include your name in your password.";
      }
    }
  }

  return null;
}
