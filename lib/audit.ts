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

type Candidate = { model: string; findings: Finding[] };

// These are the explicit free multimodal OpenRouter models used by the MVP.
// The router also discovers additional free OpenRouter models that advertise image input.
const CONFIGURED_VISION_MODELS = [
  "google/gemma-4-31b-it:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-26b-a4b-it:free",
  "sourceful/Sourceful-MultiModal:free",
  "xiaomi/mimo-v2-omni:free",
  "allenai/molmo-2-8b:free",
  "google/gemma-3-27b-it:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "google/gemma-3-12b-it:free",
  "qwen/qwen3-vl-235b-a22b-thinking:free",
  "qwen/qwen3-vl-235b-a22b-instruct:free",
] as const;

const GEMINI_VISION_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

const ANALYSIS_TIMEOUT_MS = 18000;
const GEMINI_TIMEOUT_MS = 18000;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const MAX_DISCOVERED_OPENROUTER_MODELS = 40;

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
    const section = typeof entry.section === "string" ? entry.section.trim() : "";
    const element = typeof entry.element === "string" ? entry.element.trim() : "";
    const detail = typeof entry.detail === "string" ? entry.detail.trim() : "";
    if (!section || !element || !detail) return null;
    return { section, element, detail };
  }).filter((entry): entry is Evidence => Boolean(entry));
  const requestedCategory = typeof item.category === "string" ? item.category.trim().toLowerCase() : "visual design";
  const category = AUDIT_CATEGORIES.find((candidate) => candidate.toLowerCase() === requestedCategory) ?? "Visual design";
  const rawSeverity = typeof item.severity === "string" ? item.severity.toLowerCase() : "medium";
  const severity: Severity = rawSeverity === "high" || rawSeverity === "low" ? rawSeverity : "medium";
  return {
    id: typeof item.id === "string" ? item.id : `candidate-${index + 1}`,
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

function parseFindings(text: string): Finding[] {
  const json = extractJsonObject(text) as { findings?: unknown[] } | null;
  if (!json || !Array.isArray(json.findings)) return [];
  return json.findings.map((item, index) => normalizeFinding(item, index)).filter((finding) => finding.evidence.length > 0).slice(0, 8);
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

async function discoverFreeMultimodalModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [...CONFIGURED_VISION_MODELS];
    const payload: any = await response.json();
    const discovered = Array.isArray(payload?.data) ? payload.data.filter((model: any) => {
      const id = typeof model?.id === "string" ? model.id : "";
      const inputs = model?.architecture?.input_modalities;
      const imageInput = Array.isArray(inputs) && inputs.includes("image");
      const pricing = model?.pricing;
      const free = id.endsWith(":free") || (pricing && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0);
      return id && imageInput && free;
    }).map((model: any) => String(model.id)) : [];
    return Array.from(new Set([...CONFIGURED_VISION_MODELS, ...discovered])).slice(0, MAX_DISCOVERED_OPENROUTER_MODELS);
  } catch {
    return [...CONFIGURED_VISION_MODELS];
  }
}

async function callOpenRouterModel(apiKey: string, model: string, prompt: string, image: Buffer): Promise<Finding[]> {
  const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey, timeout: ANALYSIS_TIMEOUT_MS, maxRetries: 0 });
  const imageUrl = `data:image/jpeg;base64,${image.toString("base64")}`;
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }],
    reasoning: { enabled: false },
    max_tokens: 1800,
    temperature: 0.1,
    response_format: { type: "json_object" },
    provider: { allow_fallbacks: true, sort: "latency" },
  } as any);
  const raw: any = response.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((part: any) => typeof part === "object" && part && "text" in part ? String(part.text ?? "") : "").join("") : "";
  if (!text) throw new Error("empty response");
  return parseFindings(text);
}

async function callGeminiVisionModel(apiKey: string, model: string, prompt: string, image: Buffer): Promise<Finding[]> {
  const imageBase64 = image.toString("base64");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", maxOutputTokens: 1800, temperature: 0.1 }
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: any = await response.json();
  const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
  if (!text) throw new Error("empty response");
  return parseFindings(text);
}

async function runAllVisionModels(apiKey: string | undefined, geminiKey: string | undefined, prompt: string, image: Buffer): Promise<Candidate[]> {
  const openRouterModels = apiKey ? await discoverFreeMultimodalModels(apiKey) : [];
  const openRouterRuns = apiKey ? openRouterModels.map(async (model): Promise<Candidate | null> => {
    try { return { model, findings: await callOpenRouterModel(apiKey, model, prompt, image) }; }
    catch (error) { console.warn(`OpenRouter vision model failed: ${model}`, error); return null; }
  }) : [];
  const geminiRuns = geminiKey ? GEMINI_VISION_MODELS.map(async (model): Promise<Candidate | null> => {
    try { return { model: `google/${model}`, findings: await callGeminiVisionModel(geminiKey, model, prompt, image) }; }
    catch (error) { console.warn(`Gemini vision model failed: ${model}`, error); return null; }
  }) : [];
  const results = await Promise.all([...openRouterRuns, ...geminiRuns]);
  return results.filter((result): result is Candidate => Boolean(result && result.findings.length));
}

async function qualityRun(geminiKey: string | undefined, candidates: Candidate[], capture: Capture): Promise<Finding[]> {
  if (!candidates.length) throw new Error("No vision model returned usable UX evidence. Please try the screenshot again or check the AI provider keys.");
  const compact = candidates.map((candidate) => ({ model: candidate.model, findings: candidate.findings.map((finding) => ({ severity: finding.severity, category: finding.category, title: finding.title, description: finding.description, recommendation: finding.recommendation, evidence: finding.evidence })) }));
  const judgePrompt = `You are the final AI quality router for a client-facing ScreenRoot UX audit. You are given the original screenshot plus independent analyses from multiple vision models. Select and consolidate only the strongest, defensible findings.\n\nQUALITY RULES:\n- The screenshot is the source of truth. Re-check every selected finding against the image.\n- Prefer findings independently supported by multiple models, but a unique finding may survive if the screenshot clearly proves it.\n- Reject hallucinations, vague criticism, duplicate findings, speculative accessibility/performance claims, and claims contradicted by the screenshot.\n- Never invent evidence. Preserve precise section, element and detail language grounded in the screenshot.\n- Do not output coordinates, scores, rankings, confidence percentages, or model commentary.\n- Keep 5–8 findings when defensible; fewer is correct when evidence is weak.\n- This is a redesign-opportunity audit, not a generic checklist.\n\nReturn JSON only in this shape:\n{"findings":[{"id":"finding-1","severity":"high|medium|low","category":"...","title":"...","description":"...","recommendation":"...","evidence":[{"section":"...","element":"...","detail":"..."}]}]}\n\nMODEL ANALYSES:\n${JSON.stringify(compact)}`;

  if (geminiKey) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": geminiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: judgePrompt }, { inline_data: { mime_type: "image/jpeg", data: capture.analysisBuffer.toString("base64") } }] }], generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", maxOutputTokens: 2200, temperature: 0.05 } }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
      });
      if (response.ok) {
        const payload: any = await response.json();
        const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
        const findings = parseFindings(text);
        if (findings.length) return findings.map((finding, index) => ({ ...finding, id: `finding-${index + 1}` }));
      }
    } catch (error) { console.warn("Gemini quality run failed", error); }
  }

  // Deterministic fallback: prefer issues corroborated by multiple independent models.
  const groups = new Map<string, { finding: Finding; models: Set<string> }>();
  for (const candidate of candidates) {
    for (const finding of candidate.findings) {
      const key = finding.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const existing = groups.get(key);
      if (existing) existing.models.add(candidate.model);
      else groups.set(key, { finding, models: new Set([candidate.model]) });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.models.size - a.models.size).slice(0, 8).map((entry, index) => ({ ...entry.finding, id: `finding-${index + 1}` }));
}

export async function createAuditFromScreenshot(buffer: Buffer, filename: string, onStage?: (stage: AuditStage) => void): Promise<AuditResult> {
  onStage?.({ id: "capture", label: "Preparing screenshot", detail: "Validating and preparing the uploaded screenshot for visual review.", status: "active" });
  const capture = await prepareScreenshot(buffer, filename.replace(/\.[^.]+$/, "") || "Uploaded screenshot");
  onStage?.({ id: "capture", label: "Preparing screenshot", detail: `Screenshot ready at ${capture.width}×${capture.height}px.`, status: "complete" });

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!openRouterKey && !geminiKey) throw new Error("Configure OPENROUTER_API_KEY or GEMINI_API_KEY before running an audit.");

  onStage?.({ id: "analyse", label: "Running multi-model analysis", detail: "Sending the screenshot to all configured multimodal models in parallel.", status: "active" });
  const prompt = buildAuditPrompt(`the uploaded screenshot (${filename})`, capture.width, capture.height);
  const candidates = await runAllVisionModels(openRouterKey, geminiKey, prompt, capture.analysisBuffer);
  onStage?.({ id: "analyse", label: "Running multi-model analysis", detail: `${candidates.length} vision model${candidates.length === 1 ? "" : "s"} returned usable analyses.`, status: "complete" });

  onStage?.({ id: "quality", label: "Running AI quality check", detail: "Comparing model findings and re-checking the strongest evidence against the screenshot.", status: "active" });
  const selected = await qualityRun(geminiKey, candidates, capture);
  onStage?.({ id: "quality", label: "Running AI quality check", detail: `${selected.length} findings survived the quality check.`, status: "complete" });

  onStage?.({ id: "enrich", label: "Applying UX standards", detail: "Connecting selected findings to UX principles and practical redesign tasks.", status: "active" });
  const enriched = await enrichWithGemini(geminiKey, selected);
  onStage?.({ id: "enrich", label: "Applying UX standards", detail: "UX principles and implementation guidance added.", status: "complete" });

  onStage?.({ id: "complete", label: "Finalising evidence report", detail: "Preparing the client-facing evidence report.", status: "active" });
  const page: AuditPage = { url: "Uploaded screenshot", title: capture.title, screenshot: `data:image/png;base64,${capture.buffer.toString("base64")}`, screenshotWidth: capture.width, screenshotHeight: capture.height, findings: enriched };
  onStage?.({ id: "complete", label: "Finalising evidence report", detail: `${enriched.length} evidence-backed findings ready for review.`, status: "complete" });
  return { pages: [page] };
}

async function enrichWithGemini(apiKey: string | undefined, findings: Finding[]): Promise<Finding[]> {
  if (!apiKey || !findings.length) return findings;
  const compact = findings.map((finding) => ({ id: finding.id, severity: finding.severity, category: finding.category, title: finding.title, description: finding.description, recommendation: finding.recommendation }));
  const prompt = `You are the UX standards/enrichment layer for a ScreenRoot UX audit. Do not invent or change the visual finding or its evidence. Based only on the supplied finding text, enrich each item with the most appropriate recognized UX law/principle, a concise accurate definition, a client-friendly assessment explaining why the visible issue relates to that principle, up to 3 practical ScreenRoot design tasks, and up to 3 practical developer tasks. Do not add findings. Do not change severity, category, title, description, recommendation, evidence, or IDs. Return JSON only: {"findings":[{"id":"...","uxPerspective":{"law":"...","definition":"...","assessment":"..."},"screenrootTasks":["..."],"devTasks":["..."]}]}. Findings: ${JSON.stringify(compact)}`;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", { method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", maxOutputTokens: 1400 } }), signal: AbortSignal.timeout(7000) });
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
