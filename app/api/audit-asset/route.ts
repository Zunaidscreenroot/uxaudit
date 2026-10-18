import { getAuditScreenshotObject } from "@/lib/audit-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!key || key.length > 200) {
    return Response.json({ error: "A valid screenshot key is required." }, { status: 400 });
  }

  try {
    const object = await getAuditScreenshotObject(key);
    if (!object) {
      return Response.json({ error: "Screenshot not found." }, { status: 404 });
    }

    const headers = new Headers({
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    console.error("[uxaudit] screenshot_asset_read_failed", error);
    return Response.json({ error: "Screenshot storage is temporarily unavailable." }, { status: 503 });
  }
}
