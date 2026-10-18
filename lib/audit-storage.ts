import { getRuntimeEnv, getSql, type R2BucketLike } from "@/lib/neon-db";

const ASSET_PREFIX = "ux-audit/screenshots/";
const DEFAULT_SHARED_BUCKET_NAME = "ux-shared-memory";
const LEGACY_BUCKET_NAME = "ux-direct-assets";
const DATA_URI_PATTERN = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i;
const SCREENSHOT_KEY_PATTERN = /^ux-audit\/screenshots\/[a-f0-9]{32,64}\.datauri$/i;

function getActiveBucketName(): string {
  const configured = getRuntimeEnv().UX_SHARED_ASSETS_BUCKET;
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : DEFAULT_SHARED_BUCKET_NAME;
}

function getBucketForName(bucketName: string): R2BucketLike | undefined {
  const env = getRuntimeEnv();
  if (bucketName === getActiveBucketName()) return env.UX_SHARED_ASSETS;
  if (bucketName === LEGACY_BUCKET_NAME) return env.UX_AUDIT_LEGACY_ASSETS;
  return undefined;
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * New screenshots go to the shared-memory bucket used by UX Direct.
 * Existing r2://ux-direct-assets/... references continue to resolve through the
 * dedicated legacy binding while old objects remain in that bucket.
 */
export async function storeAuditScreenshot(screenshot: string): Promise<string> {
  const bucketName = getActiveBucketName();
  const bucket = getBucketForName(bucketName);
  if (!bucket) return screenshot;

  const match = DATA_URI_PATTERN.exec(screenshot);
  if (!match) return screenshot;

  const normalizedMime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const utf8 = new TextEncoder().encode(screenshot);
  const imageBytes = Uint8Array.from(atob(match[2].replace(/\s/g, "")), (char) => char.charCodeAt(0));
  if (!imageBytes.length || imageBytes.length > 15 * 1024 * 1024) {
    throw new Error("Screenshot is empty or exceeds the 15 MB storage limit.");
  }

  const contentHash = await sha256(utf8);
  const objectKey = ASSET_PREFIX + contentHash + ".datauri";
  const assetKey = "r2://" + bucketName + "/" + objectKey;

  if (!(await bucket.get(objectKey))) {
    await bucket.put(objectKey, screenshot, {
      httpMetadata: {
        contentType: "text/plain; charset=utf-8",
        cacheControl: "private, max-age=300",
      },
      customMetadata: {
        app: "ux-audit",
        assetType: "screenshot-data-uri",
        contentHash,
        imageMimeType: normalizedMime,
      },
    });
  }

  const sql = getSql();
  await sql`
    INSERT INTO ux_storage_assets (
      asset_key, bucket_name, object_key, content_hash, content_type,
      content_encoding, size_bytes, reference_count, source_scope
    )
    VALUES (
      ${assetKey}, ${bucketName}, ${objectKey}, ${contentHash},
      'text/plain; charset=utf-8', 'data-uri', ${utf8.byteLength}, 2, 'ux-audit'
    )
    ON CONFLICT (content_hash) DO UPDATE
    SET asset_key = EXCLUDED.asset_key,
        bucket_name = EXCLUDED.bucket_name,
        object_key = EXCLUDED.object_key,
        content_type = EXCLUDED.content_type,
        content_encoding = EXCLUDED.content_encoding,
        size_bytes = EXCLUDED.size_bytes,
        source_scope = EXCLUDED.source_scope,
        reference_count = ux_storage_assets.reference_count + 2
  `;

  return assetKey;
}

export function resolveAuditScreenshot(value: unknown): unknown {
  if (typeof value !== "string" || !value.startsWith("r2://")) return value;

  const match = /^r2:\/\/([a-z0-9-]+)\/(ux-audit\/screenshots\/[a-f0-9]{32,64}\.datauri)$/i.exec(value);
  if (!match) return null;

  const bucketName = match[1];
  if (bucketName !== getActiveBucketName() && bucketName !== LEGACY_BUCKET_NAME) return null;
  return "/api/audit-asset?bucket=" + encodeURIComponent(bucketName) + "&key=" + encodeURIComponent(match[2]);
}

export async function getAuditScreenshotObject(key: string, requestedBucketName?: string) {
  if (!SCREENSHOT_KEY_PATTERN.test(key)) return null;

  const bucketName = requestedBucketName || getActiveBucketName();
  if (bucketName !== getActiveBucketName() && bucketName !== LEGACY_BUCKET_NAME) return null;

  const bucket = getBucketForName(bucketName);
  if (!bucket) throw new Error("The requested R2 assets binding is not configured on this Worker.");
  return bucket.get(key);
}
