import OpenAI from "openai";
import sharp from "sharp";
import { AUDIT_CATEGORIES, buildAuditPrompt } from "./gemini";

export type Severity = "high" | "medium" | "low";
export type Evidence = { label: string; detail: string; marker: string; x: number; y: number; width: number; height: number };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; screenrootTasks: string[]; devTasks: string[]; uxPerspective: { law: string; definition: string; assessment: string }; evidence: Evidence[] };
export type AuditPage = { url: string; title: string; screenshot: string; screenshotWidth: number; screenshotHeight: number; findings: Finding[] };
export type AuditResult = { pages: AuditPage[] };
export type AuditStage = { id: string; label: string; detail: string; status: "active" | "complete" };
type Capture = { buffer: Buffer; width: number; height: number; analysisBuffer: Buffer };
type RegionBox = [number, number, number, number];

const MODEL = "minimax/minimax-m3:free";
const BROWSERLESS_TIMEOUT_MS = 9000;
const ANALYSIS_TIMEOUT_MS = 44000;
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
  const evidence = rawEvidence.slice(0, 1).map((raw, evidenceIndex) => {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const box = normalizeBox(entry.box);
    if (!box) return null;
    const [y1, x1, y2, x2] = box;
    return { label: typeof entry.label === "string" ? entry.label : `Region ${evidenceIndex + 1}`, detail: typeof entry.detail === "string" ? entry.detail : "Visible evidence identified in the screenshot.", marker: typeof entry.marker === "string" ? entry.marker : String(index + 1), x: x1 / 10, y: y1 / 10, width: Math.max(0.8, (x2 - x1) / 10), height: Math.max(0.8, (y2 - y1) / 10) };
  }).filter((entry): entry is Evidence => Boolean(entry));
  const requestedCategory = typeof item.category === "string" ? item.category.trim().toLowerCase() : "visual design";
  const category = AUDIT_CATEGORIES.find((candidate) => candidate.toLowerCase() === requestedCategory) ?? "Visual design";
  const rawSeverity = typeof item.severity === "string" ? item.severity.toLowerCase() : "medium";
  const severity: Severity = rawSeverity === "high" || rawSeverity === "low" ? rawSeverity : "medium";
  return { id: typeof item.id === "string" ? item.id : `finding-${index + 1}`, severity, category, title: typeof item.title === "string" ? item.title : "UX issue", description: typeof item.description === "string" ? item.description : "The visible interface may create friction for users.", recommendation: typeof item.recommendation === "string" ? item.recommendation : "Review this area against established UX principles.", screenrootTasks: Array.isArray(item.screenrootTasks) ? item.screenrootTasks.filter((task): task is string => typeof task === "string").slice(0, 4) : [], devTasks: Array.isArray(item.devTasks) ? item.devTasks.filter((task): task is string => typeof task === "string").slice(0, 4) : [], uxPerspective: { law: typeof perspective.law === "string" ? perspective.law : "UX principle", definition: typeof perspective.definition === "string" ? perspective.definition : "A usability principle used to evaluate interface design.", assessment: typeof perspective.assessment === "string" ? perspective.assessment : "This visible area deserves review based on the supplied screenshot." }, evidence };
}

async function captureScreenshot(url: string): Promise<Capture> {
  const token = process.env.BROWSERLESS_API_TOKEN;
  if (!token) throw new Error("BROWSERLESS_API_TOKEN is not configured on this deployment.");
  const endpoint = `https://production-sfo.browserless.io/function?token=${encodeURIComponent(token)}&timeout=${BROWSERLESS_TIMEOUT_MS}`;
  const code = `export default async ({ page }) => {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.emulateMediaType("screen");
    try { await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded", timeout: 4000 }); } catch {}
    if (!await page.evaluate(() => !!document.body)) throw new Error("Browserless loaded no document body.");
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}html{scroll-behavior:auto!important}" }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.evaluate(async () => {
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      document.querySelectorAll("img[loading=lazy]").forEach(img => img.setAttribute("loading", "eager"));
      document.querySelectorAll("img").forEach(img => img.setAttribute("fetchpriority", "high"));
      const scrollHeight = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const step = Math.max(1000, Math.floor(window.innerHeight * 1.2));
      for (let y = 0; y <= scrollHeight(); y += step) { window.scrollTo(0, y); await wait(15); }
      window.scrollTo(0, scrollHeight()); await wait(50); window.scrollTo(0, 0); await wait(50);
    });
    const width = 1440;
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 900);
    const screenshot = await page.screenshot({ fullPage: true, type: "png", captureBeyondViewport: true, encoding: "base64" });
    return { screenshot, width, height };
  };`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }, body: code, signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT_MS + 700) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Browserless returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 250)}` : "."}`); }
  const payload = await response.json() as { screenshot?: string; width?: number; height?: number };
  if (!payload.screenshot) throw new Error("Browserless returned no screenshot data.");
  const buffer = Buffer.from(payload.screenshot, "base64");
  const metadata = await sharp(buffer).metadata();
  const width = Number(payload.width) || metadata.width || 1440;
  const height = Number(payload.height) || metadata.height || 900;
  const analysisBuffer = await sharp(buffer).resize({ width: Math.min(1100, width), height: Math.min(3200, height), fit: "inside", withoutEnlargement: true }).jpeg({ quality: 65, progressive: true, mozjpeg: true }).toBuffer();
  return { buffer, width, height, analysisBuffer };
}

async function callMiniMax(apiKey: string, prompt: string, image: Buffer, maxTokens: number, timeout: number): Promise<string> {
  const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey, timeout, maxRetries: 0 });
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } }] }],
    reasoning: { enabled: false },
    max_tokens: maxTokens,
    temperature: 0.1,
    response_format: { type: "json_object" },
    provider: { allow_fallbacks: true, sort: "latency" },
  } as any);
  const raw: any = (response.choices?.[0]?.message as any)?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((part: any) => typeof part === "object" && part && "text" in part ? String(part.text ?? "") : "").join("") : "";
  if (!text) throw new Error("MiniMax M3 returned an empty response.");
  return text;
}

async function analyseWithMiniMax(url: string, capture: Capture): Promise<Finding[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured on this deployment.");
  const prompt = `${buildAuditPrompt(url, capture.width, capture.height)}\n\nFINAL SELF-VERIFICATION BEFORE RESPONDING\nThis is a single-pass audit, so you must perform the evidence verification yourself before returning JSON. For every finding, re-check the screenshot after selecting the evidence box. The box must point to the exact UI that supports the written claim, not a nearby banner, header, calculator, card, or empty area. If the claim is contradicted by visible pixels, DELETE the finding. For contrast findings, inspect the actual text color and the actual background behind that text; never infer a contrast failure from the surrounding panel color. Use exactly ONE tight evidence box per finding. Coordinates must be normalized to the ENTIRE screenshot as [ymin,xmin,ymax,xmax] from 0–1000, not viewport coordinates. Prefer 3–6 strong findings over many weak ones. Return only the required JSON object.`;
  const text = await callMiniMax(apiKey, prompt, capture.analysisBuffer, 1800, ANALYSIS_TIMEOUT_MS);
  const json = extractJsonObject(text) as { findings?: unknown[] } | null;
  if (!json || !Array.isArray(json.findings)) throw new Error("MiniMax M3 returned invalid audit JSON.");
  return json.findings.map((item, index) => normalizeFinding(item, index)).filter((finding) => finding.evidence.length > 0).slice(0, 6);
}

function escapeXml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
function buildRegionSvg(width: number, height: number, findings: Finding[]): Buffer {
  const elements = findings.flatMap((finding) => finding.evidence.map((e) => {
    const x = clamp(e.x / 100 * width, 0, width - 1), y = clamp(e.y / 100 * height, 0, height - 1);
    const w = clamp(e.width / 100 * width, 8, width - x), h = clamp(e.height / 100 * height, 8, height - y);
    const markerW = 34, markerH = 34, markerX = x, markerY = Math.max(0, y - markerH - 4);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#ffd400" fill-opacity="0.12" stroke="#ffd400" stroke-width="5"/><rect x="${markerX}" y="${markerY}" width="${markerW}" height="${markerH}" rx="17" fill="#ffd400" stroke="#111" stroke-width="2"/><text x="${markerX + markerW / 2}" y="${markerY + 23}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#111">${escapeXml(e.marker)}</text>`;
  })).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements}</svg>`);
}
async function renderRegions(mainImage: Buffer, width: number, height: number, findings: Finding[]): Promise<Buffer> {
  if (!findings.length) return mainImage;
  return sharp(mainImage).composite([{ input: buildRegionSvg(width, height, findings), left: 0, top: 0, blend: "over" }]).png().toBuffer();
}

export async function createAudit(url: string, onStage?: (stage: AuditStage) => void): Promise<AuditResult> {
  onStage?.({ id: "capture", label: "Taking page snapshot", detail: "Browserless is capturing the complete desktop landing page and preserving the original image.", status: "active" });
  const capture = await captureScreenshot(url);
  onStage?.({ id: "capture", label: "Taking page snapshot", detail: "The untouched main screenshot is ready.", status: "complete" });
  onStage?.({ id: "analyse", label: "Analysing screenshot", detail: "MiniMax M3 is reviewing the complete screenshot and self-checking every evidence region against the visible UI.", status: "active" });
  const findings = await analyseWithMiniMax(url, capture);
  onStage?.({ id: "analyse", label: "Analysing screenshot", detail: "Visual UX analysis and evidence self-verification completed.", status: "complete" });
  onStage?.({ id: "highlight", label: "Highlighting evidence regions", detail: "Only the evidence coordinates returned by the self-verified audit are being rendered.", status: "active" });
  const annotated = await renderRegions(capture.buffer, capture.width, capture.height, findings);
  onStage?.({ id: "highlight", label: "Highlighting evidence regions", detail: "The final highlighted image is generated from the untouched original screenshot.", status: "complete" });
  onStage?.({ id: "complete", label: "Finalising verified audit", detail: "Preparing the final client-facing report.", status: "active" });
  const result = { pages: [{ url, title: new URL(url).hostname, screenshot: `data:image/png;base64,${annotated.toString("base64")}`, screenshotWidth: capture.width, screenshotHeight: capture.height, findings: findings.filter((finding) => finding.evidence.length > 0) }] };
  onStage?.({ id: "complete", label: "Finalising verified audit", detail: "Verified audit is ready.", status: "complete" });
  return result;
}
