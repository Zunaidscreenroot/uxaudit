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

// Free OpenRouter models from the supplied list that support image input.
// OpenRouter tries these in order if the primary model/provider is unavailable.
const VISION_MODELS = [
  "google/gemma-4-31b-it:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-26b-a4b-it:free",
] as const;

// Keep the complete audit safely inside Vercel's 60s function limit while giving
// Browserless enough time to render real-world landing pages.
const BROWSERLESS_TIMEOUT_MS = 16000;
const ANALYSIS_TIMEOUT_MS = 30000;
const GEMINI_ENRICH_TIMEOUT_MS = 6000;
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
    try { await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded", timeout: 7000 }); } catch {}
    if (!await page.evaluate(() => !!document.body)) throw new Error("Browserless loaded no document body.");
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}html{scroll-behavior:auto!important}" }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 350));
    await page.evaluate(async () => {
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      document.querySelectorAll("img[loading=lazy]").forEach(img => img.setAttribute("loading", "eager"));
      document.querySelectorAll("img").forEach(img => img.setAttribute("fetchpriority", "high"));
      const scrollHeight = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const step = Math.max(1000, Math.floor(window.innerHeight * 1.5));
      // Trigger lazy content without allowing an unusually long page to consume the whole Browserless budget.
      const maxSteps = 10;
      for (let i = 0; i < maxSteps; i++) {
        const y = Math.min(i * step, Math.max(0, scrollHeight() - window.innerHeight));
        window.scrollTo(0, y);
        await wait(25);
      }
      window.scrollTo(0, 0);
      await wait(100);
    });
    const width = 1440;
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 900);
    const screenshot = await page.screenshot({ fullPage: true, type: "png", captureBeyondViewport: true, encoding: "base64" });
    return { screenshot, width, height };
  };`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" }, body: code, signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT_MS + 1000) });
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

async function callVisionModel(apiKey: string, prompt: string, image: Buffer): Promise<string> {
  const failures: string[] = [];
  const imageUrl = `data:image/jpeg;base64,${image.toString("base64")}`;
  const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey, timeout: ANALYSIS_TIMEOUT_MS, maxRetries: 0 });

  // Do explicit model-level failover. Free endpoints are independently rate-limited,
  // and a 429 from one model must not abort the whole audit.
  for (const model of VISION_MODELS) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }],
        reasoning: { enabled: false },
        max_tokens: 1800,
        temperature: 0.1,
        response_format: { type: "json_object" },
        provider: { allow_fallbacks: true, sort: "latency" },
      } as any);
      const raw: any = (response.choices?.[0]?.message as any)?.content;
      const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((part: any) => typeof part === "object" && part && "text" in part ? String(part.text ?? "") : "").join("") : "";
      if (text) return text;
      failures.push(`${model}: empty response`);
    } catch (error: any) {
      const status = Number(error?.status ?? error?.code ?? 0);
      const message = String(error?.error?.message ?? error?.message ?? "request failed").slice(0, 180);
      failures.push(`${model}: ${status || "error"} ${message}`);
      // Briefly back off only for rate limiting; move immediately to the next model for other failures.
      if (status === 429) await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new Error(`All OpenRouter vision models failed. ${failures.join(" | ")}`);
}

async function analyseWithFreeVision(url: string, capture: Capture): Promise<Finding[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured on this deployment.");
  const prompt = `${buildAuditPrompt(url, capture.width, capture.height)}\n\nFINAL SELF-VERIFICATION BEFORE RESPONDING\nThis is a single-pass audit. For every finding, re-check the screenshot after selecting the evidence box. The box must point to the exact UI that supports the written claim, not a nearby banner, header, calculator, card, or empty area. If the claim is contradicted by visible pixels, DELETE the finding. For contrast findings, inspect the actual text color and actual background behind that text; never infer a contrast failure from a surrounding panel color. Use exactly ONE tight evidence box per finding. Coordinates must be normalized to the ENTIRE screenshot as [ymin,xmin,ymax,xmax] from 0–1000, not viewport coordinates. Prefer 3–6 strong findings over many weak ones. Return only the required JSON object.`;
  const text = await callVisionModel(apiKey, prompt, capture.analysisBuffer);
  const json = extractJsonObject(text) as { findings?: unknown[] } | null;
  if (!json || !Array.isArray(json.findings)) throw new Error("OpenRouter returned invalid audit JSON.");
  return json.findings.map((item, index) => normalizeFinding(item, index)).filter((finding) => finding.evidence.length > 0).slice(0, 6);
}

async function enrichWithGemini(findings: Finding[]): Promise<Finding[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !findings.length) return findings;
  const compact = findings.map((finding) => ({ id: finding.id, severity: finding.severity, category: finding.category, title: finding.title, description: finding.description, recommendation: finding.recommendation }));
  const prompt = `You are the UX standards/enrichment layer for a ScreenRoot UX audit. Do not invent or change the visual finding. Based only on the supplied finding text, enrich each item with: (1) the most appropriate recognized UX law/principle, (2) a concise accurate definition, (3) a client-friendly assessment explaining why the stated issue relates to that principle, (4) up to 3 practical ScreenRoot design tasks, and (5) up to 3 practical developer tasks. Do not add new findings. Do not change severity, category, title, description, recommendation, or IDs. Return JSON only in this shape: {"findings":[{"id":"...","uxPerspective":{"law":"...","definition":"...","assessment":"..."},"screenrootTasks":["..."],"devTasks":["..."]}]}. Findings: ${JSON.stringify(compact)}`;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", { method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", maxOutputTokens: 1400 } }), signal: AbortSignal.timeout(GEMINI_ENRICH_TIMEOUT_MS) });
    if (!response.ok) return findings;
    const payload: any = await response.json();
    const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
    const json = extractJsonObject(text) as { findings?: unknown[] } | null;
    if (!json || !Array.isArray(json.findings)) return findings;
    const byId = new Map<string, any>();
    json.findings.forEach((item: any) => { if (item && typeof item.id === "string") byId.set(item.id, item); });
    return findings.map((finding) => {
      const enrichment = byId.get(finding.id);
      if (!enrichment) return finding;
      return { ...finding, uxPerspective: { law: typeof enrichment.uxPerspective?.law === "string" ? enrichment.uxPerspective.law : finding.uxPerspective.law, definition: typeof enrichment.uxPerspective?.definition === "string" ? enrichment.uxPerspective.definition : finding.uxPerspective.definition, assessment: typeof enrichment.uxPerspective?.assessment === "string" ? enrichment.uxPerspective.assessment : finding.uxPerspective.assessment }, screenrootTasks: Array.isArray(enrichment.screenrootTasks) ? enrichment.screenrootTasks.filter((task: unknown): task is string => typeof task === "string").slice(0, 3) : finding.screenrootTasks, devTasks: Array.isArray(enrichment.devTasks) ? enrichment.devTasks.filter((task: unknown): task is string => typeof task === "string").slice(0, 3) : finding.devTasks };
    });
  } catch { return findings; }
}

function renderEvidenceScreenshot(buffer: Buffer, width: number, height: number, findings: Finding[]): string {
  const base64 = buffer.toString("base64");
  const rects = findings.map((finding, index) => finding.evidence.map((evidence) => `<rect x="${evidence.x * width / 100}" y="${evidence.y * height / 100}" width="${evidence.width * width / 100}" height="${evidence.height * height / 100}" fill="none" stroke="#ff3b30" stroke-width="6"/><text x="${evidence.x * width / 100 + 8}" y="${Math.max(28, evidence.y * height / 100 + 26)}" font-size="24" font-family="Arial" font-weight="700" fill="#ff3b30">${index + 1}</text>`).join("")).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="data:image/png;base64,${base64}" width="${width}" height="${height}" preserveAspectRatio="none"/>${rects}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function createAudit(url: string, onStage?: (stage: AuditStage) => void): Promise<AuditResult> {
  onStage?.({ id: "capture", label: "Capturing page", detail: "Rendering the landing page in a desktop browser and preparing a full-page screenshot.", status: "active" });
  const capture = await captureScreenshot(url);
  onStage?.({ id: "capture", label: "Capturing page", detail: "Full-page screenshot captured.", status: "complete" });

  onStage?.({ id: "analyse", label: "Analysing UX", detail: "A free multimodal OpenRouter model is inspecting the screenshot and selecting evidence regions.", status: "active" });
  const rawFindings = await analyseWithFreeVision(url, capture);
  onStage?.({ id: "analyse", label: "Analysing UX", detail: `${rawFindings.length} visually evidenced finding(s) identified.`, status: "complete" });

  onStage?.({ id: "enrich", label: "Applying UX standards", detail: "Gemini is mapping findings to UX laws, definitions, assessments, design tasks, and developer tasks.", status: "active" });
  const findings = await enrichWithGemini(rawFindings);
  onStage?.({ id: "enrich", label: "Applying UX standards", detail: "UX standards and implementation guidance prepared.", status: "complete" });

  onStage?.({ id: "highlight", label: "Building evidence", detail: "Placing the verified regions on the untouched original screenshot.", status: "active" });
  const screenshot = renderEvidenceScreenshot(capture.buffer, capture.width, capture.height, findings);
  onStage?.({ id: "highlight", label: "Building evidence", detail: "Evidence overlay generated without stretching the original screenshot.", status: "complete" });
  onStage?.({ id: "complete", label: "Audit complete", detail: "Verified findings are ready for review.", status: "complete" });

  return { pages: [{ url, title: url, screenshot, screenshotWidth: capture.width, screenshotHeight: capture.height, findings }] };
}
