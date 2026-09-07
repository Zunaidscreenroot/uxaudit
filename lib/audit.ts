import OpenAI from "openai";
import sharp from "sharp";
import { AUDIT_CATEGORIES, buildAuditPrompt } from "./gemini";

export type Severity = "high" | "medium" | "low";
export type Evidence = { section: string; element: string; detail: string };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; screenrootTasks: string[]; devTasks: string[]; uxPerspective: { law: string; definition: string; assessment: string }; evidence: Evidence[] };
export type AuditPage = { url: string; title: string; screenshot: string; screenshotWidth: number; screenshotHeight: number; findings: Finding[] };
export type AuditResult = { pages: AuditPage[] };
export type AuditStage = { id: string; label: string; detail: string; status: "active" | "complete" };
type Capture = { buffer: Buffer; width: number; height: number; analysisBuffer: Buffer; title: string };

const VISION_MODELS = [
  "google/gemma-4-31b-it:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-26b-a4b-it:free",
] as const;

const ANALYSIS_TIMEOUT_MS = 28000;
const GEMINI_ENRICH_TIMEOUT_MS = 5500;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

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

function normalizeFinding(value: unknown, index: number): Finding {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const perspective = (item.uxPerspective && typeof item.uxPerspective === "object" ? item.uxPerspective : {}) as Record<string, unknown>;
  const rawEvidence = Array.isArray(item.evidence) ? item.evidence : [];
  const evidence = rawEvidence.slice(0, 2).map((raw) => {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const section = typeof entry.section === "string" ? entry.section.trim() : "Unspecified section";
    const element = typeof entry.element === "string" ? entry.element.trim() : "Visible interface element";
    const detail = typeof entry.detail === "string" ? entry.detail.trim() : "Visible evidence identified in the supplied screenshot.";
    if (!section || !element || !detail) return null;
    return { section, element, detail };
  }).filter((entry): entry is Evidence => Boolean(entry));
  const requestedCategory = typeof item.category === "string" ? item.category.trim().toLowerCase() : "visual design";
  const category = AUDIT_CATEGORIES.find((candidate) => candidate.toLowerCase() === requestedCategory) ?? "Visual design";
  const rawSeverity = typeof item.severity === "string" ? item.severity.toLowerCase() : "medium";
  const severity: Severity = rawSeverity === "high" || rawSeverity === "low" ? rawSeverity : "medium";
  return {
    id: typeof item.id === "string" ? item.id : `finding-${index + 1}`,
    severity,
    category,
    title: typeof item.title === "string" ? item.title : "UX issue",
    description: typeof item.description === "string" ? item.description : "The visible interface may create friction for users.",
    recommendation: typeof item.recommendation === "string" ? item.recommendation : "Review this area against established UX principles.",
    screenrootTasks: Array.isArray(item.screenrootTasks) ? item.screenrootTasks.filter((task): task is string => typeof task === "string").slice(0, 4) : [],
    devTasks: Array.isArray(item.devTasks) ? item.devTasks.filter((task): task is string => typeof task === "string").slice(0, 4) : [],
    uxPerspective: {
      law: typeof perspective.law === "string" ? perspective.law : "UX principle",
      definition: typeof perspective.definition === "string" ? perspective.definition : "A usability principle used to evaluate interface design.",
      assessment: typeof perspective.assessment === "string" ? perspective.assessment : "This visible area deserves review based on the supplied screenshot."
    },
    evidence
  };
}

async function prepareScreenshot(buffer: Buffer, title: string): Promise<Capture> {
  if (buffer.byteLength > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot is too large. Please upload an image smaller than 15 MB.");
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error("The uploaded file is not a valid image.");
  if (width < 320 || height < 200) throw new Error("Please upload a larger screenshot so the UX evidence can be reviewed reliably.");
  if (width > 20000 || height > 20000) throw new Error("Screenshot dimensions are too large. Please upload a smaller screenshot.");
  const analysisBuffer = await sharp(buffer)
    .resize({ width: Math.min(1400, width), height: Math.min(5000, height), fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, progressive: true, mozjpeg: true })
    .toBuffer();
  return { buffer, width, height, analysisBuffer, title: title || "Uploaded screenshot" };
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

async function analyseWithFreeVision(sourceName: string, capture: Capture): Promise<Finding[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured on this deployment.");
  const text = await callVisionModel(apiKey, buildAuditPrompt(`the uploaded screenshot (${sourceName})`, capture.width, capture.height), capture.analysisBuffer);
  const json = extractJsonObject(text) as { findings?: unknown[] } | null;
  if (!json || !Array.isArray(json.findings)) throw new Error("OpenRouter returned invalid audit JSON.");
  return json.findings.map((item, index) => normalizeFinding(item, index)).filter((finding) => finding.evidence.length > 0).slice(0, 8);
}

async function enrichWithGemini(findings: Finding[]): Promise<Finding[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !findings.length) return findings;
  const compact = findings.map((finding) => ({ id: finding.id, severity: finding.severity, category: finding.category, title: finding.title, description: finding.description, recommendation: finding.recommendation }));
  const prompt = `You are the UX standards/enrichment layer for a ScreenRoot UX audit. Do not invent or change the visual finding or its evidence. Based only on the supplied finding text, enrich each item with the most appropriate recognized UX law/principle, a concise accurate definition, a client-friendly assessment explaining why the visible issue relates to that principle, up to 3 practical ScreenRoot design tasks, and up to 3 practical developer tasks. Do not add findings. Do not change severity, category, title, description, recommendation, evidence, or IDs. Return JSON only: {"findings":[{"id":"...","uxPerspective":{"law":"...","definition":"...","assessment":"..."},"screenrootTasks":["..."],"devTasks":["..."]}]}. Findings: ${JSON.stringify(compact)}`;
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
      const perspective = enrichment.uxPerspective && typeof enrichment.uxPerspective === "object" ? enrichment.uxPerspective : {};
      return { ...finding, uxPerspective: { law: typeof perspective.law === "string" ? perspective.law : finding.uxPerspective.law, definition: typeof perspective.definition === "string" ? perspective.definition : finding.uxPerspective.definition, assessment: typeof perspective.assessment === "string" ? perspective.assessment : finding.uxPerspective.assessment }, screenrootTasks: Array.isArray(enrichment.screenrootTasks) ? enrichment.screenrootTasks.filter((task: unknown): task is string => typeof task === "string").slice(0, 3) : finding.screenrootTasks, devTasks: Array.isArray(enrichment.devTasks) ? enrichment.devTasks.filter((task: unknown): task is string => typeof task === "string").slice(0, 3) : finding.devTasks };
    });
  } catch { return findings; }
}

export async function createAuditFromScreenshot(buffer: Buffer, filename: string, onStage?: (stage: AuditStage) => void): Promise<AuditResult> {
  onStage?.({ id: "capture", label: "Preparing screenshot", detail: "Validating and preparing the uploaded screenshot for visual review.", status: "active" });
  const capture = await prepareScreenshot(buffer, filename.replace(/\.[^.]+$/, "") || "Uploaded screenshot");
  onStage?.({ id: "capture", label: "Preparing screenshot", detail: `Screenshot ready at ${capture.width}×${capture.height}px.`, status: "complete" });

  onStage?.({ id: "analyse", label: "Finding UX evidence", detail: "Reviewing the screenshot for concrete, visible UX problems.", status: "active" });
  const findings = await analyseWithFreeVision(filename, capture);
  onStage?.({ id: "analyse", label: "Finding UX evidence", detail: `${findings.length} evidence-backed finding${findings.length === 1 ? "" : "s"} identified.`, status: "complete" });

  onStage?.({ id: "enrich", label: "Applying UX standards", detail: "Connecting findings to UX principles and practical redesign tasks.", status: "active" });
  const enriched = await enrichWithGemini(findings);
  onStage?.({ id: "enrich", label: "Applying UX standards", detail: "UX principles and implementation guidance added.", status: "complete" });

  onStage?.({ id: "complete", label: "Finalising evidence report", detail: "Preparing the client-facing evidence report.", status: "active" });
  const page: AuditPage = { url: "Uploaded screenshot", title: capture.title, screenshot: `data:image/png;base64,${capture.buffer.toString("base64")}`, screenshotWidth: capture.width, screenshotHeight: capture.height, findings: enriched };
  onStage?.({ id: "complete", label: "Finalising evidence report", detail: `${enriched.length} evidence-backed findings ready for review.`, status: "complete" });
  return { pages: [page] };
}
