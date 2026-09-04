import { URL } from "node:url";

export type Severity = "high" | "medium" | "low";
export type Evidence = { label: string; detail: string; marker: string; x: number; y: number; width: number; height: number };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; screenrootTasks: string[]; devTasks: string[]; uxPerspective: { law: string; definition: string; assessment: string }; evidence: Evidence[] };
export type AuditPage = { url: string; title: string; screenshot: string; screenshotWidth: number; screenshotHeight: number; findings: Finding[] };
export type AuditResult = { pages: AuditPage[] };
type TextRegion = { text: string; x: number; y: number; width: number; height: number };
type GeminiAnalysis = { findings: Finding[]; model: string };

const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;
const AUDIT_CATEGORIES = ["Language & tone", "Navigation", "Information hierarchy", "Visual design", "Usability & interaction", "Responsiveness", "User engagement", "Web performance"] as const;
const BROWSERLESS_TIMEOUT_MS = 24000;
const VERIFY_BROWSERLESS_TIMEOUT_MS = 3000;
const GEMINI_ANALYSIS_TIMEOUT_MS = 14000;
const GEMINI_VERIFY_TIMEOUT_MS = 3000;
const MAX_EVIDENCE_VERIFICATION_PASSES = 3;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function normalizeFinding(value: unknown, index: number, imageWidth: number, imageHeight: number, textRegions: TextRegion[]): Finding {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const perspective = (item.uxPerspective && typeof item.uxPerspective === "object" ? item.uxPerspective : {}) as Record<string, unknown>;
  const rawEvidence = Array.isArray(item.evidence) ? item.evidence : [];
  const resolveAnchor = (anchor: string): TextRegion | null => {
    const needle = anchor.trim().toLowerCase();
    if (!needle) return null;
    const exact = textRegions.find((r) => r.text.toLowerCase() === needle);
    if (exact) return exact;
    const candidates = textRegions.filter((r) => r.text.toLowerCase().includes(needle) || needle.includes(r.text.toLowerCase()));
    return candidates.sort((a, b) => Math.abs(a.text.length - needle.length) - Math.abs(b.text.length - needle.length))[0] ?? null;
  };
  const evidence = rawEvidence.map((raw, evidenceIndex) => {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    let x = imageWidth * 0.05, y = imageHeight * 0.05, width = imageWidth * 0.2, height = imageHeight * 0.08;
    const anchor = typeof entry.anchor === "string" ? resolveAnchor(entry.anchor) : null;
    if (anchor) {
      const padX = clamp(anchor.width * 0.14, 8, 28);
      const padY = clamp(anchor.height * 0.35, 6, 20);
      x = clamp(anchor.x - padX, 0, imageWidth);
      y = clamp(anchor.y - padY, 0, imageHeight);
      width = clamp(anchor.width + padX * 2, 12, imageWidth - x);
      height = clamp(anchor.height + padY * 2, 12, imageHeight - y);
    } else {
      const box = Array.isArray(entry.box) ? entry.box.map(Number) : [];
      if (box.length === 4 && box.every(Number.isFinite)) {
        const [y1, x1, y2, x2] = box.map((n) => clamp(n, 0, 1000));
        x = x1 / 1000 * imageWidth;
        y = y1 / 1000 * imageHeight;
        width = clamp((x2 - x1) / 1000 * imageWidth, 12, imageWidth - x);
        height = clamp((y2 - y1) / 1000 * imageHeight, 12, imageHeight - y);
      }
    }
    return { label: typeof entry.label === "string" ? entry.label : `Region ${evidenceIndex + 1}`, detail: typeof entry.detail === "string" ? entry.detail : "Visual evidence identified in the screenshot.", marker: typeof entry.marker === "string" ? entry.marker : String(evidenceIndex + 1), x: x / imageWidth * 100, y: y / imageHeight * 100, width: width / imageWidth * 100, height: height / imageHeight * 100 };
  });
  const requestedCategory = typeof item.category === "string" ? item.category : "Visual design";
  const category = AUDIT_CATEGORIES.find((candidate) => candidate.toLowerCase() === requestedCategory.trim().toLowerCase()) ?? "Visual design";
  return {
    id: typeof item.id === "string" ? item.id : `finding-${index + 1}`,
    severity: item.severity === "high" || item.severity === "low" ? item.severity : "medium",
    category,
    title: typeof item.title === "string" ? item.title : "UX issue",
    description: typeof item.description === "string" ? item.description : "The visible interface may create friction for users.",
    recommendation: typeof item.recommendation === "string" ? item.recommendation : "Review this area against established UX principles.",
    screenrootTasks: Array.isArray(item.screenrootTasks) ? item.screenrootTasks.filter((task): task is string => typeof task === "string") : [],
    devTasks: Array.isArray(item.devTasks) ? item.devTasks.filter((task): task is string => typeof task === "string") : [],
    uxPerspective: { law: typeof perspective.law === "string" ? perspective.law : "UX principle", definition: typeof perspective.definition === "string" ? perspective.definition : "A usability principle used to evaluate interface design.", assessment: typeof perspective.assessment === "string" ? perspective.assessment : "This visible area deserves review based on the supplied screenshot." },
    evidence
  };
}

async function captureScreenshot(url: string): Promise<{ buffer: Buffer; width: number; height: number; textRegions: TextRegion[] }> {
  const token = process.env.BROWSERLESS_API_TOKEN;
  if (!token) throw new Error("BROWSERLESS_API_TOKEN is not configured on this deployment.");
  const endpoint = `https://production-sfo.browserless.io/function?token=${encodeURIComponent(token)}&timeout=${BROWSERLESS_TIMEOUT_MS}`;
  const code = `export default async ({ page }) => {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.emulateMediaType("screen");
    try {
      await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded", timeout: 10000 });
    } catch (error) {
      console.warn("Navigation timeout; continuing with the rendered document", error);
    }
    if (!await page.evaluate(() => !!document.body)) throw new Error("Browserless loaded no document body.");
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}html{scroll-behavior:auto!important}" }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1400));
    await page.evaluate(async () => {
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      document.querySelectorAll("img[loading=lazy]").forEach(img => img.setAttribute("loading", "eager"));
      document.querySelectorAll("img").forEach(img => img.setAttribute("fetchpriority", "high"));
      const scrollHeight = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const step = Math.max(600, Math.floor(window.innerHeight * 0.72));
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y <= scrollHeight(); y += step) { window.scrollTo(0, y); await wait(180); }
        window.scrollTo(0, scrollHeight());
        await wait(600);
      }
      const images = Array.from(document.images);
      await Promise.all(images.map(async img => {
        try { if (!img.complete) await new Promise(resolve => { img.addEventListener("load", resolve, { once:true }); img.addEventListener("error", resolve, { once:true }); }); await img.decode?.(); } catch {}
      }));
      await wait(700);
      window.scrollTo(0, 0);
      await wait(500);
    });
    const textRegions = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).map(el => {
      const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (!text || text.length > 180 || rect.width < 4 || rect.height < 4 || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || style.position === "fixed" || style.position === "sticky") return null;
      const childText = Array.from(el.children).some(child => (child.textContent || "").replace(/\\s+/g, " ").trim() === text);
      if (childText) return null;
      return { text, x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
    }).filter(Boolean).slice(0, 900));
    const width = 1440;
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 900);
    const screenshot = await page.screenshot({ fullPage: true, type: "png", captureBeyondViewport: true, encoding: "base64" });
    return { screenshot, width, height, textRegions };
  };`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }, body: code, signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT_MS + 1000) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Browserless returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : "."}`); }
  const payload = await response.json() as { screenshot?: string; width?: number; height?: number; textRegions?: TextRegion[] };
  if (!payload.screenshot) throw new Error("Browserless returned no screenshot data.");
  const buffer = Buffer.from(payload.screenshot, "base64");
  return { buffer, width: Number(payload.width) || 1440, height: Number(payload.height) || 900, textRegions: Array.isArray(payload.textRegions) ? payload.textRegions : [] };
}

async function callGemini(apiKey: string, model: string, prompt: string, buffer: Buffer, maxOutputTokens: number, timeoutMs: number): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: buffer.toString("base64") } }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens, thinkingConfig: { thinkingLevel: "low" }, media_resolution: "MEDIA_RESOLUTION_MEDIUM" } }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const detail = await response.text();
  if (!response.ok) { let message = `Gemini ${model} returned HTTP ${response.status}.`; try { message = JSON.parse(detail)?.error?.message || message; } catch {} throw new Error(message); }
  const parsed = JSON.parse(detail) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return parsed.candidates?.[0]?.content?.parts?.map((part) => typeof part.text === "string" ? part.text : "").join("") || "";
}

async function analyseWithGemini(url: string, title: string, capture: { buffer: Buffer; width: number; height: number; textRegions: TextRegion[] }): Promise<GeminiAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on this deployment.");
  const { width, height, buffer, textRegions } = capture;
  const anchorList = textRegions.slice(0, 420).map((r) => `${r.text.slice(0, 140)} @ [${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}]`).join("\n");
  const prompt = `You are a senior UX auditor for ScreenRoot. Analyze ONLY the supplied complete desktop landing-page screenshot for ${url}. Do not infer hidden interactions, source-code behavior, analytics, or performance metrics that are not visibly evidenced. The screenshot is one native 1440px desktop capture and may be several thousand pixels tall.

Use ONLY these assessment categories: ${AUDIT_CATEGORIES.join(", ")}.
Return ONLY HIGH-priority findings. Ignore medium and low issues completely. A high finding must represent substantial user friction or risk and must be directly visible in the screenshot. Aim for 1 to 5 strong findings rather than padding the report. Do not force every category to appear. In particular, do not claim Web performance or Responsiveness from a single desktop screenshot unless the visible screenshot itself contains direct evidence; otherwise omit them.

For each finding return severity="high", one exact category from the allowed list, title, description, recommendation, screenrootTasks, devTasks, uxPerspective (law, definition, assessment), and evidence. Evidence localization is critical. For text evidence, ALWAYS choose evidence.anchor as an EXACT visible text snippet from the supplied DOM text-anchor list. The server resolves that exact anchor to full-page pixels. Never use viewport-relative coordinates. For non-text evidence, use box:[ymin,xmin,ymax,xmax] normalized 0-1000 across the ENTIRE screenshot. Keep each box tight around the actual offending UI, not the whole section. Never use a generic large region.

DOM text-anchor list:
${anchorList}

JSON shape: {"findings":[{"id":"finding-1","severity":"high","category":"Usability & interaction","title":"...","description":"...","recommendation":"...","screenrootTasks":["..."],"devTasks":["..."],"uxPerspective":{"law":"...","definition":"...","assessment":"..."},"evidence":[{"label":"...","detail":"...","marker":"1","anchor":"exact visible text snippet","box":[120,80,220,320]}]}]}`;
  let lastError = "Gemini analysis could not be completed.";
  for (const model of GEMINI_MODELS) {
    try {
      const text = await callGemini(apiKey, model, prompt, buffer, 3000, GEMINI_ANALYSIS_TIMEOUT_MS);
      const json = extractJsonObject(text);
      if (!json) { lastError = `Gemini ${model} returned invalid JSON.`; continue; }
      const rawFindings = Array.isArray((json as { findings?: unknown }).findings) ? (json as { findings: unknown[] }).findings : [];
      const findings = rawFindings.map((item: unknown, index: number) => normalizeFinding(item, index, width, height, textRegions)).filter((finding) => finding.severity === "high" && finding.evidence.length > 0);
      if (findings.length) return { findings, model };
      lastError = `Gemini ${model} returned no high-priority findings with evidence.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : `Gemini ${model} failed.`;
      console.warn("Gemini model failed", model, lastError);
    }
  }
  throw new Error(`All Gemini fallback models failed. Last error: ${lastError}`);
}

async function renderEvidenceVerificationScreenshot(capture: { buffer: Buffer; width: number; height: number }, findings: Finding[]): Promise<Buffer> {
  const token = process.env.BROWSERLESS_API_TOKEN;
  if (!token) throw new Error("BROWSERLESS_API_TOKEN is not configured on this deployment.");
  const boxes = findings.flatMap((finding) => finding.evidence.map((e) => `<div style="position:absolute;left:${e.x}%;top:${e.y}%;width:${e.width}%;height:${e.height}%;border:5px solid #ffd400;background:rgba(255,212,0,.10);box-sizing:border-box;font:700 18px Arial;color:#111;z-index:3"><span style="position:absolute;left:-3px;top:-30px;min-width:28px;height:28px;padding:4px 7px;border:2px solid #111;border-radius:999px;background:#ffd400;line-height:16px;text-align:center">${e.marker}</span></div>`)).join("");
  const html = `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}#stage{position:relative;width:${capture.width}px;height:${capture.height}px;overflow:hidden}#stage img{display:block;position:absolute;left:0;top:0;width:${capture.width}px;height:${capture.height}px;max-width:none;object-fit:fill}#overlay{position:absolute;left:0;top:0;width:${capture.width}px;height:${capture.height}px;pointer-events:none;z-index:2}</style></head><body><div id="stage"><img src="data:image/png;base64,${capture.buffer.toString("base64")}"/><div id="overlay">${boxes}</div></div></body></html>`;
  const endpoint = `https://production-sfo.browserless.io/function?token=${encodeURIComponent(token)}&timeout=${VERIFY_BROWSERLESS_TIMEOUT_MS}`;
  const code = `export default async ({ page }) => { await page.setViewport({ width: ${capture.width}, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }); await page.setContent(${JSON.stringify(html)}, { waitUntil: "load", timeout: ${VERIFY_BROWSERLESS_TIMEOUT_MS - 800} }); await new Promise(resolve => setTimeout(resolve, 120)); return { screenshot: await page.screenshot({ fullPage: true, type: "png", captureBeyondViewport: true, encoding: "base64" }) }; }`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }, body: code, signal: AbortSignal.timeout(VERIFY_BROWSERLESS_TIMEOUT_MS + 1000) });
  if (!response.ok) throw new Error(`Evidence verification screenshot failed with HTTP ${response.status}.`);
  const payload = await response.json() as { screenshot?: string };
  if (!payload.screenshot) throw new Error("Evidence verification screenshot returned no image.");
  return Buffer.from(payload.screenshot, "base64");
}

async function verifyEvidence(capture: { buffer: Buffer; width: number; height: number }, findings: Finding[], model: string): Promise<{ findings: Finding[]; annotated: Buffer }> {
  const apiKey = process.env.GEMINI_API_KEY;
  let current = findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((e) => ({ ...e })) }));
  let annotated = await renderEvidenceVerificationScreenshot(capture, current);
  if (!apiKey || !current.some((f) => f.evidence.length)) return { findings: current, annotated };

  for (let pass = 1; pass <= MAX_EVIDENCE_VERIFICATION_PASSES; pass++) {
    try {
      const regions = current.flatMap((finding) => finding.evidence.map((e, evidenceIndex) => ({ findingId: finding.id, evidenceIndex, marker: e.marker, label: e.label, detail: e.detail, box: [e.y * 10, e.x * 10, (e.y + e.height) * 10, (e.x + e.width) * 10] })));
      const prompt = `You are the final evidence verifier for a UX audit. Inspect the supplied full-page screenshot with yellow numbered rectangles. Verify EVERY rectangle. It is correct only if it tightly covers the exact UI described by its label/detail and does not cover unrelated UI. Return ONLY JSON. If every rectangle is correct, return {"verified":true,"corrections":[]}. If any rectangle is wrong, return verified:false and one correction for each wrong rectangle using box:[ymin,xmin,ymax,xmax] normalized 0-1000 against the ENTIRE screenshot. Keep corrected boxes tight. Do not invent new findings or change finding text.\n\nAudit regions:\n${JSON.stringify(regions)}`;
      const text = await callGemini(apiKey, model, prompt, annotated, 1400, GEMINI_VERIFY_TIMEOUT_MS);
      const parsed = extractJsonObject(text) as { verified?: boolean; corrections?: Array<{ findingId?: string; evidenceIndex?: number; box?: unknown }> } | null;
      const corrections = Array.isArray(parsed?.corrections) ? parsed.corrections : [];
      if (parsed?.verified === true || corrections.length === 0) return { findings: current, annotated };
      for (const correction of corrections) {
        const evidenceIndex = correction.evidenceIndex;
        if (typeof correction.findingId !== "string" || typeof evidenceIndex !== "number" || !Number.isInteger(evidenceIndex) || !Array.isArray(correction.box) || correction.box.length !== 4) continue;
        const nums = correction.box.map(Number);
        if (!nums.every(Number.isFinite)) continue;
        const [y1, x1, y2, x2] = nums.map((n) => clamp(n, 0, 1000));
        const finding = current.find((f) => f.id === correction.findingId);
        if (!finding || evidenceIndex < 0 || evidenceIndex >= finding.evidence.length || x2 <= x1 || y2 <= y1) continue;
        const evidence = finding.evidence[evidenceIndex];
        evidence.x = x1 / 10;
        evidence.y = y1 / 10;
        evidence.width = (x2 - x1) / 10;
        evidence.height = (y2 - y1) / 10;
      }
      annotated = await renderEvidenceVerificationScreenshot(capture, current);
      if (pass === MAX_EVIDENCE_VERIFICATION_PASSES) return { findings: current, annotated };
    } catch (error) {
      console.warn("Evidence verification skipped", error);
      return { findings: current, annotated };
    }
  }
  return { findings: current, annotated };
}

export async function createAudit(url: string): Promise<AuditResult> {
  const capture = await captureScreenshot(url);
  const title = new URL(url).hostname;
  const analysis = await analyseWithGemini(url, title, capture);
  const verified = await verifyEvidence(capture, analysis.findings, analysis.model);
  return { pages: [{ url, title, screenshot: `data:image/png;base64,${verified.annotated.toString("base64")}`, screenshotWidth: capture.width, screenshotHeight: capture.height, findings: verified.findings }] };
}
