export type Severity = "high" | "medium" | "low";

export type Evidence = {
  label: string;
  detail: string;
  marker: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Finding = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  recommendation: string;
  screenrootTasks: string[];
  devTasks: string[];
  uxPerspective: { law: string; definition: string; assessment: string };
  evidence: Evidence[];
};

export type AuditPage = { url: string; path: string; pageTitle: string; score: number; summary: string; screenshotUrl: string; findings: Finding[] };
export type AuditResult = { url: string; pageTitle: string; score: number; summary: string; pages: AuditPage[] };

const MAX_PAGES = 8;
const MAX_HTML_CHARS = 45000;
const GEMINI_MODEL = "gemini-2.5-flash";

function stripTags(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function makeScreenshotUrl(url: string) { return `https://image.thum.io/get/width/1440/crop/1200/${encodeURIComponent(url)}`; }

function absoluteSameDomainLinks(html: string, baseUrl: string) {
  const base = new URL(baseUrl); const links = new Set<string>();
  const matches = Array.from(html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi));
  for (const match of matches) {
    const href = match[1].trim();
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try { const url = new URL(href, base); url.hash = ""; if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === base.hostname) links.add(url.toString()); } catch { /* ignore */ }
  }
  return Array.from(links);
}

async function fetchPage(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "ScreenRoot-UX-Audit/2.0" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Website returned ${response.status}`);
  const html = await response.text();
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url).slice(0, 120) || url;
  return { html, title };
}
function parseJson(text: string) { const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim(); const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("Gemini returned invalid JSON."); return JSON.parse(cleaned.slice(start, end + 1)); }
function fallbackFinding(category: string, title: string, description: string, recommendation: string, law: string, definition: string): Finding { return { id: `fallback-${Date.now()}`, severity: "low", category, title, description, recommendation, screenrootTasks: ["Review the rendered experience and validate the issue with representative user tasks."], devTasks: ["Verify the implementation against the intended UX behavior and accessibility requirements."], uxPerspective: { law, definition, assessment: "No definitive violation can be confirmed from markup alone; validate the rendered interface and user behavior." }, evidence: [{ label: "Page overview", detail: "Limited first-pass evidence", marker: 1, x: 5, y: 5, width: 90, height: 88 }] }; }
function normaliseFinding(raw: any, index: number): Finding { const evidence = Array.isArray(raw?.evidence) ? raw.evidence : []; return { id: String(raw?.id || `finding-${index + 1}`), severity: raw?.severity === "high" || raw?.severity === "medium" ? raw.severity : "low", category: String(raw?.category || "Overall UX"), title: String(raw?.title || "UX issue"), description: String(raw?.description || ""), recommendation: String(raw?.recommendation || "Validate and improve the experience."), screenrootTasks: Array.isArray(raw?.screenrootTasks) ? raw.screenrootTasks.map(String).slice(0, 5) : [], devTasks: Array.isArray(raw?.devTasks) ? raw.devTasks.map(String).slice(0, 5) : [], uxPerspective: { law: String(raw?.uxPerspective?.law || "Evidence review"), definition: String(raw?.uxPerspective?.definition || "A UX principle or accessibility requirement used to interpret the evidence."), assessment: String(raw?.uxPerspective?.assessment || "Potential issue; confirm through rendered inspection or user testing.") }, evidence: evidence.slice(0, 4).map((item: any, i: number) => ({ label: String(item?.label || "Evidence"), detail: String(item?.detail || ""), marker: Number(item?.marker || i + 1), x: Math.max(0, Math.min(95, Number(item?.x ?? 5))), y: Math.max(0, Math.min(95, Number(item?.y ?? 5))), width: Math.max(2, Math.min(95, Number(item?.width ?? 20))), height: Math.max(2, Math.min(95, Number(item?.height ?? 10))) })) }; }

async function analyseWithGemini(url: string, title: string, html: string): Promise<{ score: number; summary: string; findings: Finding[] }> {
  const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const prompt = `You are a senior UX auditor for ScreenRoot. Analyse one webpage using the supplied URL, title and HTML. Return ONLY valid JSON.
Rules: Evidence must be grounded in supplied markup/text. Never invent visible UI. Treat UX laws, heuristics and WCAG as interpretive frameworks, not proof. Use "Potential violation" unless evidence directly establishes a requirement failure. Prefer specific findings. Use relevant laws such as Hick's Law, Fitts's Law, Jakob's Law, Miller's Law, Tesler's Law, Doherty Threshold, Peak-End Rule, Aesthetic-Usability Effect, Zeigarnik Effect, Von Restorff Effect, Gestalt principles, Nielsen heuristics, or WCAG when appropriate; do not force a law. Evidence coordinates are approximate percentage boxes on a 1440px screenshot; use plausible x/y/width/height between 0 and 100. Score 0-100 based on severity and breadth. Return 3-8 high-value findings when evidence supports them.
JSON: {"score":number,"summary":string,"findings":[{"id":string,"severity":"high|medium|low","category":string,"title":string,"description":string,"recommendation":string,"screenrootTasks":string[],"devTasks":string[],"uxPerspective":{"law":string,"definition":string,"assessment":string},"evidence":[{"label":string,"detail":string,"marker":number,"x":number,"y":number,"width":number,"height":number}]}]}
URL: ${url}\nTITLE: ${title}\nHTML/TEXT:\n${html.slice(0, MAX_HTML_CHARS)}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
  const data = await response.json(); const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || ""; const parsed = parseJson(text);
  return { score: Math.max(0, Math.min(100, Number(parsed.score) || 0)), summary: String(parsed.summary || ""), findings: (Array.isArray(parsed.findings) ? parsed.findings : []).map(normaliseFinding) };
}

export async function createAudit(url: string): Promise<AuditResult> {
  const root = new URL(url); const discovered = new Set<string>([root.toString()]); const pages: AuditPage[] = []; let firstTitle = root.hostname;
  let cursor = 0;
  while (cursor < Math.min(discovered.size, MAX_PAGES)) {
    const pageUrl = Array.from(discovered)[cursor++];
    try {
      const page = await fetchPage(pageUrl); if (cursor === 1) firstTitle = page.title;
      for (const link of absoluteSameDomainLinks(page.html, pageUrl)) { if (discovered.size >= MAX_PAGES) break; discovered.add(link); }
      let analysis;
      try { analysis = await analyseWithGemini(pageUrl, page.title, page.html); } catch (error) { analysis = { score: 60, summary: `Gemini analysis was unavailable (${error instanceof Error ? error.message : "unknown error"}).`, findings: [fallbackFinding("Audit status", "AI analysis unavailable", "The page was fetched successfully, but AI analysis could not be completed.", "Configure GEMINI_API_KEY and rerun the audit.", "Evidence review", "A finding should be supported by observable page evidence before it is treated as a confirmed issue.")] }; }
      pages.push({ url: pageUrl, path: new URL(pageUrl).pathname || "/", pageTitle: page.title, score: analysis.score, summary: analysis.summary, screenshotUrl: makeScreenshotUrl(pageUrl), findings: analysis.findings });
    } catch (error) { pages.push({ url: pageUrl, path: new URL(pageUrl).pathname || "/", pageTitle: pageUrl, score: 0, summary: `Could not fetch this page: ${error instanceof Error ? error.message : "unknown error"}.`, screenshotUrl: makeScreenshotUrl(pageUrl), findings: [fallbackFinding("Crawl", "Page could not be fetched", "The crawler could not retrieve this page, so no UX conclusion is made.", "Check the page availability and rerun the audit.", "Evidence review", "UX findings should be based on observable evidence from the page.")] }); }
  }
  if (pages.length === 0) throw new Error("Unable to fetch the website.");
  const usable = pages.filter((page) => page.score > 0); const score = Math.round(usable.reduce((sum, page) => sum + page.score, 0) / Math.max(usable.length, 1));
  return { url, pageTitle: firstTitle, score, summary: `Audited ${pages.length} same-domain page${pages.length === 1 ? "" : "s"}. Each page is analysed separately and capped at ${MAX_PAGES} pages per run.`, pages };
}
