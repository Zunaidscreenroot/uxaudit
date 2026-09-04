import { URL } from "node:url";

export type Severity = "high" | "medium" | "low";
export type Evidence = { label: string; detail: string; marker: string; x: number; y: number; width: number; height: number };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; screenrootTasks: string[]; devTasks: string[]; uxPerspective: { law: string; definition: string; assessment: string }; evidence: Evidence[] };
export type AuditPage = { url: string; title: string; screenshot: string; screenshotWidth: number; screenshotHeight: number; findings: Finding[] };
export type AuditResult = { pages: AuditPage[] };
type TextRegion = { text: string; x: number; y: number; width: number; height: number };
type GeminiAnalysis = { findings: Finding[]; model: string };

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


const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;
const BROWSERLESS_TIMEOUT_MS = 24000;
const VERIFY_BROWSERLESS_TIMEOUT_MS = 3500;
const GEMINI_ANALYSIS_TIMEOUT_MS = 14000;
const GEMINI_VERIFY_TIMEOUT_MS = 3500;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function normalizeFinding(value: unknown, index: number, imageWidth: number, imageHeight: number, textRegions: TextRegion[]): Finding {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const perspective = (item.uxPerspective && typeof item.uxPerspective === "object" ? item.uxPerspective : {}) as Record<string, unknown>;
  const rawEvidence = Array.isArray(item.evidence) ? item.evidence : [];
  const context = `${String(item.title ?? "")} ${String(item.description ?? "")}`.toLowerCase();
  const resolveAnchor = (anchor: string): TextRegion | null => {
    const needle = anchor.trim().toLowerCase();
    if (!needle) return null;
    const exact = textRegions.find((r) => r.text.toLowerCase() === needle);
    if (exact) return exact;
    const candidates = textRegions.filter((r) => r.text.toLowerCase().includes(needle) || needle.includes(r.text.toLowerCase().slice(0, Math.min(needle.length, 80))));
    return candidates.sort((a, b) => Math.abs(a.text.length - needle.length) - Math.abs(b.text.length - needle.length))[0] ?? null;
  };
  const cluster = (anchor: string): TextRegion[] | null => {
    const target = resolveAnchor(anchor);
    if (!target) return null;
    const cx = target.x + target.width / 2;
    const cy = target.y + target.height / 2;
    const footer = /footer|sitemap|footer links|secondary paths/.test(context);
    const top = /hero|top navigation|upper fold/.test(context);
    const nearby = textRegions.filter((r) => Math.abs(r.x + r.width / 2 - cx) <= 520 && Math.abs(r.y + r.height / 2 - cy) <= 180);
    if (footer) {
      const footerNearby = nearby.filter((r) => r.y + r.height > imageHeight * 0.62);
      return footerNearby.length ? footerNearby : [target];
    }
    if (top) {
      const topNearby = nearby.filter((r) => r.y < imageHeight * 0.38);
      return topNearby.length ? topNearby : [target];
    }
    return nearby.length ? nearby : [target];
  };
  const evidence = rawEvidence.map((raw, evidenceIndex) => {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const anchored = typeof entry.anchor === "string" ? cluster(entry.anchor) : null;
    let x = imageWidth * 0.05, y = imageHeight * 0.05, width = imageWidth * 0.2, height = imageHeight * 0.1;
    if (anchored?.length) {
      const left = Math.min(...anchored.map((r) => r.x));
      const top = Math.min(...anchored.map((r) => r.y));
      const right = Math.max(...anchored.map((r) => r.x + r.width));
      const bottom = Math.max(...anchored.map((r) => r.y + r.height));
      const padX = clamp((right - left) * 0.08, 10, 32);
      const padY = clamp((bottom - top) * 0.2, 8, 24);
      x = clamp(left - padX, 0, imageWidth);
      y = clamp(top - padY, 0, imageHeight);
      width = clamp(right - left + padX * 2, 4, imageWidth - x);
      height = clamp(bottom - top + padY * 2, 4, imageHeight - y);
    } else {
      const box = Array.isArray(entry.box) ? entry.box.map(Number) : [];
      if (box.length === 4 && box.every(Number.isFinite)) {
        const [y1, x1, y2, x2] = box.map((n) => clamp(n, 0, 1000));
        x = x1 / 1000 * imageWidth;
        y = y1 / 1000 * imageHeight;
        width = clamp((x2 - x1) / 1000 * imageWidth, 4, imageWidth - x);
        height = clamp((y2 - y1) / 1000 * imageHeight, 4, imageHeight - y);
      }
    }
    return { label: typeof entry.label === "string" ? entry.label : `Region ${evidenceIndex + 1}`, detail: typeof entry.detail === "string" ? entry.detail : "Visual evidence identified in the screenshot.", marker: typeof entry.marker === "string" ? entry.marker : String(index + 1), x: x / imageWidth * 100, y: y / imageHeight * 100, width: width / imageWidth * 100, height: height / imageHeight * 100 };
  });
  return {
    id: typeof item.id === "string" ? item.id : `finding-${index + 1}`,
    severity: item.severity === "high" || item.severity === "low" ? item.severity : "medium",
    category: typeof item.category === "string" ? item.category : "UX",
    title: typeof item.title === "string" ? item.title : "UX issue",
    description: typeof item.description === "string" ? item.description : "The visual design may create friction for users.",
    recommendation: typeof item.recommendation === "string" ? item.recommendation : "Review this area against established UX principles.",
    screenrootTasks: Array.isArray(item.screenrootTasks) ? item.screenrootTasks.filter((task): task is string => typeof task === "string") : [],
    devTasks: Array.isArray(item.devTasks) ? item.devTasks.filter((task): task is string => typeof task === "string") : [],
    uxPerspective: { law: typeof perspective.law === "string" ? perspective.law : "UX principle", definition: typeof perspective.definition === "string" ? perspective.definition : "A usability principle used to evaluate interface design.", assessment: typeof perspective.assessment === "string" ? perspective.assessment : "This area deserves review based on the visible interface." },
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
    await page.goto(${JSON.stringify(url)}, { waitUntil: "networkidle2", timeout: 20000 });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.evaluate(async () => {
      const step = Math.max(500, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 60)); }
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    const textRegions = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).map(el => {
      const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (!text || text.length > 180 || rect.width < 4 || rect.height < 4 || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || style.position === "fixed" || style.position === "sticky") return null;
      const childText = Array.from(el.children).some(child => (child.textContent || "").replace(/\\s+/g, " ").trim() === text);
      if (childText) return null;
      return { text, x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
    }).filter(Boolean).slice(0, 700));
    const width = 1440;
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 900);
    const screenshot = await page.screenshot({ fullPage: true, type: "png", captureBeyondViewport: true, encoding: "base64" });
    return { screenshot, width, height, textRegions };
  };`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }, body: code, signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT_MS + 1000) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Browserless returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : "."}`); }
  const payload = await response.json() as { screenshot?: string; width?: number; height?: number; textRegions?: TextRegion[] };
  if (!payload.screenshot) throw new Error("Browserless returned no screenshot data.");
  return { buffer: Buffer.from(payload.screenshot, "base64"), width: Number(payload.width) || 1440, height: Number(payload.height) || 900, textRegions: Array.isArray(payload.textRegions) ? payload.textRegions : [] };
}

async function callGemini(apiKey: string, model: string, prompt: string, buffer: Buffer, maxOutputTokens: number, timeoutMs: number): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: buffer.toString("base64") } }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens, thinkingConfig: { thinkingLevel: "low" }, media_resolution: "MEDIA_RESOLUTION_MEDIUM" }
    }),
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
  const anchorList = textRegions.slice(0, 300).map((r) => `${r.text.slice(0, 120)} @ [${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}]`).join("\n");
  const prompt = `You are a senior UX auditor for ScreenRoot. Analyze ONLY the supplied desktop landing-page screenshot for ${url} (title: ${title}). It is one complete full-page image captured at a fixed 1440px desktop viewport, with mobile/responsive emulation disabled. Identify 3 to 6 meaningful, visually evidenced UX issues. Do not infer hidden interactions or inspect source code.

For every finding return severity, category, title, description, recommendation, screenrootTasks, devTasks, uxPerspective (law, definition, assessment), and evidence. Evidence localization is critical. The image may be much taller than one viewport. For text-based evidence, ALWAYS return evidence.anchor as an EXACT visible text snippet from the supplied DOM text-anchor list. The server resolves that anchor to its actual full-page pixel location. Do not return viewport-relative coordinates. For non-text visual evidence, use the closest relevant text anchor when possible; otherwise use box:[ymin,xmin,ymax,xmax] normalized 0-1000 across the ENTIRE image. Keep boxes tight. Never create a footer box spanning the whole footer merely because the issue is footer-related; anchor to the specific relevant link/group. Footer evidence must be in the bottom portion of the full image. Hero evidence must be in the top portion. Banner evidence must cover the actual banner. Use UX laws/principles only when genuinely applicable. Return ONLY valid JSON.

DOM text-anchor list:
${anchorList}

JSON shape: {"findings":[{"id":"finding-1","severity":"medium","category":"...","title":"...","description":"...","recommendation":"...","screenrootTasks":["..."],"devTasks":["..."],"uxPerspective":{"law":"...","definition":"...","assessment":"..."},"evidence":[{"label":"...","detail":"...","marker":"1","anchor":"exact visible text snippet","box":[120,80,280,620]}]}]}`;
  let lastError = "Gemini analysis could not be completed.";
  for (const model of GEMINI_MODELS) {
    try {
      const text = await callGemini(apiKey, model, prompt, buffer, 3000, GEMINI_ANALYSIS_TIMEOUT_MS);
      if (!text) { lastError = `Gemini ${model} returned an empty analysis.`; continue; }
      let json: unknown;
      json = extractJsonObject(text);
      if (!json) { lastError = `Gemini ${model} returned invalid JSON.`; continue; }
      const rawFindings = Array.isArray((json as { findings?: unknown }).findings) ? (json as { findings: unknown[] }).findings : [];
      const findings = rawFindings.map((item: unknown, index: number) => normalizeFinding(item, index, width, height, textRegions));
      if (findings.length) return { findings, model };
      lastError = `Gemini ${model} returned no findings.`;
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
  const boxes = findings.flatMap((finding) => finding.evidence.map((e) => `<div style="position:absolute;left:${e.x}%;top:${e.y}%;width:${e.width}%;height:${e.height}%;border:4px solid #ffd400;background:rgba(255,212,0,.12);box-sizing:border-box;font:700 16px Arial;color:#111;">${e.marker}</div>`)).join("");
  const html = `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}#stage{position:relative;width:${capture.width}px}#stage img{display:block;width:100%;height:auto}#overlay{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}</style></head><body><div id="stage"><img src="data:image/png;base64,${capture.buffer.toString("base64")}"/><div id="overlay">${boxes}</div></div></body></html>`;
  const endpoint = `https://production-sfo.browserless.io/function?token=${encodeURIComponent(token)}&timeout=${VERIFY_BROWSERLESS_TIMEOUT_MS}`;
  const code = `export default async ({ page }) => { await page.setViewport({ width: ${capture.width}, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }); await page.setContent(${JSON.stringify(html)}, { waitUntil: "load", timeout: ${VERIFY_BROWSERLESS_TIMEOUT_MS - 1000} }); await new Promise(resolve => setTimeout(resolve, 100)); return { screenshot: await page.screenshot({ fullPage: true, type: "png", captureBeyondViewport: true, encoding: "base64" }) }; }`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }, body: code, signal: AbortSignal.timeout(VERIFY_BROWSERLESS_TIMEOUT_MS + 1000) });
  if (!response.ok) throw new Error(`Evidence verification screenshot failed with HTTP ${response.status}.`);
  const payload = await response.json() as { screenshot?: string };
  if (!payload.screenshot) throw new Error("Evidence verification screenshot returned no image.");
  return Buffer.from(payload.screenshot, "base64");
}

async function verifyEvidence(capture: { buffer: Buffer; width: number; height: number }, findings: Finding[], model: string): Promise<Finding[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !findings.some((f) => f.evidence.length)) return findings;
  try {
    const verificationScreenshot = await renderEvidenceVerificationScreenshot(capture, findings);
    const regions = findings.flatMap((finding) => finding.evidence.map((e, evidenceIndex) => ({ findingId: finding.id, evidenceIndex, marker: e.marker, label: e.label, detail: e.detail, box: [e.y * 10, e.x * 10, (e.y + e.height) * 10, (e.x + e.width) * 10] })));
    const prompt = `Verify every yellow evidence rectangle in this full-page UX audit screenshot. A rectangle is correct only when it tightly covers the relevant UI described by its label/detail and does not cover unrelated content. Return ONLY JSON: {"verified":true|false,"corrections":[{"findingId":"...","evidenceIndex":0,"box":[ymin,xmin,ymax,xmax]}]}. Coordinates are normalized 0-1000 against the ENTIRE image, never viewport-relative. If all are correct, return verified:true with no corrections. Audit regions:\n${JSON.stringify(regions)}`;
    const text = await callGemini(apiKey, model, prompt, verificationScreenshot, 1600, GEMINI_VERIFY_TIMEOUT_MS);
    let parsed: { verified?: boolean; corrections?: Array<{ findingId?: string; evidenceIndex?: number; box?: unknown }> } = {};
    const recovered = extractJsonObject(text);
    if (recovered && typeof recovered === "object") parsed = recovered as typeof parsed;
    const corrections = Array.isArray(parsed.corrections) ? parsed.corrections : [];
    if (parsed.verified === true || corrections.length === 0) return findings;
    const next = findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((e) => ({ ...e })) }));
    for (const correction of corrections) {
      const evidenceIndex = correction.evidenceIndex;
      if (typeof correction.findingId !== "string" || typeof evidenceIndex !== "number" || !Number.isInteger(evidenceIndex) || !Array.isArray(correction.box) || correction.box.length !== 4) continue;
      const nums = correction.box.map(Number);
      if (!nums.every(Number.isFinite)) continue;
      const [y1, x1, y2, x2] = nums.map((n) => clamp(n, 0, 1000));
      const finding = next.find((f) => f.id === correction.findingId);
      if (!finding || evidenceIndex < 0 || evidenceIndex >= finding.evidence.length || x2 <= x1 || y2 <= y1) continue;
      const evidence = finding.evidence[evidenceIndex];
      evidence.x = x1 / 10;
      evidence.y = y1 / 10;
      evidence.width = (x2 - x1) / 10;
      evidence.height = (y2 - y1) / 10;
    }
    return next;
  } catch (error) {
    console.warn("Evidence verification skipped", error);
    return findings;
  }
}

export async function createAudit(url: string): Promise<AuditResult> {
  const capture = await captureScreenshot(url);
  const title = new URL(url).hostname;
  const analysis = await analyseWithGemini(url, title, capture);
  const findings = await verifyEvidence(capture, analysis.findings, analysis.model);
  return { pages: [{ url, title, screenshot: `data:image/png;base64,${capture.buffer.toString("base64")}`, screenshotWidth: capture.width, screenshotHeight: capture.height, findings }] };
}
