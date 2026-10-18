import { Buffer } from "node:buffer";
import { getRuntimeEnv, type R2BucketLike } from "@/lib/neon-db";

const ASSET_PREFIX = "uxaudit/audits/";

function getBucket(): R2BucketLike | undefined {
  return getRuntimeEnv().UX_SHARED_ASSETS;
}

/**
 * Stores supported screenshot data URIs in the shared R2 bucket and returns
 * a compact database reference. Local development falls back to the data URI.
 */
export async function storeAuditScreenshot(screenshot: string, auditId: string): Promise<string> {
  const bucket = getBucket();
  if (!bucket) return screenshot;

  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(screenshot);
  if (!match) return screenshot;

  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
    throw new Error("Screenshot is empty or exceeds the 15 MB storage limit.");
  }

  const key = ASSET_PREFIX + auditId + "/screenshot";
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: mimeType,
      cacheControl: "private, max-age=300",
    },
    customMetadata: {
      app: "uxaudit",
      assetType: "audit-screenshot",
      auditId,
    },
  });
  return "r2://" + key;
}

export function resolveAuditScreenshot(value: unknown): unknown {
  if (typeof value !== "string" || !value.startsWith("r2://")) return value;
  const key = value.slice("r2://".length);
  if (!key.startsWith(ASSET_PREFIX)) return null;
  return "/api/audit-asset?key=" + encodeURIComponent(key);
}

export async function getAuditScreenshotObject(key: string) {
  if (!key.startsWith(ASSET_PREFIX) || !/^uxaudit\/audits\/[0-9a-f-]{36}\/screenshot$/i.test(key)) {
    return null;
  }
  const bucket = getBucket();
  if (!bucket) throw new Error("The shared R2 assets binding is not configured on this Worker.");
  return bucket.get(key);
}
