import OpenAI from "openai";
import sharp from "sharp";
import { AUDIT_CATEGORIES, buildAuditPrompt } from "./gemini";

export type Severity = "high" | "medium" | "low";
type CropBox = { x: number; y: number; width: number; height: number };
export type Evidence = { section: string; element: string; detail: string; crop?: string };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; screenrootTasks: string[]; devTasks: string[]; uxPerspective: { law: string; definition: string; assessment: string }; evidence: Evidence[] };
export type AuditPage = { url: string; title: string; screenshot: string; screenshotWidth: number; screenshotHeight: number; findings: Finding[] };
export type AuditResult = { pages: AuditPage[] };
export type AuditStage = { id: string; label: string; detail: string; status: "active" | "complete" };
type Capture = { buffer: Buffer; width: number; height: number; analysisBuffer: Buffer; title: string };
type Candidate = { model: string; findings: Finding[] };

const CONFIGURED_VISION_MODELS = [
  "minimax/minimax-m3:free",
] as const;

const GEMINI_VISION_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

const ANALYSIS_TIMEOUT_MS = 18000;
const GEMINI_TIMEOUT_MS = 18000;
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

function normalizeFinding(value: unknown, index: number, keepCrop = false): Finding {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const perspective = (item.uxPerspective && typeof item.uxPerspective === "object" ? item.uxPerspective : {}) as Record<string, unknown>;
  const rawEvidence = Array.isArray(item.evidence) ? item.evidence : [];
  const evidence = rawEvidence.slice(0, 2).map((raw) => {
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const section = typeof entry.section === "string" ? entry.section.trim() : "";
    const element = typeof entry.element === "string" ? entry.element.trim() : "";
    const detail = typeof entry.detail === "string" ? entry.detail.trim() : "";
    if (!section || !element || !detail) return null;
    const cropValue = entry.crop && typeof entry.crop === "object" ? entry.crop as Record<string, unknown> : null;
    const crop: CropBox | undefined = cropValue && ["x", "y", "width", "height"].every((key) => typeof cropValue[key] === "number" && Number.isFinite(cropValue[key]))
      ? { x: Number(cropValue.x), y: Number(cropValue.y), width: Number(cropValue.width), height: Number(cropValue.height) }
      : undefined;
    return keepCrop && crop ? { section, element, detail, crop: JSON.stringify(crop) } : { section, element, detail };
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

function parseFindings(text: string, keepCrop = false): Finding[] {
  const json = extractJsonObject(text) as { findings?: unknown[] } | null;
  if (!json || !Array.isArray(json.findings)) return [];
  return json.findings.map((item, index) => normalizeFinding(item, index, keepCrop)).filter((finding) => finding.evidence.length > 0).slice(0, 8);
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
    provider: { allow_fallbacks: false },
  } as any);
  const raw: any = response.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((part: any) => typeof part === "object" && part && "text" in part ? String(part.text ?? "") : "").join("") : "";
  if (!text) throw new Error("empty response");
  return parseFindings(text, true);
}

async function callGeminiVisionModel(apiKey: string, model: string, prompt: string, image: Buffer): Promise<Finding[]> {
  const imageBase64 = image.toString("base64");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] }], generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", maxOutputTokens: 1800, temperature: 0.1 } }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload: any = await response.json();
  const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
  if (!text) throw new Error("empty response");
  return parseFindings(text, true);
}

async function runAllVisionModels(apiKey: string | undefined, geminiKey: string | undefined, prompt: string, image: Buffer): Promise<Candidate[]> {
  const openRouterModels = apiKey ? [...CONFIGURED_VISION_MODELS] : [];
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
  const judgePrompt = `You are the final AI quality router for a client-facing ScreenRoot UX audit. You are given the original screenshot plus independent analyses from multiple vision models. Select and consolidate only the strongest, defensible findings.\n\nQUALITY RULES:\n- The screenshot is the source of truth. Re-check every selected finding against the image.\n- Prefer findings independently supported by multiple models, but a unique finding may survive if the screenshot clearly proves it.\n- Reject hallucinations, vague criticism, duplicate findings, speculative accessibility/performance claims, and claims contradicted by the screenshot.\n- Never invent evidence. Preserve precise section, element and detail language grounded in the screenshot.\n- Do not output scores, rankings, confidence percentages, or model commentary.\n- Keep 5–8 findings when defensible; fewer is correct when evidence is weak.\n- This is a redesign-opportunity audit, not a generic checklist.\n- For every evidence item, also return an INTERNAL crop box for the exact visible area being discussed. Coordinates are normalized from 0 to 1 relative to the supplied screenshot: x and y are the top-left, width and height are the crop size. Include enough surrounding context to make the issue understandable, but do not crop the entire page unless the evidence genuinely concerns the whole page.\n- If a candidate analysis already supplies a crop for the same evidence, preserve that crop unless your visual inspection shows it is wrong.\n- These crop coordinates are internal metadata and will be used only to generate visual evidence thumbnails; they are not shown as coordinates to the client.\n\nReturn JSON only in this shape:\n{"findings":[{"id":"finding-1","severity":"high|medium|low","category":"...","title":"...","description":"...","recommendation":"...","evidence":[{"section":"...","element":"...","detail":"...","crop":{"x":0.0,"y":0.0,"width":0.0,"height":0.0}}]}]}\n\nMODEL ANALYSES:\n${JSON.stringify(compact)}`;

  if (geminiKey) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": geminiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: judgePrompt }, { inline_data: { mime_type: "image/jpeg", data: capture.analysisBuffer.toString("base64") } }] }], generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", maxOutputTokens: 2400, temperature: 0.05 } }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
      });
      if (response.ok) {
        const payload: any = await response.json();
        const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
        const findings = parseFindings(text, true);
        if (findings.length) return findings.map((finding, index) => ({ ...finding, id: `finding-${index + 1}` }));
      }
    } catch (error) { console.warn("Gemini quality run failed", error); }
  }

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

function transferCandidateCrops(selected: Finding[], candidates: Candidate[]): Finding[] {
  const source = candidates.flatMap((candidate) => candidate.findings.map((finding) => ({ model: candidate.model, finding })));
  return selected.map((finding) => {
    const matches = source.filter(({ finding: candidate }) => candidate.title.toLowerCase().trim() === finding.title.toLowerCase().trim());
    if (!matches.length) return finding;
    return {
      ...finding,
      evidence: finding.evidence.map((item, evidenceIndex) => {
        if (item.crop) return item;
        const match = matches.find(({ finding: candidate }) => candidate.evidence.some((candidateEvidence) => candidateEvidence.section.toLowerCase() === item.section.toLowerCase() && candidateEvidence.element.toLowerCase() === item.element.toLowerCase() && Boolean(candidateEvidence.crop)));
        if (!match) return item;
        const candidateEvidence = match.finding.evidence.find((candidateEvidence) => candidateEvidence.section.toLowerCase() === item.section.toLowerCase() && candidateEvidence.element.toLowerCase() === item.element.toLowerCase() && Boolean(candidateEvidence.crop));
        return candidateEvidence?.crop ? { ...item, crop: candidateEvidence.crop } : item;
      })
    };
  });
}

function parseCrop(value: string | undefined): CropBox | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const numbers = [parsed.x, parsed.y, parsed.width, parsed.height];
    if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number))) return null;
    const x = Math.max(0, Math.min(1, Number(parsed.x)));
    const y = Math.max(0, Math.min(1, Number(parsed.y)));
    const width = Math.max(0, Math.min(1 - x, Number(parsed.width)));
    const height = Math.max(0, Math.min(1 - y, Number(parsed.height)));
    if (width < 0.04 || height < 0.02) return null;
    return { x, y, width, height };
  } catch { return null; }
}

function normalizeLocatedCrop(value: unknown, analysisWidth: number, analysisHeight: number): CropBox | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  const raw = [box.x, box.y, box.width, box.height];
  if (!raw.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  let [x, y, width, height] = raw as number[];
  const maxValue = Math.max(x, y, width, height);
  if (maxValue > 100) {
    x /= analysisWidth; width /= analysisWidth; y /= analysisHeight; height /= analysisHeight;
  } else if (maxValue > 1) {
    x /= 100; width /= 100; y /= 100; height /= 100;
  }
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  width = Math.max(0, Math.min(1 - x, width));
  height = Math.max(0, Math.min(1 - y, height));
  if (width < 0.04 || height < 0.02) return null;
  return { x, y, width, height };
}

async function locateEvidenceCrop(apiKey: string, findingId: string, evidenceIndex: number, evidence: Evidence, capture: Capture, analysisWidth: number, analysisHeight: number): Promise<{ key: string; crop: CropBox } | null> {
  const prompt = `Locate ONE exact visible UI region in this screenshot. This is not a UX evaluation task.\n\nFinding: ${findingId}\nEvidence index: ${evidenceIndex}\nSection: ${evidence.section}\nElement: ${evidence.element}\nDetail: ${evidence.detail}\n\nReturn only JSON: {"crop":{"x":0,"y":0,"width":0,"height":0}}. Coordinates may be normalized 0..1, percentages 0..100, or pixels relative to the supplied image. If using pixels, use the image dimensions ${analysisWidth}x${analysisHeight}. The crop MUST contain the exact element described plus a little surrounding context. Do not return a full-page crop. Do not explain your answer.`;
  for (const model of ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"]) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: capture.analysisBuffer.toString("base64") } }] }], generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", maxOutputTokens: 500, temperature: 0.0 } }),
        signal: AbortSignal.timeout(9000)
      });
      if (!response.ok) continue;
      const payload: any = await response.json();
      const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
      const json = extractJsonObject(text) as { crop?: unknown } | null;
      const crop = normalizeLocatedCrop(json?.crop, analysisWidth, analysisHeight);
      if (crop) return { key: `${findingId}:${evidenceIndex}`, crop };
    } catch {}
  }
  return null;
}

async function locateMissingEvidenceCrops(apiKey: string | undefined, findings: Finding[], capture: Capture): Promise<Finding[]> {
  if (!apiKey || !findings.length) return findings;
  const analysisMetadata = await sharp(capture.analysisBuffer).metadata();
  const analysisWidth = analysisMetadata.width ?? 1400;
  const analysisHeight = analysisMetadata.height ?? 5000;
  const jobs = findings.flatMap((finding) => finding.evidence.map((item, evidenceIndex) => ({ finding, item, evidenceIndex }))).filter((job) => !job.item.crop);
  if (!jobs.length) {
    console.log("[EvidenceLocator] all selected evidence already has model-generated crop coordinates");
    return findings;
  }
  console.log(`[EvidenceLocator] locating ${jobs.length} remaining evidence regions in parallel`);
  const located = await Promise.all(jobs.map((job) => locateEvidenceCrop(apiKey, job.finding.id, job.evidenceIndex, job.item, capture, analysisWidth, analysisHeight)));
  const boxes = new Map<string, CropBox>();
  located.forEach((item) => { if (item) boxes.set(item.key, item.crop); });
  console.log(`[EvidenceLocator] located ${boxes.size}/${jobs.length} remaining evidence regions`);
  return findings.map((finding) => ({
    ...finding,
    evidence: finding.evidence.map((item, evidenceIndex) => {
      const crop = boxes.get(`${finding.id}:${evidenceIndex}`);
      return crop ? { ...item, crop: JSON.stringify(crop) } : item;
    })
  }));
}

async function addEvidenceCrops(findings: Finding[], capture: Capture): Promise<Finding[]> {
  const metadata = await sharp(capture.buffer).metadata();
  const sourceWidth = metadata.width ?? capture.width;
  const sourceHeight = metadata.height ?? capture.height;
  const results = await Promise.all(findings.map(async (finding) => {
    const evidence = await Promise.all(finding.evidence.map(async (item) => {
      const crop = parseCrop(item.crop);
      if (!crop) return { section: item.section, element: item.element, detail: item.detail };
      try {
        const left = Math.max(0, Math.min(sourceWidth - 1, Math.round(crop.x * sourceWidth)));
        const top = Math.max(0, Math.min(sourceHeight - 1, Math.round(crop.y * sourceHeight)));
        const width = Math.max(1, Math.min(sourceWidth - left, Math.round(crop.width * sourceWidth)));
        const height = Math.max(1, Math.min(sourceHeight - top, Math.round(crop.height * sourceHeight)));
        const buffer = await sharp(capture.buffer)
          .extract({ left, top, width, height })
          .resize({ width: 1100, height: 700, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82, progressive: true, mozjpeg: true })
          .toBuffer();
        return { section: item.section, element: item.element, detail: item.detail, crop: `data:image/jpeg;base64,${buffer.toString("base64")}` };
      } catch (error) {
        console.warn("Evidence crop generation failed", error);
        return { section: item.section, element: item.element, detail: item.detail };
      }
    }));
    return { ...finding, evidence };
  }));
  return results;
}

async function enrichWithGemini(apiKey: string | undefined, findings: Finding[]): Promise<Finding[]> {
  if (!apiKey || !findings.length) return findings;
  const compact = findings.map((finding) => ({ id: finding.id, severity: finding.severity, category: finding.category, title: finding.title, description: finding.description, recommendation: finding.recommendation }));
  const prompt = `You are the UX standards/enrichment layer for a ScreenRoot UX audit. Do not invent or change the visual finding or its evidence. Based only on the supplied finding text, enrich each item with the most appropriate recognized UX law/principle, a concise accurate definition, a client-friendly assessment explaining why the visible issue relates to that principle, up to 3 practical ScreenRoot design tasks, and up to 3 practical developer tasks. Do not add findings. Do not change severity, category, title, description, recommendation, evidence, or IDs. Return JSON only: {"findings":[{"id":"...","uxPerspective":{"law":"...","definition":"...","assessment":"..."},"screenrootTasks":["..."],"devTasks":["..."]}]}. Findings: ${JSON.stringify(compact)}`;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", { method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", maxOutputTokens: 1400 } }), signal: AbortSignal.timeout(7000) });
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

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!openRouterKey && !geminiKey) throw new Error("Configure OPENROUTER_API_KEY or GEMINI_API_KEY before running an audit.");

  onStage?.({ id: "analyse", label: "Running multi-model analysis", detail: "Sending the screenshot to all configured multimodal models in parallel.", status: "active" });
  const prompt = buildAuditPrompt(`the uploaded screenshot (${filename})`, capture.width, capture.height);
  const candidates = await runAllVisionModels(openRouterKey, geminiKey, prompt, capture.analysisBuffer);
  onStage?.({ id: "analyse", label: "Running multi-model analysis", detail: `${candidates.length} vision model${candidates.length === 1 ? "" : "s"} returned usable analyses.`, status: "complete" });

  onStage?.({ id: "quality", label: "Running AI quality check", detail: "Comparing model findings and re-checking the strongest evidence against the screenshot.", status: "active" });
  const selected = await qualityRun(geminiKey, candidates, capture);
  const withModelCrops = transferCandidateCrops(selected, candidates);
  onStage?.({ id: "quality", label: "Running AI quality check", detail: `${withModelCrops.length} findings survived the quality check.`, status: "complete" });

  onStage?.({ id: "crops", label: "Preparing visual evidence", detail: "Using model-provided evidence locations and locating only any remaining gaps.", status: "active" });
  const located = await locateMissingEvidenceCrops(geminiKey, withModelCrops, capture);
  const cropped = await addEvidenceCrops(located, capture);
  const cropCount = cropped.reduce((count, finding) => count + finding.evidence.filter((item) => Boolean(item.crop)).length, 0);
  onStage?.({ id: "crops", label: "Preparing visual evidence", detail: `${cropCount} visual evidence crops prepared.`, status: "complete" });

  onStage?.({ id: "enrich", label: "Applying UX standards", detail: "Connecting selected findings to UX principles and practical redesign tasks.", status: "active" });
  const enriched = await enrichWithGemini(geminiKey, cropped);
  onStage?.({ id: "enrich", label: "Applying UX standards", detail: "UX principles and implementation guidance added.", status: "complete" });

  onStage?.({ id: "complete", label: "Finalising evidence report", detail: "Preparing the client-facing evidence report.", status: "active" });
  const page: AuditPage = { url: "Uploaded screenshot", title: capture.title, screenshot: `data:image/png;base64,${capture.buffer.toString("base64")}`, screenshotWidth: capture.width, screenshotHeight: capture.height, findings: enriched };
  onStage?.({ id: "complete", label: "Finalising evidence report", detail: `${enriched.length} evidence-backed findings ready for review.`, status: "complete" });
  return { pages: [page] };
}
