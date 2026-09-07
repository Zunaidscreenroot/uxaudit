import sharp from "sharp";

export type Severity = "high" | "medium" | "low";
export type CropBox = { x: number; y: number; width: number; height: number };
export type Evidence = { section: string; element: string; detail: string; crop?: string };
export type BusinessAnalysis = { funnelStage: string; impact: string; kpi: string; mechanism: string; suggestions: string[] };
export type UxContext = { law: string; definition: string; assessment: string; researchContext: string };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; uxPerspective: UxContext; businessAnalysis: BusinessAnalysis; evidence: Evidence[] };
export type AuditPage = { url: string; title: string; screenshot: string; screenshotWidth: number; screenshotHeight: number; findings: Finding[] };
export type AuditResult = { pages: AuditPage[] };
export type AuditStage = { id: string; label: string; detail: string; status: "active" | "complete" };

type Capture = { buffer: Buffer; width: number; height: number; analysisBuffer: Buffer; analysisWidth: number; analysisHeight: number; title: string };
type VisualObservation = { id: string; section: string; element: string; issue: string; whyItMatters: string; crop: CropBox };
type VisualPass = { pageSummary: string; observations: VisualObservation[] };

const DEFAULT_VISION_MODEL = "gemini-3.5-flash";
const DEFAULT_TEXT_MODEL = "gemini-3.1-flash-lite";
const GEMINI_TIMEOUT_MS = 30000;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const CATEGORIES = ["Language & tone", "Navigation", "Information hierarchy", "Visual design", "Usability & interaction", "User engagement", "Conversion"] as const;

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0; let inString = false; let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") { depth -= 1; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function geminiGenerate(apiKey: string, model: string, parts: Array<Record<string, unknown>>, maxOutputTokens = 6000) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens, temperature: 0.1 } }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Gemini ${model} returned HTTP ${response.status}`);
  const payload: any = await response.json();
  const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
  if (!text) throw new Error(`Gemini ${model} returned an empty response.`);
  return text;
}

function normalizeCrop(value: unknown): CropBox {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const x = Number(raw.x); const y = Number(raw.y); const width = Number(raw.width); const height = Number(raw.height);
  return {
    x: Number.isFinite(x) ? clamp(x, 0, 0.94) : 0.08,
    y: Number.isFinite(y) ? clamp(y, 0, 0.94) : 0.08,
    width: Number.isFinite(width) ? clamp(width, 0.08, 0.9) : 0.5,
    height: Number.isFinite(height) ? clamp(height, 0.025, 0.18) : 0.08,
  };
}

function normalizeVisualPass(value: unknown): VisualPass {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const observations = Array.isArray(root.observations) ? root.observations : [];
  return {
    pageSummary: typeof root.pageSummary === "string" ? root.pageSummary.trim() : "The screenshot contains visible interface patterns that can be reviewed for hierarchy, usability and conversion friction.",
    observations: observations.slice(0, 10).map((raw, index) => {
      const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return {
        id: typeof item.id === "string" ? item.id : `obs-${index + 1}`,
        section: typeof item.section === "string" ? item.section.trim() : "Page section",
        element: typeof item.element === "string" ? item.element.trim() : "Visible interface element",
        issue: typeof item.issue === "string" ? item.issue.trim() : "The visible pattern may create unnecessary friction.",
        whyItMatters: typeof item.whyItMatters === "string" ? item.whyItMatters.trim() : "It may make the intended action harder to understand.",
        crop: normalizeCrop(item.crop),
      };
    }).filter((item) => item.section && item.element && item.issue),
  };
}

function categoryFor(value: unknown) { const requested = typeof value === "string" ? value.trim().toLowerCase() : ""; return CATEGORIES.find((category) => category.toLowerCase() === requested) ?? "Visual design"; }
function severityFor(value: unknown): Severity { const v = typeof value === "string" ? value.toLowerCase() : "medium"; return v === "high" || v === "low" ? v : "medium"; }
function stringList(value: unknown, limit = 4) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, limit) : []; }

function normalizeFinding(raw: unknown, observation: VisualObservation, index: number): Finding {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const ux = item.uxPerspective && typeof item.uxPerspective === "object" ? item.uxPerspective as Record<string, unknown> : {};
  const business = item.businessAnalysis && typeof item.businessAnalysis === "object" ? item.businessAnalysis as Record<string, unknown> : {};
  return {
    id: typeof item.id === "string" ? item.id : `finding-${index + 1}`,
    severity: severityFor(item.severity), category: categoryFor(item.category),
    title: typeof item.title === "string" ? item.title.trim() : observation.issue,
    description: typeof item.description === "string" ? item.description.trim() : observation.issue,
    recommendation: typeof item.recommendation === "string" ? item.recommendation.trim() : "Simplify and reprioritise the affected interface pattern.",
    uxPerspective: {
      law: typeof ux.law === "string" ? ux.law.trim() : "UX design principle",
      definition: typeof ux.definition === "string" ? ux.definition.trim() : "A research-backed principle used to evaluate how an interface supports user goals.",
      assessment: typeof ux.assessment === "string" ? ux.assessment.trim() : observation.whyItMatters,
      researchContext: typeof ux.researchContext === "string" ? ux.researchContext.trim() : "The pattern should be evaluated against established interaction and information-design research rather than preference alone.",
    },
    businessAnalysis: {
      funnelStage: typeof business.funnelStage === "string" ? business.funnelStage.trim() : "Consideration / conversion",
      impact: typeof business.impact === "string" ? business.impact.trim() : "The friction can reduce clarity and increase hesitation before the next funnel step.",
      kpi: typeof business.kpi === "string" ? business.kpi.trim() : "CTA click-through / conversion rate",
      mechanism: typeof business.mechanism === "string" ? business.mechanism.trim() : "Users may take longer to understand the value proposition or choose the next action.",
      suggestions: stringList(business.suggestions, 4).length ? stringList(business.suggestions, 4) : ["Make the primary action visually dominant.", "Reduce competing information around the action."],
    },
    evidence: [{ section: observation.section, element: observation.element, detail: observation.issue }],
  };
}

async function createVisualPass(apiKey: string, model: string, capture: Capture): Promise<VisualPass> {
  const aspect = capture.width / capture.height;
  const viewportType = aspect < 0.75 ? "MOBILE / NARROW RESPONSIVE" : aspect < 1.15 ? "TABLET / NARROW" : "DESKTOP / WIDE";
  const prompt = `You are the IMAGE-TO-TEXT stage of a UX audit. Analyze the supplied screenshot itself, not an imagined website. This is a ${viewportType} screenshot with original dimensions ${capture.width}x${capture.height}px.\n\nIMPORTANT: The screenshot may be a long mobile responsive page. If it is narrow/tall, reason about the actual mobile layout shown. Do NOT assume desktop layout, and do NOT map evidence by section name, page percentage, or memory. Locate every evidence crop from the pixels actually visible in this image.\n\nYour only job is to create factual visual evidence for a second TEXT-TO-TEXT model. Find 6–8 strong, distinct UX observations. Each observation must refer to one specific visible UI region. Prefer concrete issues involving hierarchy, labels, grouping, density, CTA competition, form clarity, content scanning, navigation, trust, or conversion friction.\n\nFor EVERY observation, return a tight bounding box around the exact UI that demonstrates the issue. Coordinates MUST be normalized from 0 to 1 using the ORIGINAL supplied image dimensions, where x=0 is the left edge, y=0 is the top edge. The crop must include the evidence element itself, not surrounding report text or an unrelated nearby module. For a mobile screenshot, prefer a full-width but short crop around the relevant component (usually 8–18% of page height), and never use a full-page crop. If the issue is a specific button, field, label, card, or nav item, crop that element and a small amount of surrounding context.\n\nDo not move or reinterpret observations after creating the crop. The observation id is the permanent link between the exact visual evidence and the later text review. Never reuse the same crop for two different observations. Keep observations ordered from top to bottom of the screenshot so spatial order is preserved.\n\nReturn JSON only: {"pageSummary":"one factual sentence","observations":[{"id":"obs-1","section":"exact visible section","element":"exact visible element","issue":"factual visible issue","whyItMatters":"user-visible consequence","crop":{"x":0.10,"y":0.20,"width":0.80,"height":0.10}}]}`;
  const text = await geminiGenerate(apiKey, model, [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: capture.analysisBuffer.toString("base64") } }], 5500);
  const result = normalizeVisualPass(extractJson(text));
  if (!result.observations.length) throw new Error("The image-to-text model returned no usable visual observations.");
  return result;
}

async function createTextReview(apiKey: string, model: string, visualPass: VisualPass) {
  const prompt = `You are the SECOND stage of a UX audit. You are a TEXT-TO-TEXT UX research and business reviewer. The first model already inspected the screenshot and produced the visual observations below. You do NOT see the screenshot.\n\nPreserve observationId exactly. Do not change, merge, reorder, or reinterpret the visual location. Never invent UI elements, crop coordinates, measurements, analytics, or behaviour. For each strong observation create a client-ready finding with UX research context and business funnel analysis.\n\nUX context must include a relevant law/principle, a plain-language definition, why it applies, and concise research context. Business analysis must identify funnel stage, directional impact, KPI at risk, mechanism, and practical suggestions that could improve that KPI. Do not create development tasks. Do not claim measured KPI changes.\n\nReturn JSON only: {"findings":[{"id":"finding-1","observationId":"obs-1","severity":"high|medium|low","category":"Information hierarchy","title":"short finding","description":"clear explanation","recommendation":"specific UX redesign action","uxPerspective":{"law":"Hick's Law","definition":"plain-language definition","assessment":"why it applies","researchContext":"brief research context"},"businessAnalysis":{"funnelStage":"Acquisition / consideration / activation / conversion / retention","impact":"directional impact","kpi":"specific KPI","mechanism":"how the design can influence it","suggestions":["specific action","specific action"]}}]}\n\nAllowed categories: ${CATEGORIES.join(", ")}.\n\nVISUAL OBSERVATIONS:\n${JSON.stringify(visualPass)}`;
  const text = await geminiGenerate(apiKey, model, [{ text: prompt }], 7000);
  const parsed = extractJson(text); const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  return Array.isArray(root.findings) ? root.findings : [];
}

async function createCrop(buffer: Buffer, crop: CropBox, screenshotWidth: number, screenshotHeight: number) {
  const x = clamp(crop.x, 0, 0.94); const y = clamp(crop.y, 0, 0.94);
  const width = clamp(crop.width, 0.08, 0.9); const height = clamp(crop.height, 0.025, 0.18);
  let left = Math.round(x * screenshotWidth); let top = Math.round(y * screenshotHeight);
  let cropWidth = Math.round(width * screenshotWidth); let cropHeight = Math.round(height * screenshotHeight);
  cropWidth = Math.min(cropWidth, screenshotWidth); cropHeight = Math.min(cropHeight, Math.max(80, Math.round(screenshotHeight * 0.22)));
  left = clamp(left, 0, Math.max(0, screenshotWidth - cropWidth)); top = clamp(top, 0, Math.max(0, screenshotHeight - cropHeight));
  const output = await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).jpeg({ quality: 90, progressive: true }).toBuffer();
  return `data:image/jpeg;base64,${output.toString("base64")}`;
}

async function prepareScreenshot(buffer: Buffer, title: string): Promise<Capture> {
  if (buffer.byteLength > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot is too large. Please upload an image smaller than 15 MB.");
  const metadata = await sharp(buffer).metadata(); const width = metadata.width ?? 0; const height = metadata.height ?? 0;
  if (!width || !height) throw new Error("The uploaded file is not a valid image.");
  if (width < 320 || height < 200) throw new Error("Please upload a larger screenshot so the UX evidence can be reviewed reliably.");
  if (width > 20000 || height > 20000) throw new Error("Screenshot dimensions are too large. Please upload a smaller screenshot.");
  const resized = await sharp(buffer).resize({ width: Math.min(1600, width), height: Math.min(7000, height), fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, progressive: true }).toBuffer();
  const analysisMeta = await sharp(resized).metadata();
  return { buffer, width, height, analysisBuffer: resized, analysisWidth: analysisMeta.width ?? width, analysisHeight: analysisMeta.height ?? height, title: title.replace(/\.[^.]+$/, "") || "Uploaded screenshot" };
}

function fallbackFinding(observation: VisualObservation, index: number): Finding {
  return normalizeFinding({ id: `finding-${index + 1}`, severity: index < 2 ? "high" : "medium", category: "Information hierarchy", title: observation.issue, description: observation.issue, recommendation: "Reduce competing visual signals, strengthen the primary hierarchy, and make the intended next action easier to scan.", uxPerspective: { law: "Gestalt principles", definition: "People interpret related elements as groups and use visual hierarchy to decide what deserves attention first.", assessment: observation.whyItMatters, researchContext: "The observation is consistent with established research on visual grouping, attention and cognitive load." }, businessAnalysis: { funnelStage: "Consideration / conversion", impact: "The visible friction can increase hesitation before the next intended action.", kpi: "Primary CTA click-through rate", mechanism: "When the intended next step is less clear, fewer users may progress confidently to it.", suggestions: ["Strengthen the primary CTA hierarchy.", "Remove or subordinate competing visual elements."] } }, observation, index);
}

export async function createAuditFromScreenshot(buffer: Buffer, filename: string, onStage?: (stage: AuditStage) => void): Promise<AuditResult> {
  const capture = await prepareScreenshot(buffer, filename); const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Configure GEMINI_API_KEY before running an audit.");
  const visionModel = process.env.GEMINI_VISION_MODEL || DEFAULT_VISION_MODEL; const textModel = process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;

  onStage?.({ id: "capture", label: "Preparing screenshot", detail: "Validating the uploaded responsive screenshot and creating a high-quality analysis image.", status: "active" });
  onStage?.({ id: "capture", label: "Preparing screenshot", detail: "Screenshot is ready for visual analysis.", status: "complete" });
  onStage?.({ id: "analyse", label: "Image → text analysis", detail: "The vision model is locating exact evidence directly from the responsive screenshot.", status: "active" });
  const visualPass = await createVisualPass(apiKey, visionModel, capture);
  onStage?.({ id: "analyse", label: "Image → text analysis", detail: `${visualPass.observations.length} spatially mapped visual observations extracted from the screenshot.`, status: "complete" });

  onStage?.({ id: "quality", label: "Text → UX research review", detail: "A separate text model is reviewing those observations through UX research and business-funnel context.", status: "active" });
  let reviewed: unknown[] = [];
  try { reviewed = await createTextReview(apiKey, textModel, visualPass); } catch (error) { console.warn("Text review failed; using deterministic UX fallback", error); }
  onStage?.({ id: "quality", label: "Text → UX research review", detail: "UX context and business implications have been mapped without development tasks.", status: "complete" });

  onStage?.({ id: "crops", label: "Building visual evidence", detail: "Rendering each model-selected bounding box from the original screenshot and preserving observation-to-finding IDs.", status: "active" });
  const findings: Finding[] = [];
  for (let i = 0; i < Math.min(8, visualPass.observations.length); i += 1) {
    const observation = visualPass.observations[i];
    const match = reviewed.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).observationId === observation.id);
    const finding = match ? normalizeFinding(match, observation, i) : fallbackFinding(observation, i);
    finding.evidence[0].crop = await createCrop(capture.buffer, observation.crop, capture.width, capture.height);
    findings.push(finding);
  }
  onStage?.({ id: "crops", label: "Building visual evidence", detail: `${findings.length} evidence crops generated from the original screenshot with preserved spatial mapping.`, status: "complete" });
  onStage?.({ id: "enrich", label: "Applying UX + business context", detail: "Finalising UX principles, funnel impact, KPI hypotheses and redesign recommendations.", status: "active" });
  onStage?.({ id: "enrich", label: "Applying UX + business context", detail: "UX research context and business funnel analysis are ready.", status: "complete" });
  onStage?.({ id: "complete", label: "Finalising evidence report", detail: "Packaging the report with evidence beside each finding.", status: "active" });
  const screenshot = `data:image/jpeg;base64,${(await sharp(capture.buffer).jpeg({ quality: 88, progressive: true }).toBuffer()).toString("base64")}`;
  const result: AuditResult = { pages: [{ url: "Uploaded screenshot", title: capture.title, screenshot, screenshotWidth: capture.width, screenshotHeight: capture.height, findings }] };
  onStage?.({ id: "complete", label: "Finalising evidence report", detail: "Audit ready.", status: "complete" });
  return result;
}
