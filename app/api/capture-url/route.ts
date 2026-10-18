import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";
import { captureWebsiteScreenshot } from "@/lib/capture-screenshot";

export const runtime = "nodejs";
export const maxDuration = 60;

type AuditMode = "desktop" | "mobile";

function privateHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const version = isIP(h);
  if (version === 4) {
    const [a, b, c] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (version === 6) {
    return h === "::" || h === "::1" ||
      h.startsWith("fc") || h.startsWith("fd") ||
      /^fe[89ab]/.test(h) || h.startsWith("ff") ||
      h.startsWith("::ffff:");
  }
  return false;
}

async function resolvesToPrivateAddress(host: string) {
  const normalized = host.replace(/^\[|\]$/g, "");
  if (isIP(normalized)) return privateHost(normalized);
  try {
    // Workers does not implement dns.lookup(); resolve4/resolve6 use Cloudflare DNS over HTTPS.
    const results = await Promise.allSettled([resolve4(normalized), resolve6(normalized)]);
    const addresses = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    return !addresses.length || addresses.some((address) => privateHost(address));
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
    if (!captured.width || !captured.height || captured.width > 20000 || captured.height > 20000) {
      throw new Error("The captured page dimensions are invalid or too large. Select a shorter page or upload a screenshot.");
    }

    // Keep the provider's encoded bytes. Sharp's native image bindings are not suitable
    // for Workers; dimension validation is handled by the portable image header parser.
    const screenshot = "data:" + captured.mimeType + ";base64," + raw.toString("base64");
    const title = url.pathname === "/" ? "Homepage" : (url.pathname.split("/").filter(Boolean).pop() || url.hostname).replace(/[-_]/g, " ");
    const result = {
      screenshot, width: captured.width, height: captured.height, url: url.href,
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
      error: timeout ? "Screenshot capture timed out. The site may be slow or blocking automated browsers; retry or upload a screenshot of the actual page." : message,
      code: timeout ? "CAPTURE_TIMEOUT" : "CAPTURE_FAILED"
    }, { status: timeout ? 504 : 502, headers: { "Cache-Control": "no-store" } });
  }
}
