import { randomUUID } from "node:crypto";
import { getMcpIssuer, verifyMcpPayload } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const maxDuration = 60;

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
type AuthClaims = { typ: "access"; iss?: string; aud?: string; scope?: string; exp?: number; sub?: string };
type DiscoveredPage = { url: string; title: string; category: string; depth: number; source?: string };
type Session = { id: string; root: string; title?: string; discovery: {root:string;title:string;pages:DiscoveredPage[];note?:string}; selected_urls?: string[]; audited_pages?: any[]; project_name?: string; stage?: string };

const toolDefinitions = [
  { name: "uxaudit_discover_site", title: "Discover website IA", requiredScope: "audit:read",
    description: "Discover a public website's linked pages, sitemap URLs, page labels, categories and URL depth. Does not run AI screenshot analysis.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "Website root URL." } }, required: ["url"], additionalProperties: false } },
  { name: "uxaudit_run_page_audit", title: "Run desktop or mobile UX audit", requiredScope: "audit:run",
    description: "Capture a public page and run evidence-led AI UX analysis. mode is desktop or mobile (393×852 CSS px). Uses the configured OpenRouter key and may incur model charges. If CDN/security blocks capture, the tool stops without treating the denial page as UX evidence.",
    inputSchema: { type: "object", properties: {
      url: { type: "string", description: "Exact page URL to audit." },
      mode: { type: "string", enum: ["desktop", "mobile"], description: "Desktop (1440 px wide) or mobile (393×852 CSS px)." },
      projectName: { type: "string", description: "Optional project/client label." },
      screenshotDataUrl: { type: "string", description: "Optional PNG/JPEG/WebP base64 data URL of the actual page screenshot. Never pass a CDN/403 error screenshot." },
    }, required: ["url"], additionalProperties: false } },
  { name: "uxaudit_get_session_report", title: "Get saved UX Audit session", requiredScope: "audit:read",
    description: "Retrieve a recent saved IA session, discovered pages and audit metadata by session UUID. Sessions typically expire after 30 minutes.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string", description: "UUID returned after a page audit." } }, required: ["sessionId"], additionalProperties: false } },
  { name: "uxaudit_get_findings", title: "Get UX findings", requiredScope: "audit:read",
    description: "Get concise findings from a saved IA session: severity, category, issue, recommendation, UX research and business analysis. Omits screenshot payloads.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string", description: "UUID returned by UX Audit." }, pageUrl: { type: "string", description: "Optional URL filter." } }, required: ["sessionId"], additionalProperties: false } },
  { name: "uxaudit_generate_improved_ia", title: "Generate improved information architecture", requiredScope: "ia:generate",
    description: "Generate a reviewable improved IA proposal from a saved session, audit findings and discovered pages. Optionally focus on one URL or finding. Does not change live website routes.",
    inputSchema: { type: "object", properties: {
      sessionId: { type: "string", description: "UUID returned by UX Audit." },
      targetUrl: { type: "string", description: "Optional page URL to prioritize." },
      findingId: { type: "string", description: "Optional original finding ID, used with targetUrl." },
      issueTitle: { type: "string", description: "Optional IA warning title to prioritize." },
    }, required: ["sessionId"], additionalProperties: false } },
];

function jsonRpcResult(id: string | number | null | undefined, value: unknown, isError = false) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) } }, { headers: { "Cache-Control": "no-store" } });
}
function jsonRpcError(id: string | number | null | undefined, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { headers: { "Cache-Control": "no-store" } });
}
function unauthorized(request: Request) {
  const metadata = getMcpIssuer(request) + "/.well-known/oauth-protected-resource";
  return Response.json({ error: "unauthorized", error_description: "A valid UX Audit MCP OAuth token is required." }, { status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="' + metadata + '"', "Cache-Control": "no-store" } });
}
function getBearer(request: Request): string {
  const header = request.headers.get("authorization") || "";
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
}
function tokenHasScope(token: AuthClaims, required: string): boolean { return String(token.scope || "").split(/\s+/).includes(required); }
function asTextError(error: unknown) { return error instanceof Error ? error.message : "UX Audit MCP request failed."; }
async function apiRequest(origin: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(origin + path, { ...init, cache: "no-store", headers: { Accept: "application/json", ...(init.headers || {}) } });
  const bodyText = await response.text();
  let body: any = {};
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { error: bodyText.slice(0, 700) }; }
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "UX Audit API returned HTTP " + response.status + ".";
    const error = new Error(message) as Error & { httpStatus?: number; requiresManualScreenshot?: boolean };
    error.httpStatus = response.status; error.requiresManualScreenshot = body?.requiresManualScreenshot === true;
    throw error;
  }
  return body;
}
function jsonBody(body: unknown): RequestInit { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
function canonicalUrl(raw: string): string {
  try { const u = new URL(raw); u.hash = ""; u.pathname = u.pathname.replace(/\/+$/, "") || "/"; return u.origin + (u.pathname === "/" ? "" : u.pathname); } catch { return raw; }
}
function cleanReport(page: any) {
  if (!page || typeof page !== "object") return page;
  const { screenshot, ...safe } = page;
  return { ...safe, screenshotAvailable: typeof screenshot === "string" && screenshot.startsWith("data:image/") };
}
function cleanSession(session: Session) {
  const reports = Array.isArray(session.audited_pages) ? session.audited_pages.map(cleanReport) : [];
  return { id: session.id, root: session.root, title: session.title, stage: session.stage, project_name: session.project_name,
    discovery: session.discovery ? { root: session.discovery.root, title: session.discovery.title, pages: session.discovery.pages, note: session.discovery.note } : null,
    selected_urls: session.selected_urls || [], audited_pages: reports };
}
async function loadSession(origin: string, sessionId: string): Promise<Session> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new Error("sessionId must be a valid UUID.");
  const result = await apiRequest(origin, "/api/ia-session?id=" + encodeURIComponent(sessionId));
  if (!result.session) throw new Error("Saved UX Audit session was not found or has expired.");
  return result.session as Session;
}
function makeWarnings(pages: DiscoveredPage[]) {
  const deep = pages.filter(p => Number(p.depth) >= 3), other = pages.filter(p => p.category === "Other Pages"), about = pages.filter(p => p.category === "About Us");
  return [
    ...(deep.length ? [{ id: "deep-page-hierarchy", title: "Deep page hierarchy", detail: deep.length + " URLs are three or more levels deep. Review whether priority journeys can be brought closer to the top level.", urls: deep.map(p => p.url) }] : []),
    ...(about.length >= 4 ? [{ id: "about-us-sprawl", title: "About Us sprawl", detail: about.length + " About Us pages were discovered. Review overlap and grouping.", urls: about.map(p => p.url) }] : []),
    ...(other.length ? [{ id: "unclear-page-grouping", title: "Unclear page grouping", detail: other.length + " pages could not be classified confidently from their URL or title.", urls: other.map(p => p.url) }] : []),
  ];
}
function compactFindings(reports: any[], pageUrl?: string) {
  return reports.flatMap((report: any) => {
    if (pageUrl && canonicalUrl(String(report.url || "")) !== canonicalUrl(pageUrl)) return [];
    return (Array.isArray(report.findings) ? report.findings : []).map((finding: any) => ({
      id: finding.id, url: report.url, pageTitle: report.title, severity: finding.severity, category: finding.category,
      title: finding.title, description: finding.description, recommendation: finding.recommendation,
      uxPerspective: finding.uxPerspective, businessAnalysis: finding.businessAnalysis, evidence: finding.evidence,
    }));
  });
}

async function runTool(name: string, args: any, request: Request) {
  const origin = new URL(request.url).origin;

  if (name === "uxaudit_discover_site") {
    if (typeof args.url !== "string" || !args.url.trim()) throw new Error("url is required.");
    const result = await apiRequest(origin, "/api/discover", jsonBody({ url: args.url.trim() }));
    return { root: result.root, title: result.title, pageCount: Array.isArray(result.pages) ? result.pages.length : 0, pages: result.pages || [], scannedAt: result.scannedAt, note: result.note };
  }

  if (name === "uxaudit_run_page_audit") {
    const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
    let target: URL;
    try { target = new URL(rawUrl); } catch { throw new Error("url must be a valid absolute HTTP/HTTPS URL."); }
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("Only public HTTP/HTTPS URLs are supported.");
    const mode = args.mode === "mobile" ? "mobile" : "desktop";
    const viewport = mode === "mobile" ? { width: 393, height: 852 } : { width: 1440, height: 900 };
    let discovery: any = null;
    try { discovery = await apiRequest(origin, "/api/discover", jsonBody({ url: target.origin })); }
    catch { discovery = { root: target.origin, title: target.hostname, pages: [{ url: target.origin, title: "Homepage", category: "Home", depth: 0 }] }; }
    let screenshot = typeof args.screenshotDataUrl === "string" ? args.screenshotDataUrl : "";
    let title = target.pathname === "/" ? "Homepage" : (target.pathname.split("/").filter(Boolean).pop() || target.hostname).replace(/[-_]/g, " ");
    if (screenshot) {
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(screenshot) || screenshot.length > 21 * 1024 * 1024) throw new Error("screenshotDataUrl must be a PNG/JPEG/WebP data URL under 15 MB.");
    } else {
      const captured = await apiRequest(origin, "/api/capture-url", jsonBody({ url: target.href, root: target.origin, auditMode: mode, viewport })).catch(error => {
        const message = asTextError(error);
        const blocked = (error as Error & { requiresManualScreenshot?: boolean }).requiresManualScreenshot || /403|cloudfront|blocked automated screenshot/i.test(message);
        if (blocked) throw new Error(message + " No audit finding was created. Open the target in your normal browser and upload the actual page screenshot in the UX Audit workspace, or supply screenshotDataUrl to this tool.");
        throw error;
      });
      if (typeof captured.screenshot !== "string" || !captured.screenshot.startsWith("data:image/")) throw new Error("Screenshot capture returned no valid image.");
      screenshot = captured.screenshot; title = String(captured.title || title);
    }
    const auditResponse = await fetch(origin + "/api/audit-screenshot", jsonBody({
      url: target.href, projectName: typeof args.projectName === "string" ? args.projectName.slice(0, 200) : target.hostname,
      title, screenshot, auditMode: mode, viewport,
    }));
    const stream = await auditResponse.text();
    if (!auditResponse.ok) {
      let detail = stream;
      try { detail = JSON.parse(stream).error || stream; } catch {}
      throw new Error("The UX Audit analysis endpoint failed (" + auditResponse.status + "): " + String(detail).slice(0, 700));
    }
    let auditPayload: any = null, streamError = "";
    for (const frame of stream.split(/\r?\n\r?\n/)) {
      const line = frame.split(/\r?\n/).find(part => part.startsWith("data: "));
      if (!line) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "result") auditPayload = event.payload;
        if (event.type === "error") streamError = String(event.error || "AI audit failed.");
      } catch {}
    }
    if (streamError) throw new Error(streamError);
    if (!auditPayload?.page) throw new Error("The audit stream ended without a report. Check UX Audit deployment logs.");
    const report = auditPayload.page, sessionId = randomUUID();
    const rootUrl = discovery?.root || target.origin;
    const pageList: DiscoveredPage[] = Array.isArray(discovery?.pages) && discovery.pages.length
      ? discovery.pages.slice(0, 120)
      : [{ url: rootUrl, title: "Homepage", category: "Home", depth: 0 }, { url: target.href, title, category: "Other Pages", depth: target.pathname.split("/").filter(Boolean).length }];
    const updatedDiscovery = { root: rootUrl, title: discovery?.title || target.hostname, pages: pageList, note: discovery?.note || "Created during an MCP-initiated audit." };
    let sessionSaved = false;
    try {
      await apiRequest(origin, "/api/ia-session", jsonBody({
        id: sessionId, root: rootUrl, title: updatedDiscovery.title, discovery: updatedDiscovery,
        selected_urls: [target.href], audited_pages: [report], stage: "results",
        project_name: typeof args.projectName === "string" ? args.projectName.slice(0, 200) : target.hostname,
      }));
      sessionSaved = true;
    } catch (error) {
      console.warn("[uxaudit] mcp_session_save_failed", JSON.stringify({ error: asTextError(error) }));
    }
    return {
      url: target.href, mode, viewport, title: report.title, auditId: auditPayload.auditId || null,
      sessionId: sessionSaved ? sessionId : null, sessionSaved,
      findingCount: Array.isArray(report.findings) ? report.findings.length : 0,
      findings: compactFindings([report]), report: cleanReport(report),
      note: sessionSaved ? "Audit results were saved to UX Audit. Use sessionId to retrieve findings or generate improved IA." : "Audit completed, but saved-session persistence failed; findings are included in this result.",
    };
  }

  if (name === "uxaudit_get_session_report" || name === "uxaudit_get_findings") {
    const session = await loadSession(origin, String(args.sessionId || ""));
    if (name === "uxaudit_get_session_report") return cleanSession(session);
    const findings = compactFindings(session.audited_pages || [], typeof args.pageUrl === "string" ? args.pageUrl : undefined);
    return { sessionId: session.id, root: session.root, findingCount: findings.length, findings };
  }

  if (name === "uxaudit_generate_improved_ia") {
    const session = await loadSession(origin, String(args.sessionId || ""));
    if (!session.discovery || !Array.isArray(session.discovery.pages) || !session.discovery.pages.length) throw new Error("The saved session has no discovered pages. Run uxaudit_discover_site or start a new page audit first.");
    const reports = Array.isArray(session.audited_pages) ? session.audited_pages : [];
    const findings = reports.flatMap((report: any) => (Array.isArray(report.findings) ? report.findings : []).map((finding: any) => ({
      id: String(report.url || "") + "::" + String(finding.id || finding.title || "finding"),
      sourceId: String(finding.id || ""), url: String(report.url || ""), title: String(finding.title || "UX finding"),
      category: String(finding.category || "Visual design"), severity: String(finding.severity || "medium"),
      description: String(finding.description || ""), recommendation: String(finding.recommendation || ""),
    }))).slice(0, 100);
    const payload = {
      root: session.root || session.discovery.root, websiteTitle: session.discovery.title || session.title || session.root,
      projectName: session.project_name || "Website",
      pages: session.discovery.pages.slice(0, 120).map(page => ({ url: page.url, title: page.title, category: page.category, depth: Number(page.depth || 0) })),
      findings, iaWarnings: makeWarnings(session.discovery.pages),
      targetUrl: typeof args.targetUrl === "string" ? args.targetUrl : "",
      focusFindingId: typeof args.findingId === "string" ? args.findingId : "",
      focusIssueTitle: typeof args.issueTitle === "string" ? args.issueTitle : "",
    };
    const result = await apiRequest(origin, "/api/generate-improved-ia", jsonBody(payload));
    if (!result.proposal) throw new Error("IA generator returned no proposal.");
    return { sessionId: session.id, proposal: result.proposal };
  }
  throw new Error("Unknown UX Audit tool: " + name);
}

export async function POST(request: Request) {
  const token = verifyMcpPayload(getBearer(request), "access") as unknown as AuthClaims | null;
  const issuer = getMcpIssuer(request);
  if (!token || token.iss !== issuer || token.aud !== issuer + "/api/mcp") return unauthorized(request);
  let rpc: JsonRpc;
  try { rpc = await request.json() as JsonRpc; } catch { return jsonRpcError(null, -32700, "Invalid JSON-RPC request."); }
  const id = rpc.id;
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return jsonRpcError(id, -32600, "Invalid JSON-RPC request.");
  if (rpc.method === "notifications/initialized" || rpc.method.startsWith("notifications/")) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  if (rpc.method === "ping") return jsonRpcResult(id, {});
  if (rpc.method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: typeof rpc.params?.protocolVersion === "string" ? rpc.params.protocolVersion : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "uxaudit", title: "UX Audit", version: "1.0.0", websiteUrl: "https://github.com/Zunaidscreenroot/uxaudit" },
      instructions: "Discover public websites, run evidence-led desktop/mobile screenshot audits, retrieve saved findings, and generate proposed improved IA. Never treat CDN denial pages as UX findings. AI audits and IA generation may incur OpenRouter costs.",
    });
  }
  if (rpc.method === "tools/list") {
    const visible = toolDefinitions.filter(tool => tokenHasScope(token, tool.requiredScope));
    return jsonRpcResult(id, { tools: visible.map(({ requiredScope, ...definition }) => definition) });
  }
  if (rpc.method === "tools/call") {
    const name = String(rpc.params?.name || "");
    const tool = toolDefinitions.find(candidate => candidate.name === name);
    if (!tool) return jsonRpcResult(id, { error: "Unknown tool: " + name }, true);
    if (!tokenHasScope(token, tool.requiredScope)) return jsonRpcResult(id, { error: "OAuth token is missing required scope " + tool.requiredScope + ". Reconnect with full UX Audit access." }, true);
    try {
      const args = rpc.params?.arguments && typeof rpc.params.arguments === "object" ? rpc.params.arguments : {};
      return jsonRpcResult(id, await runTool(name, args, request));
    } catch (error) { return jsonRpcResult(id, { error: asTextError(error) }, true); }
  }
  return jsonRpcError(id, -32601, "Method not found.");
}
export async function GET() {
  return new Response("UX Audit MCP uses Streamable HTTP POST requests.", { status: 405, headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store" } });
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store" } }); }
