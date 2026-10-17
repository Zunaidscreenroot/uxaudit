import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

type AuditMode = "desktop" | "mobile";

function privateHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const version = isIP(h);
  if (version === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return version === 6 && (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:"));
}

async function resolvesToPrivateAddress(host: string) {
  if (isIP(host.replace(/^\[|\]$/g, ""))) return privateHost(host);
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return !addresses.length || addresses.some((address) => privateHost(address.address));
  } catch {
    return true;
  }
}

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

    const token = process.env.BROWSERLESS_API_TOKEN;
    if (!token) {
      console.error("[uxaudit] browserless_config_missing");
      return Response.json({ error: "Browserless screenshot service is not configured. Set BROWSERLESS_API_TOKEN in the production environment." }, { status: 503 });
    }

    const auditMode: AuditMode = body?.auditMode === "mobile" ? "mobile" : "desktop";
    const mobile = auditMode === "mobile";
    const viewport = mobile ? { width: 393, height: 852 } : { width: 1440, height: 900 };
    const started = Date.now();
    console.info("[uxaudit] screenshot_capture_start", JSON.stringify({
      provider: "browserless.io", host: url.hostname, auditMode, viewport, fullPage: true
    }));

    const response = await fetch("https://production-sfo.browserless.io/screenshot?token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "image/jpeg" },
      body: JSON.stringify({
        url: url.href,
        timeout: 60000,
        viewport: { ...viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, isLandscape: false },
        options: { type: "jpeg", quality: 88, fullPage: true },
        gotoOptions: { waitUntil: "domcontentloaded", timeout: 30000 },
        ...(mobile ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } : {})
      }),
      signal: AbortSignal.timeout(45000),
      cache: "no-store"
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      console.error("[uxaudit] browserless_capture_failed", JSON.stringify({
        host: url.hostname, status: response.status, detail, elapsedMs: Date.now() - started
      }));
      return Response.json({
        error: "Browserless could not capture this page (HTTP " + response.status + "). " + (detail || "Check the Browserless token, quota, and target-site access."),
        code: "BROWSERLESS_CAPTURE_FAILED"
      }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error("Browserless returned a non-image response (" + contentType + "). " + detail);
    }
    const raw = Buffer.from(await response.arrayBuffer());
    if (!raw.length || raw.length > 15 * 1024 * 1024) {
      throw new Error("The screenshot is empty or exceeds the 15 MB analysis limit.");
    }

    const metadata = await sharp(raw).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Browserless returned an invalid screenshot.");
    const boundedWidth = Math.min(metadata.width, viewport.width);
    const boundedHeight = Math.min(metadata.height, 18000);
    let image = sharp(raw);
    if (boundedWidth !== metadata.width || boundedHeight !== metadata.height) {
      image = image.extract({ left: 0, top: 0, width: boundedWidth, height: boundedHeight });
    }
    const bytes = await image.jpeg({ quality: 88, progressive: true }).toBuffer();
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
      throw new Error("The responsive screenshot is too large to analyse. Try a shorter page or a smaller capture.");
    }
    const finalMetadata = await sharp(bytes).metadata();
    const screenshot = "data:image/jpeg;base64," + bytes.toString("base64");
    const title = url.pathname === "/" ? "Homepage" : (url.pathname.split("/").filter(Boolean).pop() || url.hostname).replace(/[-_]/g, " ");
    const result = {
      screenshot, width: finalMetadata.width, height: finalMetadata.height, url: url.href,
      title, auditMode, viewportWidth: viewport.width, viewportHeight: viewport.height,
      viewport: { ...viewport, unit: "CSS px" },
      actualViewport: { innerWidth: viewport.width, innerHeight: viewport.height, devicePixelRatio: 1 },
      captureMethod: "browserless.io", fullPage: true
    };
    console.info("[uxaudit] screenshot_capture_ok", JSON.stringify({
      provider: "browserless.io", host: url.hostname, elapsedMs: Date.now() - started,
      auditMode, screenshot: { width: result.width, height: result.height }, fullPage: true
    }));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown screenshot capture error.";
    console.error("[uxaudit] screenshot_capture_error", JSON.stringify({ message: message.slice(0, 700) }));
    const timeout = /timeout|timed out|abort/i.test(message);
    return Response.json({
      error: timeout ? "Screenshot capture timed out. The site may be slow or blocking automated browsers; retry or upload a screenshot of the actual page." : message,
      code: timeout ? "CAPTURE_TIMEOUT" : "CAPTURE_FAILED"
    }, { status: timeout ? 504 : 502, headers: { "Cache-Control": "no-store" } });
  }
}
