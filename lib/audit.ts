import { URL } from "node:url";
import sharp from "sharp";
import { AUDIT_CATEGORIES, GEMINI_MODELS, buildAuditPrompt, buildRegionVerificationPrompt } from "./gemini";

export type Severity = "high" | "medium" | "low";
export type Evidence = { label: string; detail: string; marker: string; x: number; y: number; width: number; height: number };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; screenrootTasks: string[]; devTasks: string[]; uxPerspective: { law: string; definition: string; assessment: string }; evidence: Evidence[] };
export type AuditPage = { url: string; title: string; screenshot: string; screenshotWidth: number; screenshotHeight: number; findings: Finding[] };
export type AuditResult = { pages: AuditPage[] };
export type AuditStage = { id: string; label: string; detail: string; status: "active" | "complete" };
type Capture = { buffer: Buffer; width: number; height: number };
type RegionBox = [number, number, number, number];
type VerificationResult = { correct: boolean; regions: Array<{ findingId: string; evidenceIndex: number; box: RegionBox }>; notes: string };

const BROWSERLESS_TIMEOUT_MS = 26000;
const GEMINI_ANALYSIS_TIMEOUT_MS = 12000;
const GEMINI_VERIFY_TIMEOUT_MS = 4000;
const MAX_EVIDENCE_VERIFICATION_PASSES = 3;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

function normalizeBox(raw: unknown): RegionBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const values = raw.map(Number);
  if (!values.every(Number.isFinite)) return null;
  let [y1, x1, y2, x2] = values.map((n) => clamp(n, 0, 1000));
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  if (x2 - x1 < 8) x2 = clamp(x1 + 8, 0, 1000);
  if (y2 - y1 < 8) y2 = clamp(y1 + 8, 0, 1000);
  return [y1, x1, y2, x2];
}

function normalizeFinding(value: unknown, index: number): Finding {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const perspective = (item.uxPerspective && typeof item.uxPerspective === "object" ? item.uxPerspective : {}) as Record<string, unknown>;
  const rawEvidence = Array.isArray(item.evidence) ? item.evidence : [];
  const evidence = rawEvidence.slice(0, 3).map((raw, evidenceIndex) => {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const box = normalizeBox(entry.box) ?? [50, 50, 180, 300];
    const [y1, x1, y2, x2] = box;
    return { label: typeof entry.label === "string" ? entry.label : `Region ${evidenceIndex + 1}`, detail: typeof entry.detail === "string" ? entry.detail : "Visible evidence identified in the screenshot.", marker: typeof entry.marker === "string" ? entry.marker : String(evidenceIndex + 1), x: x1 / 10, y: y1 / 10, width: Math.max(0.8, (x2 - x1) / 10), height: Math.max(0.8, (y2 - y1) / 10) };
  });
  const requestedCategory = typeof item.category === "string" ? item.category.trim().toLowerCase() : "visual design";
  const category = AUDIT_CATEGORIES.find((candidate) => candidate.toLowerCase() === requestedCategory) ?? "Visual design";
  return { id: typeof item.id === "string" ? item.id : `finding-${index + 1}`, severity: item.severity === "high" ? "high" : "medium", category, title: typeof item.title === "string" ? item.title : "UX issue", description: typeof item.description === "string" ? item.description : "The visible interface may create friction for users.", recommendation: typeof item.recommendation === "string" ? item.recommendation : "Review this area against established UX principles.", screenrootTasks: Array.isArray(item.screenrootTasks) ? item.screenrootTasks.filter((task): task is string => typeof task === "string") : [], devTasks: Array.isArray(item.devTasks) ? item.devTasks.filter((task): task is string => typeof task === "string") : [], uxPerspective: { law: typeof perspective.law === "string" ? perspective.law : "UX principle", definition: typeof perspective.definition === "string" ? perspective.definition : "A usability principle used to evaluate interface design.", assessment: typeof perspective.assessment === "string" ? perspective.assessment : "This visible area deserves review based on the supplied screenshot." }, evidence };
}

async function captureScreenshot(url: string): Promise<Capture> {
  const token = process.env.BROWSERLESS_API_TOKEN;
  if (!token) throw new Error("BROWSERLESS_API_TOKEN is not configured on this deployment.");
  const endpoint = `https://production-sfo.browserless.io/function?token=${encodeURIComponent(token)}&timeout=${BROWSERLESS_TIMEOUT_MS}`;
  const code = `export default async ({ page }) => {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.emulateMediaType("screen");
    try { await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded", timeout: 9000 }); } catch (error) { console.warn("Navigation did not finish before the navigation budget; capturing the rendered page", error); }
    if (!await page.evaluate(() => !!document.body)) throw new Error("Browserless loaded no document body.");
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}html{scroll-behavior:auto!important}" }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 900));
    await page.evaluate(async () => {
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      document.documentElement.style.scrollBehavior = "auto";
      document.querySelectorAll("img[loading=lazy]").forEach(img => img.setAttribute("loading", "eager"));
      document.querySelectorAll("img").forEach(img => img.setAttribute("fetchpriority", "high"));
      const scrollHeight = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const step = Math.max(800, Math.floor(window.innerHeight * 0.9));
      for (let y = 0; y <= scrollHeight(); y += step) { window.scrollTo(0, y); await wait(120); }
      window.scrollTo(0, scrollHeight()); await wait(700); window.scrollTo(0, 0); await wait(350);
    });
    const width = 1440;
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 900);
    const screenshot = await page.screenshot({ fullPage: true, type: "png", captureBeyondViewport: true, encoding: "base64" });
    return { screenshot, width, height };
  };`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }, body: code, signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT_MS + 1000) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Browserless returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : "."}`); }
  const payload = await response.json() as { screenshot?: string; width?: number; height?: number };
  if (!payload.screenshot) throw new Error("Browserless returned no screenshot data.");
  const buffer = Buffer.from(payload.screenshot, "base64");
  const metadata = await sharp(buffer).metadata();
  return { buffer, width: Number(payload.width) || metadata.width || 1440, height: Number(payload.height) || metadata.height || 900 };
}

async function callGemini(apiKey: string, model: string, prompt: string, images: Buffer[], maxOutputTokens: number, timeoutMs: number): Promise<string> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const image of images) parts.push({ inlineData: { mimeType: "image/png", data: image.toString("base64") } });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens, thinkingConfig: { thinkingLevel: "low" }, media_resolution: "MEDIA_RESOLUTION_MEDIUM" } }), signal: AbortSignal.timeout(timeoutMs) });
  const detail = await response.text();
  if (!response.ok) { let message = `Gemini ${model} returned HTTP ${response.status}.`; try { message = JSON.parse(detail)?.error?.message || message; } catch {} throw new Error(message); }
  const parsed = JSON.parse(detail) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return parsed.candidates?.[0]?.content?.parts?.map((part) => typeof part.text === "string" ? part.text : "").join("") || "";
}

async function analyseWithGemini(url: string, capture: Capture): Promise<{ findings: Finding[]; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on this deployment.");
  const prompt = buildAuditPrompt(url, capture.width, capture.height);
  let lastError = "Gemini analysis could not be completed.";
  for (const model of GEMINI_MODELS) {
    try {
      const text = await callGemini(apiKey, model, prompt, [capture.buffer], 2800, GEMINI_ANALYSIS_TIMEOUT_MS);
      const json = extractJsonObject(text) as { findings?: unknown[] } | null;
      if (!json || !Array.isArray(json.findings)) { lastError = `Gemini ${model} returned invalid audit JSON.`; continue; }
      const findings = json.findings.map((item, index) => normalizeFinding(item, index)).filter((finding) => finding.severity === "high" && finding.evidence.length > 0).slice(0, 5);
      return { findings, model };
    } catch (error) { lastError = error instanceof Error ? error.message : lastError; }
  }
  throw new Error(`All Gemini fallback models failed. Last error: ${lastError}`);
}

function escapeXml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
function buildRegionSvg(width: number, height: number, findings: Finding[]): Buffer { const elements = findings.flatMap((finding) => finding.evidence.map((e) => { const x = clamp(e.x / 100 * width, 0, width - 1), y = clamp(e.y / 100 * height, 0, height - 1); const w = clamp(e.width / 100 * width, 8, width - x), h = clamp(e.height / 100 * height, 8, height - y); const markerW = 34, markerH = 34, markerX = x, markerY = Math.max(0, y - markerH - 4); return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#ffd400" fill-opacity="0.12" stroke="#ffd400" stroke-width="5"/><rect x="${markerX}" y="${markerY}" width="${markerW}" height="${markerH}" rx="17" fill="#ffd400" stroke="#111" stroke-width="2"/><text x="${markerX + markerW / 2}" y="${markerY + 23}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111">${escapeXml(e.marker)}</text>`; })).join(""); return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements}</svg>`); }
async function renderRegions(mainImage: Buffer, width: number, height: number, findings: Finding[]): Promise<Buffer> { if (!findings.some((finding) => finding.evidence.length)) return mainImage; return sharp(mainImage).composite([{ input: buildRegionSvg(width, height, findings), left: 0, top: 0, blend: "over" }]).png().toBuffer(); }
function flattenRegions(findings: Finding[]) { return findings.flatMap((finding) => finding.evidence.map((e, evidenceIndex) => ({ findingId: finding.id, evidenceIndex, finding: { category: finding.category, title: finding.title, description: finding.description, assessment: finding.uxPerspective.assessment }, evidence: { label: e.label, detail: e.detail }, box: [e.y * 10, e.x * 10, (e.y + e.height) * 10, (e.x + e.width) * 10] as RegionBox }))); }
function applyVerificationBoxes(findings: Finding[], regions: VerificationResult["regions"]): Finding[] { const next = findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((e) => ({ ...e })) })); for (const region of regions) { const finding = next.find((item) => item.id === region.findingId), evidence = finding?.evidence[region.evidenceIndex], box = normalizeBox(region.box); if (!evidence || !box) continue; const [y1, x1, y2, x2] = box; evidence.x = x1 / 10; evidence.y = y1 / 10; evidence.width = (x2 - x1) / 10; evidence.height = (y2 - y1) / 10; } return next; }

async function verifyAndCorrectRegions(capture: Capture, findings: Finding[], model: string, onStage?: (stage: AuditStage) => void): Promise<{ findings: Finding[]; annotated: Buffer }> {
  const apiKey = process.env.GEMINI_API_KEY;
  let current = findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((e) => ({ ...e })) }));
  let annotated = await renderRegions(capture.buffer, capture.width, capture.height, current);
  if (!apiKey || !current.some((finding) => finding.evidence.length)) return { findings: current, annotated };
  for (let pass = 1; pass <= MAX_EVIDENCE_VERIFICATION_PASSES; pass++) {
    onStage?.({ id: "verify", label: `Analysing highlighted regions${pass > 1 ? ` (correction pass ${pass})` : ""}`, detail: "Gemini is comparing each annotated region with the finding context and the untouched main screenshot.", status: "active" });
    const regions = flattenRegions(current);
    const prompt = `${buildRegionVerificationPrompt()}\n\nAUDIT FINDINGS AND CURRENT REGION DATA\n${JSON.stringify(regions)}\n\nVerification pass: ${pass}. Image 1 is MAIN. Image 2 is the current annotated image. A correct result must match both semantics and coordinates.`;
    try {
      const text = await callGemini(apiKey, model, prompt, [capture.buffer, annotated], 2200, GEMINI_VERIFY_TIMEOUT_MS);
      const json = extractJsonObject(text) as VerificationResult | null;
      if (!json) return { findings: current, annotated };
      if (json.correct === true) return { findings: current, annotated };
      if (Array.isArray(json.regions) && json.regions.length) {
        onStage?.({ id: "correct", label: `Correcting highlighted regions (pass ${pass})`, detail: "Discarding the previous annotation and rebuilding from the untouched main screenshot.", status: "active" });
        current = applyVerificationBoxes(current, json.regions);
        annotated = await renderRegions(capture.buffer, capture.width, capture.height, current);
        continue;
      }
      return { findings: current, annotated };
    } catch (error) { console.warn(`Evidence verification pass ${pass} skipped`, error); return { findings: current, annotated }; }
  }
  return { findings: current, annotated };
}

export async function createAudit(url: string, onStage?: (stage: AuditStage) => void): Promise<AuditResult> {
  onStage?.({ id: "capture", label: "Taking page snapshot", detail: "Browserless is loading the landing page and creating the untouched full-page screenshot.", status: "active" });
  const capture = await captureScreenshot(url);
  onStage?.({ id: "capture", label: "Page snapshot captured", detail: `${capture.width} × ${capture.height}px main screenshot captured. This image will remain untouched.`, status: "complete" });
  onStage?.({ id: "analyse", label: "Analysing screenshot", detail: "Gemini is reviewing the untouched screenshot against the ScreenRoot UX framework.", status: "active" });
  const analysis = await analyseWithGemini(url, capture);
  onStage?.({ id: "analyse", label: "Screenshot analysis complete", detail: `${analysis.findings.length} high-priority visually evidenced finding${analysis.findings.length === 1 ? "" : "s"} selected.`, status: "complete" });
  onStage?.({ id: "highlight", label: "Highlighting evidence regions", detail: "Creating a new annotated image from the untouched screenshot using Gemini's coordinates.", status: "active" });
  const verified = await verifyAndCorrectRegions(capture, analysis.findings, analysis.model, onStage);
  onStage?.({ id: "highlight", label: "Evidence image created", detail: "The highlighted image was generated without modifying the main screenshot.", status: "complete" });
  onStage?.({ id: "complete", label: "Audit ready", detail: "Only after region verification is the final annotated image returned to the product.", status: "complete" });
  return { pages: [{ url, title: new URL(url).hostname, screenshot: `data:image/png;base64,${verified.annotated.toString("base64")}`, screenshotWidth: capture.width, screenshotHeight: capture.height, findings: verified.findings }] };
}
