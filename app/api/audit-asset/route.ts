import { getAuditScreenshotObject } from "@/lib/audit-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_URI_PATTERN = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const bucket = url.searchParams.get("bucket") || undefined;
  if (!key || key.length > 200) {
    return Response.json({ error: "A valid screenshot key is required." }, { status: 400 });
  }

  try {
    const object = await getAuditScreenshotObject(key, bucket);
    if (!object) {
      return Response.json({ error: "Screenshot not found." }, { status: 404 });
    }

    // Stored screenshots use textual data URIs. Convert the payload to a
    // binary image response so <img> elements can render the asset directly.
    const payload = await new Response(object.body).text();
    if (payload.length > MAX_SCREENSHOT_BYTES * 1.5) {
      return Response.json({ error: "Screenshot exceeds the storage limit." }, { status: 413 });
    }
    const match = DATA_URI_PATTERN.exec(payload);
    if (!match) {
      return Response.json({ error: "Stored screenshot is invalid." }, { status: 422 });
    }
    const binary = atob(match[2].replace(/\s/g, ""));
    if (!binary.length || binary.length > MAX_SCREENSHOT_BYTES) {
      return Response.json({ error: "Screenshot exceeds the storage limit." }, { status: 413 });
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
    const headers = new Headers({
      "Content-Type": mimeType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    return new Response(bytes, { status: 200, headers });
  } catch (error) {
    console.error("[uxaudit] screenshot_asset_read_failed", error);
    return Response.json({ error: "Screenshot storage is temporarily unavailable." }, { status: 503 });
  }
}
