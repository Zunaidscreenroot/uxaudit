import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { POST as captureWebsite } from "../capture-url/route";
import { POST as discoverWebsite } from "../discover/route";
import { createAuditFromScreenshot } from "@/lib/audit";
import { saveAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type AuditMode = "desktop" | "mobile";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
function responseError(payload: any, status: number) {
  return typeof payload?.error === "string" ? payload.error : `Request failed (HTTP ${status}).`;
}

const handler = createMcpHandler((server) => {
  server.registerTool(
    "get_connection_status",
    {
      title: "Get UX Audit connection status",
      description: "Check whether UX Audit has an OpenRouter API key configured and can authenticate with OpenRouter. Does not run model inference or spend generation tokens.",
      inputSchema: z.object({}),
    },
    async () => {
      const key = process.env.OPENROUTER_API_KEY?.trim();
      const status: Record<string, unknown> = {
        service: "UX Audit",
        mcpServer: "connected",
        openRouterKeyConfigured: Boolean(key),
        mcpBearerAuthenticationRequired: Boolean(process.env.UXAUDIT_MCP_API_KEY?.trim()),
        checkedAt: new Date().toISOString(),
      };
      if (!key) return textResult({ ...status, openRouterConnected: false, note: "OPENROUTER_API_KEY is not configured." });
      try {
        const response = await fetch("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: "Bearer " + key },
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        });
        return textResult({ ...status, openRouterConnected: response.ok, ...(response.ok ? {} : { providerHttpStatus: response.status }) });
      } catch {
        return textResult({ ...status, openRouterConnected: false, note: "OpenRouter key status API could not be reached." });
      }
    },
  );

  server.registerTool(
    "discover_website",
    {
      title: "Discover website information architecture",
      description: "Inspect the public homepage navigation and common sitemap files, then return discovered pages with URL, title, category, depth, and source. Does not run an AI audit.",
      inputSchema: z.object({
        url: z.string().min(1).max(2048).describe("Public website URL, e.g. https://example.com"),
        maxPages: z.number().int().min(1).max(120).optional().describe("Maximum discovered pages to return (1–120; default 50)."),
      }),
    },
    async ({ url, maxPages }) => {
      try {
        const response = await discoverWebsite(new Request("https://uxaudit-internal.invalid/api/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }));
        const payload: any = await response.json().catch(() => ({}));
        if (!response.ok) return errorResult(responseError(payload, response.status));
        const pages = Array.isArray(payload.pages) ? payload.pages.slice(0, maxPages ?? 50) : [];
        return textResult({
          root: payload.root,
          title: payload.title,
          discoveredCount: Array.isArray(payload.pages) ? payload.pages.length : 0,
          returnedCount: pages.length,
          pages,
          note: payload.note,
          scannedAt: payload.scannedAt,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Website discovery failed.");
      }
    },
  );

  server.registerTool(
    "audit_website_page",
    {
      title: "Run a UX audit on a website page",
      description: "Capture one public page with server-side Chromium, analyse the screenshot using OpenRouter, and save evidence-led findings to the UX Audit knowledge base. If automated capture is blocked, use the web app's manual screenshot upload workflow. This tool can incur model API charges.",
      inputSchema: z.object({
        url: z.string().url().max(2048).describe("Public page URL to capture and audit."),
        projectName: z.string().trim().min(1).max(120).optional().describe("Client or project label for the saved report."),
        auditMode: z.enum(["desktop", "mobile"]).optional().describe("desktop (1440px wide) or mobile (393 × 852 CSS px); defaults to desktop."),
      }),
    },
    async ({ url, projectName, auditMode }) => {
      const mode: AuditMode = auditMode === "mobile" ? "mobile" : "desktop";
      let parsedUrl: URL;
      try { parsedUrl = new URL(url); }
      catch { return errorResult("Enter a valid HTTP or HTTPS page URL."); }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return errorResult("Only public HTTP/HTTPS websites can be audited.");
      }
      try {
        const captureResponse = await captureWebsite(new Request("https://uxaudit-internal.invalid/api/capture-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: parsedUrl.href, auditMode: mode }),
        }));
        const capture: any = await captureResponse.json().catch(() => ({}));
        if (!captureResponse.ok) return errorResult(responseError(capture, captureResponse.status));
        if (typeof capture.screenshot !== "string") return errorResult("Screenshot capture returned no image.");
        const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(capture.screenshot);
        if (!match) return errorResult("The captured screenshot has an unsupported image format.");
        const imageBytes = Buffer.from(match[2], "base64");
        if (!imageBytes.length || imageBytes.length > 15 * 1024 * 1024) {
          return errorResult("The captured screenshot is empty or exceeds the 15 MB audit limit.");
        }

        const pageTitle = typeof capture.title === "string" && capture.title.trim() ? capture.title.trim() : parsedUrl.hostname;
        const project = projectName?.trim() || parsedUrl.hostname;
        const models = [{ provider: "OpenRouter" as const, model: "openrouter/auto", tier: "paid" as const }];
        const result = await createAuditFromScreenshot(imageBytes, pageTitle + ".jpg", undefined, models, mode);
        result.pages = result.pages.map((page) => ({
          ...page,
          clientName: project,
          url: parsedUrl.href,
          title: pageTitle,
          createdAt: new Date().toISOString(),
          auditMode: mode,
          viewportWidth: mode === "mobile" ? 393 : 1440,
          ...(mode === "mobile" ? { viewportHeight: 852 } : {}),
        }));
        const auditId = await saveAudit(result, "MCP UX Audit · " + project + " · " + pageTitle);
        const page: any = result.pages[0];
        const findings = Array.isArray(page?.findings) ? page.findings : [];
        const severityCounts = findings.reduce((counts: Record<string, number>, finding: any) => {
          const severity = typeof finding?.severity === "string" ? finding.severity : "unknown";
          counts[severity] = (counts[severity] || 0) + 1;
          return counts;
        }, {});
        return textResult({
          status: "complete",
          auditId,
          projectName: project,
          url: parsedUrl.href,
          pageTitle,
          auditMode: mode,
          screenshot: { width: capture.width, height: capture.height, fullPage: Boolean(capture.fullPage) },
          findingCount: findings.length,
          severityCounts,
          findings: findings.slice(0, 30).map((finding: any) => ({
            id: finding.id,
            severity: finding.severity,
            category: finding.category,
            title: finding.title,
            description: finding.description,
            recommendation: finding.recommendation,
            evidence: Array.isArray(finding.evidence) ? finding.evidence : [],
          })),
          note: "The saved report may contain more findings than are included in this response.",
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "The website audit failed.");
      }
    },
  );
}, { serverInfo: { name: "UX Audit MCP", version: "1.0.0" } });

async function authorizedHandler(request: Request) {
  const expected = process.env.UXAUDIT_MCP_API_KEY?.trim();
  if (expected && request.headers.get("authorization") !== "Bearer " + expected) {
    return Response.json(
      { error: "Unauthorized. Supply the configured UXAUDIT_MCP_API_KEY as a Bearer token." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="UX Audit MCP"', "Cache-Control": "no-store" } },
    );
  }
  return handler(request);
}

export const GET = authorizedHandler;
export const POST = authorizedHandler;
export const DELETE = authorizedHandler;
