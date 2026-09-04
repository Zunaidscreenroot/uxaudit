export type Severity = "high" | "medium" | "low";

export type Evidence = { label: string; detail: string; marker: number; x: number; y: number; width: number; height: number };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; screenrootTasks: string[]; devTasks: string[]; uxPerspective: { law: string; definition: string; assessment: string }; evidence: Evidence[] };
export type AuditPage = { url: string; path: string; pageTitle: string; score: number; summary: string; screenshotUrl: string; findings: Finding[] };
export type AuditResult = { url: string; pageTitle: string; score: number; summary: string; pages: AuditPage[] };

const MAX_PAGES = 1;
const GEMINI_MODEL = "gemini-3.8-flash";
const PAGE_FETCH_TIMEOUT_MS = 10000;
const BROWSERLESS_TIMEOUT_MS = 45000;
const GEMINI_TIMEOUT_MS = 30000;

function debug(message: string, data?: unknown) { console.log(`[UXAudit server] ${message}`, data ?? ""); }
function stripTags(value: string) { return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); }
function makeScreenshotUrl(url: string) { const encoded = Buffer.from(url, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); return `/api/screenshot?u=${encoded}`; }

async function fetchPage(url: string) {
  const started = Date.now(); debug("fetch page:start", url);
  const response = await fetch(url, { headers: { "User-Agent": "ScreenRoot-UX-Audit/4.0" }, redirect: "follow", signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Website returned ${response.status}`);
  const html = await response.text();
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url).slice(0, 120) || url;
  debug("fetch page:done", { url, ms: Date.now() - started, bytes: html.length, status: response.status });
  return { html, title };
}

async function captureScreenshot(url: string): Promise<{ base64: string; mimeType: string }> {
  const token = process.env.BROWSERLESS_API_TOKEN;
  if (!token) throw new Error("BROWSERLESS_API_TOKEN is not configured.");
  const endpoint = new URL("https://production-sfo.browserless.io/screenshot"); endpoint.searchParams.set("token", token);
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" }, body: JSON.stringify({ url, options: { fullPage: true, type: "png", optimizeForSpeed: true } }), signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT_MS) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Screenshot service returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`); }
  const contentType = response.headers.get("content-type") ?? "image/png";
  if (!contentType.toLowerCase().startsWith("image/")) throw new Error("Screenshot service returned an invalid image.");
  const bytes = Buffer.from(await response.arrayBuffer()); debug("screenshot:done", { url, bytes: bytes.length, contentType });
  return { base64: bytes.toString("base64"), mimeType: contentType.split(";")[0] || "image/png" };
}

function parseJson(text: string) { const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim(); const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("Gemini returned invalid JSON."); return JSON.parse(cleaned.slice(start, end + 1)); }
function fallbackFinding(category: string, title: string, description: string, recommendation: string, law: string, definition: string): Finding { return { id: `fallback-${Date.now()}`, severity: "low", category, title, description, recommendation, screenrootTasks: ["Review the rendered landing page and validate the issue with representative user tasks."], devTasks: ["Verify the implementation against the intended UX behavior and accessibility requirements."], uxPerspective: { law, definition, assessment: "No definitive violation can be confirmed from this automated review alone; validate the rendered experience and user behavior." }, evidence: [{ label: "Landing page", detail: "The screenshot could not be analysed by Gemini.", marker: 1, x: 5, y: 5, width: 90, height: 15 }] }; }
function normaliseFinding(raw: any, index: number): Finding { const evidence = Array.isArray(raw?.evidence) ? raw.evidence : []; return { id: String(raw?.id || `finding-${index + 1}`), severity: raw?.severity === "high" || raw?.severity === "medium" ? raw.severity : "low", category: String(raw?.category || "Overall UX"), title: String(raw?.title || "UX issue"), description: String(raw?.description || ""), recommendation: String(raw?.recommendation || "Validate and improve the experience."), screenrootTasks: Array.isArray(raw?.screenrootTasks) ? raw.screenrootTasks.map(String).slice(0, 5) : [], devTasks: Array.isArray(raw?.devTasks) ? raw.devTasks.map(String).slice(0, 5) : [], uxPerspective: { law: String(raw?.uxPerspective?.law || "Evidence review"), definition: String(raw?.uxPerspective?.definition || "A UX principle or accessibility requirement used to interpret the evidence."), assessment: String(raw?.uxPerspective?.assessment || "Potential issue; confirm through rendered inspection or user testing.") }, evidence: evidence.slice(0, 6).map((item: any, i: number) => ({ label: String(item?.label || `Region ${i + 1}`), detail: String(item?.detail || ""), marker: Number(item?.marker || i + 1), x: Math.max(0, Math.min(96, Number(item?.x ?? 5))), y: Math.max(0, Math.min(96, Number(item?.y ?? 5))), width: Math.max(2, Math.min(96, Number(item?.width ?? 20))), height: Math.max(2, Math.min(96, Number(item?.height ?? 10))) })) }; }

async function analyseWithGemini(url: string, title: string, screenshot: { base64: string; mimeType: string }) {
  const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const prompt = `You are a senior UX auditor for ScreenRoot. Analyse the supplied FULL-PAGE SCREENSHOT of a website landing page. This is a visual UX audit, so base findings primarily on what is visibly rendered in the image. Return ONLY valid JSON.\n\nRules:\n- Audit ONLY the landing page shown in the screenshot. Do not infer hidden pages or functionality that is not visible.\n- Identify 3-8 high-value UX findings when the screenshot provides enough evidence; return fewer if appropriate.\n- Every finding must point to one or more concrete visible regions in the screenshot.\n- Each evidence item is a highlighted target region. Coordinates are percentages of the full screenshot: x and y are the top-left position, width and height are percentages of the full screenshot dimensions. Keep all values 0-100.\n- marker must be a short region number (1, 2, 3...). Reuse a marker only when it is the same visible region.\n- Use "Potential violation" when a UX law, heuristic, or WCAG requirement is being inferred rather than directly proven.\n- Do not force a UX law. Use Hick's Law, Fitts's Law, Jakob's Law, Miller's Law, Tesler's Law, Doherty Threshold, Peak-End Rule, Aesthetic-Usability Effect, Zeigarnik Effect, Von Restorff Effect, Gestalt principles, Nielsen heuristics, or WCAG only when relevant.\n- For each finding, explain exactly what the highlighted region is saying/doing, why it may create friction, the applicable law/principle and its definition, and what ScreenRoot and development teams should do.\n- Score 0-100 based on the visible landing-page experience. Higher is better.\n\nJSON shape:\n{"score":number,"summary":string,"findings":[{"id":string,"severity":"high|medium|low","category":string,"title":string,"description":string,"recommendation":string,"screenrootTasks":string[],"devTasks":string[],"uxPerspective":{"law":string,"definition":string,"assessment":string},"evidence":[{"label":string,"detail":string,"marker":number,"x":number,"y":number,"width":number,"height":number}]}]}`;
  const started = Date.now(); debug("gemini:start", { url, model: GEMINI_MODEL });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${prompt}\n\nURL: ${url}\nTITLE: ${title}` }, { inlineData: { mimeType: screenshot.mimeType, data: screenshot.base64 } }] }], generationConfig: { responseMimeType: "application/json" } }), signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) });
  debug("gemini:response", { url, model: GEMINI_MODEL, status: response.status, ms: Date.now() - started });
  if (!response.ok) { const detail = await response.text().catch(() => ""); if (response.status === 429) throw new Error("GEMINI_QUOTA_EXHAUSTED"); if (response.status === 401 || response.status === 403) throw new Error("GEMINI_AUTH_FAILED"); throw new Error(`Gemini returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`); }
  const data = await response.json(); const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || ""; const parsed = parseJson(text);
  return { score: Math.max(0, Math.min(100, Number(parsed.score) || 0)), summary: String(parsed.summary || ""), findings: (Array.isArray(parsed.findings) ? parsed.findings : []).map(normaliseFinding) };
}

export async function createAudit(url: string): Promise<AuditResult> {
  const started = Date.now(); debug("audit:start", { url, maxPages: MAX_PAGES, model: GEMINI_MODEL }); const page = await fetchPage(url);
  try {
    const screenshot = await captureScreenshot(url); const analysis = await analyseWithGemini(url, page.title, screenshot);
    const auditedPage: AuditPage = { url, path: new URL(url).pathname || "/", pageTitle: page.title, score: analysis.score, summary: analysis.summary, screenshotUrl: makeScreenshotUrl(url), findings: analysis.findings };
    return { url, pageTitle: page.title, score: analysis.score, summary: "Landing page screenshot audited with Gemini. Highlighted regions map directly to the explanations below.", pages: [auditedPage] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"; debug("audit:fallback", { url, error: message }); const quota = message === "GEMINI_QUOTA_EXHAUSTED"; const auth = message === "GEMINI_AUTH_FAILED";
    const finding = quota ? fallbackFinding("AI status", "Gemini quota reached", "The landing-page screenshot was captured, but Gemini rejected the analysis because the current project quota was exhausted.", "Check the Gemini project quota/billing and rerun the audit.", "Evidence review", "Automated UX findings require the AI analysis to be completed against the rendered screenshot.") : auth ? fallbackFinding("AI status", "Gemini authentication failed", "The landing-page screenshot was captured, but Gemini rejected the configured API credentials.", "Verify the server-side GEMINI_API_KEY configuration and rerun the audit.", "Evidence review", "Automated UX findings require a valid AI analysis request.") : fallbackFinding("Audit status", "AI analysis unavailable", `The landing-page screenshot could not be analysed: ${message}.`, "Resolve the analysis service issue and rerun the audit.", "Evidence review", "UX findings should be based on observable evidence from the rendered page.");
    return { url, pageTitle: page.title, score: 0, summary: quota ? "The landing-page screenshot was captured, but Gemini quota is currently exhausted. No UX findings were invented." : "The landing-page screenshot could not be analysed. No UX findings were invented.", pages: [{ url, path: new URL(url).pathname || "/", pageTitle: page.title, score: 0, summary: quota ? "Gemini quota reached; screenshot captured successfully." : "Screenshot capture/fetch completed, but AI analysis was unavailable.", screenshotUrl: makeScreenshotUrl(url), findings: [finding] }] };
  } finally { debug("audit:done", { url, ms: Date.now() - started }); }
}
