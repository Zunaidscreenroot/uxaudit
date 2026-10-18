import { isIP } from "node:net";
import { createAuditFromScreenshot } from "@/lib/audit";
import { captureWebsiteScreenshot } from "@/lib/capture-screenshot";
import { saveAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    // Workers do not expose Node's DNS resolver consistently. Use DNS-over-HTTPS
    // and fail closed if either lookup is unusable or no public address is returned.
    const queries = await Promise.all(["A", "AAAA"].map(async (type) => {
      const response = await fetch(
        "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(normalized) + "&type=" + type,
        {
          headers: { accept: "application/dns-json" },
          signal: AbortSignal.timeout(3000),
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("DNS resolution failed.");
      const payload = await response.json() as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
      if (payload.Status !== 0 && payload.Status !== 3) throw new Error("DNS resolution failed.");
      return (payload.Answer || [])
        .filter((answer) => answer.type === 1 || answer.type === 28)
        .map((answer) => answer.data)
        .filter((value): value is string => typeof value === "string" && value.length > 0);
    }));
    const addresses = queries.flat();
    return addresses.length === 0 || addresses.some((address) => privateHost(address));
  } catch {
    return true;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let u: URL;
    try {
      u = new URL(body?.url);
    } catch {
      return Response.json({ error: "A valid selected page URL is required." }, { status: 400 });
    }

    if (!["http:", "https:"].includes(u.protocol) || privateHost(u.hostname)) {
      return Response.json({ error: "Only public HTTP/HTTPS pages can be captured." }, { status: 400 });
    }
    if (await resolvesToPrivateAddress(u.hostname)) {
      return Response.json({ error: "The selected hostname did not resolve to a verified public address." }, { status: 400 });
    }
    if (body?.root) {
      try {
        if (new URL(body.root).origin !== u.origin) {
          return Response.json({ error: "Selected URL must belong to the discovered site." }, { status: 400 });
        }
      } catch {
        return Response.json({ error: "The discovered website root is invalid." }, { status: 400 });
      }
    }

    const models = Array.isArray(body?.verifiedModels)
      ? body.verifiedModels.filter((m: any) => m?.provider === "OpenRouter" && typeof m.model === "string").slice(0, 3)
      : [];
    if (!models.length) return Response.json({ error: "No verified model is available." }, { status: 503 });

    const auditMode = body?.auditMode === "mobile" ? "mobile" : "desktop";
    const viewport = auditMode === "mobile" ? { width: 393, height: 852 } : { width: 1440, height: 900 };
    const requestStarted = Date.now();
    const captureStarted = Date.now();
    console.info("[uxaudit] screenshot_capture_start", JSON.stringify({
      provider: "thum.io→browserless fallback", host: u.hostname, auditMode, viewport, fullPage: true
    }));

    const captured = await captureWebsiteScreenshot({ url: u.href, width: viewport.width, height: viewport.height });
    const bytes = captured.bytes;
    console.info("[uxaudit] screenshot_provider_selected", JSON.stringify({
      provider: captured.provider, host: u.hostname, elapsedMs: Date.now() - captureStarted, bytes: bytes.length
    }));
    console.info("[uxaudit] screenshot_capture_ok", JSON.stringify({
      provider: captured.provider, elapsedMs: Date.now() - captureStarted, bytes: bytes.length, auditMode, viewport, fullPage: true
    }));
    if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
      return Response.json({ error: "Screenshot was empty or too large." }, { status: 502 });
    }
    if (!captured.width || !captured.height || captured.width > 20000 || captured.height > 20000) {
      return Response.json({ error: "The captured page dimensions are invalid or too large. Select a shorter page or upload a screenshot." }, { status: 502 });
    }

    const title = u.pathname === "/" ? "Homepage" : u.pathname.split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ") || u.hostname;
    console.info("[uxaudit] ai_audit_start", JSON.stringify({ elapsedMs: Date.now() - requestStarted, models: models.map((m: any) => m.model) }));
    const result = await createAuditFromScreenshot(bytes, title + ".jpg", undefined, models, auditMode);
    console.info("[uxaudit] ai_audit_ok", JSON.stringify({ elapsedMs: Date.now() - requestStarted, findings: result.pages[0]?.findings?.length }));
    result.pages = result.pages.map((p) => ({
      ...p,
      clientName: typeof body.projectName === "string" && body.projectName.trim() ? body.projectName.trim() : u.hostname,
      url: u.href,
      title,
      createdAt: new Date().toISOString()
    }));
    const auditId = await saveAudit(result, "URL audit · " + (typeof body.projectName === "string" && body.projectName.trim() ? body.projectName.trim() : u.hostname) + " · " + title);
    console.info("[uxaudit] audit_request_ok", JSON.stringify({ elapsedMs: Date.now() - requestStarted, auditId }));
    return Response.json({ page: result.pages[0], auditId }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not capture and audit this page.";
    console.error("[uxaudit] audit_request_failed", JSON.stringify({ error: message }));
    return Response.json({ error: message }, { status: 502 });
  }
}
