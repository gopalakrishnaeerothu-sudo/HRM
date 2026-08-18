import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing.
 *
 * Deliberately without the `server-only` marker that the rest of this folder
 * carries: the seed script needs to hash passwords too, and it runs under tsx
 * rather than in a React Server Component, where importing `server-only`
 * throws. Nothing here is sensitive on its own — it holds no secrets and
 * reaches no database — and `node:crypto` cannot be bundled for the browser,
 * so a client import fails loudly at build time anyway.
 *
 * ─── Why scrypt ─────────────────────────────────────────────────────────────
 * It ships in Node's standard library. bcrypt and argon2 are both fine choices
 * and argon2id is the better one on paper, but every JavaScript implementation
 * of them is either a native module — which turns a clean `npm ci` into a
 * compile step on every platform this deploys to — or a WASM build an order of
 * magnitude slower. scrypt is memory-hard, well understood, and already here.
 *
 * ─── Format ─────────────────────────────────────────────────────────────────
 *     scrypt$<N>$<r>$<p>$<salt base64>$<derived key base64>
 *
 * The parameters travel with the hash rather than living in a constant, so
 * raising the cost later does not invalidate existing passwords: an old hash
 * is still verifiable with the parameters it was made under, and
 * `needsRehash` reports that it should be upgraded on next sign-in.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Cost parameters for newly created hashes.
 *
 * N=2^15 with r=8 costs roughly 32 MB and ~100 ms per hash on a small cloud
 * instance. That is deliberately slow: sign-in happens once per session, while
 * an attacker with a stolen database must pay it per guess.
 */
const PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Node refuses to allocate past this, and the default (32 MB) is under what N=2^15 needs. */
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2;

/** Hash a plaintext password for storage. Never log or return the input. */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(plaintext.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAXMEM,
  });

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row must
 * deny access, not crash the sign-in route and leak that the account exists.
 */
export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  try {
    const derived = await scrypt(plaintext.normalize("NFKC"), parsed.salt, parsed.key.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: Math.max(MAXMEM, 128 * parsed.N * parsed.r * 2),
    });

    // Constant-time: a byte-by-byte comparison that returns early leaks how
    // much of the hash matched, which is enough to reconstruct it.
    return derived.length === parsed.key.length && timingSafeEqual(derived, parsed.key);
  } catch {
    return false;
  }
}

/** True when `stored` was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return parsed.N < PARAMS.N || parsed.r < PARAMS.r || parsed.p < PARAMS.p;
}

/**
 * Cost of verifying a password, paid when no account matched.
 *
 * Without this, "no such user" returns in a millisecond while a real account
 * takes a hundred, and the difference enumerates your users. Sign-in calls
 * this on the miss path so both answers cost about the same.
 */
export async function equaliseTiming(): Promise<void> {
  await hashPassword(randomBytes(16).toString("hex"));
}

function parse(
  stored: string,
): { N: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  // Guard the cost parameters before handing them to scrypt: a tampered row
  // claiming N=2^30 would otherwise turn one sign-in into a denial of service.
  if (!Number.isInteger(N) || N < 1024 || N > 1 << 20) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16) return null;

  try {
    return { N, r, p, salt: Buffer.from(rawSalt, "base64"), key: Buffer.from(rawKey, "base64") };
  } catch {
    return null;
  }
}
