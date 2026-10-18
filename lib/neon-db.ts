import { neon } from "@neondatabase/serverless";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export type R2ObjectLike = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
  httpEtag?: string;
};

export type R2BucketLike = {
  put(
    key: string,
    value: Uint8Array | ArrayBuffer | string | ReadableStream<Uint8Array>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
};

export type RuntimeEnv = Record<string, unknown> & {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  OPENROUTER_API_KEY?: string;
  BROWSERLESS_API_TOKEN?: string;
  UX_SHARED_ASSETS?: R2BucketLike;
};

/**
 * Prefer actual Worker bindings/secrets. process.env remains a local-development
 * fallback, so ordinary local Next.js development can use .env.local.
 */
export function getRuntimeEnv(): RuntimeEnv {
  let workerEnv: Record<string, unknown> = {};
  try {
    workerEnv = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    // There is no Cloudflare request context during ordinary local Next.js dev.
  }

  return { ...process.env, ...workerEnv } as RuntimeEnv;
}

export function getSql() {
  const env = getRuntimeEnv();
  const connectionString = env.NEON_DATABASE_URL || env.DATABASE_URL;
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("Configure NEON_DATABASE_URL on the Cloudflare Worker to connect to the shared Neon database.");
  }
  return neon(connectionString);
}
