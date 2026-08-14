import { PrismaClient } from "@prisma/client";

import { isProduction } from "@/lib/env";

/**
 * Single Prisma client for the process.
 *
 * Next's dev server re-evaluates modules on every hot reload, which would open
 * a new pool each time and exhaust Postgres connections; stashing the client on
 * `globalThis` keeps exactly one alive. In production the module is evaluated
 * once, so the global is not used.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ["error"] : ["error", "warn"],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Transaction client type — what a repository receives inside `$transaction`. */
export type PrismaTransaction = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Either the root client or a transaction client. Repositories accept both. */
export type DbClient = PrismaClient | PrismaTransaction;
