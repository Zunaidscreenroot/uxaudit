import { getRuntimeEnv, getSql, type R2BucketLike } from "@/lib/neon-db";

const ASSET_PREFIX = "ux-audit/screenshots/";
const BUCKET_NAME = "ux-direct-assets";
const DATA_URI_PATTERN = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i;

function getBucket(): R2BucketLike | undefined {
  return getRuntimeEnv().UX_SHARED_ASSETS;
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Store screenshot data using the existing shared asset registry convention:
 * r2://ux-direct-assets/ux-audit/screenshots/<sha256>.datauri
 */
export async function storeAuditScreenshot(screenshot: string): Promise<string> {
  const bucket = getBucket();
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
  const assetKey = "r2://" + BUCKET_NAME + "/" + objectKey;

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
      ${assetKey}, ${BUCKET_NAME}, ${objectKey}, ${contentHash},
      'text/plain; charset=utf-8', 'data-uri', ${utf8.byteLength}, 2, 'ux-audit'
    )
    ON CONFLICT (content_hash) DO UPDATE
    SET reference_count = ux_storage_assets.reference_count + 2
  `;

  return assetKey;
}

export function resolveAuditScreenshot(value: unknown): unknown {
  if (typeof value !== "string" || !value.startsWith("r2://")) return value;
  const prefix = "r2://" + BUCKET_NAME + "/";
  if (!value.startsWith(prefix)) return null;
  const key = value.slice(prefix.length);
  if (!/^ux-audit\/screenshots\/[a-f0-9]{32,64}\.datauri$/i.test(key)) return null;
  return "/api/audit-asset?key=" + encodeURIComponent(key);
}

export async function getAuditScreenshotObject(key: string) {
  if (!/^ux-audit\/screenshots\/[a-f0-9]{32,64}\.datauri$/i.test(key)) return null;
  const bucket = getBucket();
  if (!bucket) throw new Error("The shared R2 assets binding is not configured on this Worker.");
  return bucket.get(key);
}
