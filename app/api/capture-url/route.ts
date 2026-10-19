import { inspectImage } from "@/lib/image-utils";
import { privateHost, resolvesToPrivateAddress } from "@/lib/public-url";
import { captureWebsiteScreenshot } from "@/lib/capture-screenshot";

export const runtime = "nodejs";
export const maxDuration = 60;

type AuditMode = "desktop" | "mobile";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let url: URL;
    try { url = new URL(body?.url); }
    catch { return Response.json({ error: "A valid selected page URL is required." }, { status: 400 }); }

    if (!["http:", "https:"].includes(url.protocol) || privateHost(url.hostname)) {
      return Response.json({ error: "Only public HTTP/HTTPS pages can be captured." }, { status: 400 });
    }
    if (await resolvesToPrivateAddress(url.hostname)) {
      return Response.json({ error: "The selected hostname did not resolve to a verified public address." }, { status: 400 });
    }
    if (body?.root) {
      try {
        if (new URL(body.root).origin !== url.origin) {
          return Response.json({ error: "Selected URL must belong to the discovered site." }, { status: 400 });
        }
      } catch {
        return Response.json({ error: "The discovered website root is invalid." }, { status: 400 });
      }
    }


    const auditMode: AuditMode = body?.auditMode === "mobile" ? "mobile" : "desktop";
    const mobile = auditMode === "mobile";
    const viewport = mobile ? { width: 393, height: 852 } : { width: 1440, height: 900 };
    const started = Date.now();
    console.info("[uxaudit] screenshot_capture_start", JSON.stringify({
      provider: "thum.io→browserless fallback", host: url.hostname, auditMode, viewport, fullPage: true
    }));

    const captured = await captureWebsiteScreenshot({ url: url.href, width: viewport.width, height: viewport.height });
    const raw = captured.bytes;
    console.info("[uxaudit] screenshot_provider_selected", JSON.stringify({ provider: captured.provider, host: url.hostname, elapsedMs: Date.now() - started }));
    if (!raw.length || raw.length > 15 * 1024 * 1024) {
      throw new Error("The screenshot is empty or exceeds the 15 MB analysis limit.");
    }

    const image = inspectImage(raw);
    if (!image.width || !image.height || image.width > 20000 || image.height > 20000) throw new Error("The screenshot dimensions are invalid or too large.");
    const bytes = raw;
    const screenshot = "data:" + image.mimeType + ";base64," + bytes.toString("base64");
    const title = url.pathname === "/" ? "Homepage" : (url.pathname.split("/").filter(Boolean).pop() || url.hostname).replace(/[-_]/g, " ");
    const result = {
      screenshot, width: image.width, height: image.height, url: url.href,
      title, auditMode, viewportWidth: viewport.width, viewportHeight: viewport.height,
      viewport: { ...viewport, unit: "CSS px" },
      actualViewport: { innerWidth: viewport.width, innerHeight: viewport.height, devicePixelRatio: 1 },
      captureMethod: captured.provider, fullPage: true
    };
    console.info("[uxaudit] screenshot_capture_ok", JSON.stringify({
      provider: captured.provider, host: url.hostname, elapsedMs: Date.now() - started,
      auditMode, screenshot: { width: result.width, height: result.height }, fullPage: true
    }));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown screenshot capture error.";
    console.error("[uxaudit] screenshot_capture_error", JSON.stringify({ message: message.slice(0, 700) }));
    const timeout = /timeout|timed out|abort/i.test(message);
    return Response.json({
      error: timeout ? "Screenshot capture timed out after trying the configured providers. Retry once; if it happens again, upload a screenshot of the actual page." : message,
      code: timeout ? "CAPTURE_TIMEOUT" : "CAPTURE_FAILED",
      requiresManualScreenshot: true,
      captureDetails: message.slice(0, 900)
    }, { status: timeout ? 504 : 502, headers: { "Cache-Control": "no-store" } });
  }
}
