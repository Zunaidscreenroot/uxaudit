import { createHash } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { queryDb } from "@/lib/db";

export const SHARED_R2_BUCKET = "ux-shared-memory";

const recentAssetRefs = new Map<string, string>();
const MAX_RECENT_ASSET_REFS = 256;

type R2ObjectBodyLike = { text(): Promise<string> };
type R2BucketLike = {
  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
};

function sharedBucket(): R2BucketLike {
  const context = getCloudflareContext();
  const binding = (context.env as unknown as Record<string, unknown>).UX_SHARED_ASSETS;
  if (!binding || typeof binding !== "object" || typeof (binding as R2BucketLike).put !== "function") {
    throw new Error("The UX_SHARED_ASSETS R2 binding is not configured.");
  }
  return binding as R2BucketLike;
}

function isImageDataUri(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value);
}

export function isR2Reference(value: string): boolean {
  return /^r2:\/\/[^/]+\//i.test(value);
}

export async function storeImageDataUri(dataUri: string, options: { sourceScope?: string; referenceCount?: number } = {}): Promise<string> {
  if (isR2Reference(dataUri)) return normalizeR2Reference(dataUri);
  if (!isImageDataUri(dataUri)) return dataUri;

  const hash = createHash("md5").update(dataUri, "utf8").digest("hex");
  const cachedRef = recentAssetRefs.get(hash);
  if (cachedRef) return cachedRef;

  const objectKey = `ux-audit/screenshots/${hash}.datauri`;
  const assetKey = `r2://${SHARED_R2_BUCKET}/${objectKey}`;
  const sizeBytes = Buffer.byteLength(dataUri, "utf8");
  const references = Math.max(1, Math.floor(options.referenceCount ?? 1));

  // The object is deliberately stored as the exact original data-URI text.
  // This keeps existing rendering/evidence semantics unchanged while moving the bytes out of PostgreSQL.
  await sharedBucket().put(objectKey, dataUri, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });

  const stored = await queryDb<{ asset_key: string }>(
    `INSERT INTO public.ux_storage_assets
      (asset_key, bucket_name, object_key, content_hash, content_type, content_encoding, size_bytes, reference_count, source_scope)
     VALUES ($1, $2, $3, $4, $5, 'data-uri', $6, $7, $8)
     ON CONFLICT (content_hash) DO UPDATE SET
       asset_key = EXCLUDED.asset_key,
       bucket_name = EXCLUDED.bucket_name,
       object_key = EXCLUDED.object_key,
       content_type = EXCLUDED.content_type,
       content_encoding = EXCLUDED.content_encoding,
       size_bytes = EXCLUDED.size_bytes,
       reference_count = public.ux_storage_assets.reference_count + EXCLUDED.reference_count
     RETURNING asset_key`,
    [
      assetKey,
      SHARED_R2_BUCKET,
      objectKey,
      hash,
      "text/plain; charset=utf-8",
      sizeBytes,
      references,
      options.sourceScope || "ux-audit",
    ],
  );
  const savedRef = stored[0]?.asset_key || assetKey;
  recentAssetRefs.set(hash, savedRef);
  if (recentAssetRefs.size > MAX_RECENT_ASSET_REFS) {
    const oldest = recentAssetRefs.keys().next().value;
    if (oldest) recentAssetRefs.delete(oldest);
  }
  return savedRef;
}

export function normalizeR2Reference(reference: string): string {
  // Historical references were migrated in Neon; keep this rewrite as a defensive
  // compatibility path for an older IA session restored from a saved payload.
  return reference.replace(/^r2:\/\/ux-direct-assets\//i, `r2://${SHARED_R2_BUCKET}/`);
}

export async function readImageDataUri(reference: string): Promise<string> {
  if (!isR2Reference(reference)) return reference;
  const normalized = normalizeR2Reference(reference);
  const match = normalized.match(/^r2:\/\/([^/]+)\/(.+)$/);
  if (!match || match[1] !== SHARED_R2_BUCKET) {
    throw new Error("The screenshot reference does not point to the shared R2 bucket.");
  }
  const object = await sharedBucket().get(match[2]);
  if (!object) throw new Error("The referenced screenshot is missing from shared R2 storage.");
  return await object.text();
}

/** Move inline screenshot data URIs out of JSON payloads before persisting IA sessions. */
export async function externalizeImageDataUris<T>(value: T, sourceScope = "ux-audit"): Promise<T> {
  if (typeof value === "string") {
    return (isImageDataUri(value) ? await storeImageDataUri(value, { sourceScope }) : isR2Reference(value) ? normalizeR2Reference(value) : value) as T;
  }
  if (Array.isArray(value)) {
    return await Promise.all(value.map((item) => externalizeImageDataUris(item, sourceScope))) as T;
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [
      key,
      await externalizeImageDataUris(item, sourceScope),
    ] as const));
    return Object.fromEntries(entries) as T;
  }
  return value;
}

/** Restore R2 references only when returning saved audit/session payloads to the UI. */
export async function hydrateImageDataUris<T>(value: T): Promise<T> {
  if (typeof value === "string") return (isR2Reference(value) ? await readImageDataUri(value) : value) as T;
  if (Array.isArray(value)) return await Promise.all(value.map((item) => hydrateImageDataUris(item))) as T;
  if (value && typeof value === "object") {
    const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [
      key,
      await hydrateImageDataUris(item),
    ] as const));
    return Object.fromEntries(entries) as T;
  }
  return value;
}
