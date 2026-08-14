import "server-only";

import { serverEnv } from "@/lib/env";
import { errors } from "@/lib/errors";

/**
 * File storage abstraction.
 *
 * Files never go into PostgreSQL. `task_attachments` stores a `storageKey`
 * plus metadata; the bytes live in whatever this adapter points at. Putting
 * blobs in the database bloats backups, slows every restore, and makes the
 * connection pool carry traffic a CDN should.
 *
 * ─── Current state ──────────────────────────────────────────────────────────
 * No adapter is configured, so `resolveStorage()` returns an unconfigured
 * implementation whose methods throw a clear precondition error. Upload UI is
 * hidden when `isStorageConfigured()` is false. Nothing pretends to succeed.
 *
 * To enable, implement `StorageAdapter` against S3/R2/Blob and return it from
 * `resolveStorage()`. The presigned-URL shape is deliberate: bytes should go
 * browser → object store directly, never through this server.
 */

export interface StorageObject {
  /** Opaque key stored in `task_attachments.storageKey`. */
  key: string;
  size: number;
  contentType: string;
}

export interface PresignedUpload {
  /** URL the browser PUTs to. */
  url: string;
  /** Headers the browser must send with the PUT. */
  headers: Record<string, string>;
  key: string;
  expiresAt: Date;
}

export interface StorageAdapter {
  readonly name: string;
  /** Whether this adapter can actually store anything. */
  readonly configured: boolean;

  /** Issue a short-lived direct-upload URL. */
  createUploadUrl(input: {
    /** Namespacing prefix, e.g. `org/<id>/tasks/<id>`. */
    prefix: string;
    fileName: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedUpload>;

  /** Issue a short-lived read URL. Never return a permanent public link. */
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  delete(key: string): Promise<void>;
}

/**
 * The no-op adapter used when nothing is configured.
 *
 * Every method throws rather than returning a fake key, so an unconfigured
 * deployment surfaces a clear error instead of recording attachment rows that
 * point at bytes which do not exist.
 */
const unconfiguredStorage: StorageAdapter = {
  name: "unconfigured",
  configured: false,

  async createUploadUrl() {
    throw errors.precondition(
      "File storage is not configured for this deployment. Set STORAGE_URL and register a StorageAdapter.",
    );
  },
  async createDownloadUrl() {
    throw errors.precondition("File storage is not configured for this deployment.");
  },
  async delete() {
    throw errors.precondition("File storage is not configured for this deployment.");
  },
};

let cached: StorageAdapter | null = null;

export function resolveStorage(): StorageAdapter {
  if (cached) return cached;

  const storageUrl = serverEnv().STORAGE_URL;

  if (!storageUrl) {
    cached = unconfiguredStorage;
    return cached;
  }

  // An object-storage adapter belongs here. Deliberately not stubbed with a
  // fake implementation: a half-working uploader that silently drops files is
  // worse than an explicit "not configured".
  console.warn(
    "[storage] STORAGE_URL is set but no StorageAdapter is registered — uploads remain disabled. See src/server/providers/storage.ts.",
  );
  cached = unconfiguredStorage;
  return cached;
}

export function isStorageConfigured(): boolean {
  return resolveStorage().configured;
}

/** Test hook. */
export function __setStorageAdapter(adapter: StorageAdapter | null): void {
  cached = adapter;
}
