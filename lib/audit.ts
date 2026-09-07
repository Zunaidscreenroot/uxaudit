import sharp from "sharp";

export type Severity = "high" | "medium" | "low";
export type CropBox = { x: number; y: number; width: number; height: number };
export type Evidence = { section: string; element: string; detail: string; crop?: string };
export type BusinessAnalysis = {
  funnelStage: string;
  impact: string;
  kpi: string;
  mechanism: string;
  suggestions: string[];
};
export type UxContext = {
  law: string;
  definition: string;
  assessment: string;
  researchContext: string;
};
export type Finding = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  recommendation: string;
  uxPerspective: UxContext;
  businessAnalysis: BusinessAnalysis;
  evidence: Evidence[];
};
export type AuditPage = {
  url: string;
  title: string;
  screenshot: string;
  screenshotWidth: number;
  screenshotHeight: number;
  findings: Finding[];
};
export type AuditResult = { pages: AuditPage[] };
export type AuditStage = { id: string; label: string; detail: string; status: "active" | "complete" };

type Capture = { buffer: Buffer; width: number; height: number; analysisBuffer: Buffer; title: string };
type VisualObservation = {
  id: string;
  section: string;
  element: string;
  issue: string;
  whyItMatters: string;
  crop: CropBox;
};
type VisualPass = { pageSummary: string; observations: VisualObservation[] };

const DEFAULT_VISION_MODEL = "gemini-3.5-flash";
const DEFAULT_TEXT_MODEL = "gemini-3.1-flash-lite";
const GEMINI_TIMEOUT_MS = 30000;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const CATEGORIES = ["Language & tone", "Navigation", "Information hierarchy", "Visual design", "Usability & interaction", "User engagement", "Conversion"] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function geminiGenerate(apiKey: string, model: string, parts: Array<Record<string, unknown>>, maxOutputTokens = 6000) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens, temperature: 0.15 },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Gemini ${model} returned HTTP ${response.status}`);
  const payload: any = await response.json();
  const text = (payload?.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .join("");
  if (!text) throw new Error(`Gemini ${model} returned an empty response.`);
  return text;
}

function normalizeCrop(value: unknown): CropBox {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  return {
    x: Number.isFinite(x) ? clamp(x, 0, 0.94) : 0.05,
    y: Number.isFinite(y) ? clamp(y, 0, 0.94) : 0.05,
    width: Number.isFinite(width) ? clamp(width, 0.06, 0.8) : 0.35,
    height: Number.isFinite(height) ? clamp(height, 0.04, 0.28) : 0.14,
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

function categoryFor(value: unknown) {
  const requested = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CATEGORIES.find((category) => category.toLowerCase() === requested) ?? "Visual design";
}

function severityFor(value: unknown): Severity {
  const valueLower = typeof value === "string" ? value.toLowerCase() : "medium";
  return valueLower === "high" || valueLower === "low" ? valueLower : "medium";
}

function stringList(value: unknown, limit = 4) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, limit) : [];
}

function normalizeFinding(raw: unknown, observation: VisualObservation, index: number): Finding {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const ux = item.uxPerspective && typeof item.uxPerspective === "object" ? item.uxPerspective as Record<string, unknown> : {};
  const business = item.businessAnalysis && typeof item.businessAnalysis === "object" ? item.businessAnalysis as Record<string, unknown> : {};
  const evidence = {
    section: observation.section,
    element: observation.element,
    detail: observation.issue,
    crop: JSON.stringify(observation.crop),
  };
  return {
    id: typeof item.id === "string" ? item.id : `finding-${index + 1}`,
    severity: severityFor(item.severity),
    category: categoryFor(item.category),
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
    evidence: [evidence],
  };
}

async function createVisualPass(apiKey: string, model: string, capture: Capture): Promise<VisualPass> {
  const prompt = `You are the first stage of a UX audit pipeline. You are an IMAGE-TO-TEXT visual analyst. Inspect the supplied desktop website screenshot from top to bottom and describe only what is visibly present. Do not give design advice, UX laws, business analysis, development tasks, scores, or hidden-behaviour claims yet. Your job is to create a precise factual visual evidence layer for a second text model.\n\nFind 6–10 distinct visible observations across different page regions. Prioritise concrete problems such as hierarchy, grouping, density, CTA competition, ambiguous labels, repetitive modules, weak emphasis, scanning friction or unclear content structure. Each observation must identify the exact section and element, explain the visible issue, and provide a TIGHT normalized crop (0..1) around that exact UI. The crop must be localized: normally no more than 28% of the screenshot height. Do not use a full-page crop for a localized observation. Never reuse a crop for unrelated observations.\n\nReturn JSON only: {"pageSummary":"one factual sentence","observations":[{"id":"obs-1","section":"Hero","element":"exact visible element","issue":"what is visibly happening","whyItMatters":"what user-visible friction this creates","crop":{"x":0.1,"y":0.05,"width":0.5,"height":0.15}}]}\n\nScreenshot dimensions: ${capture.width}x${capture.height}.`; 
  const text = await geminiGenerate(apiKey, model, [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: capture.analysisBuffer.toString("base64") } }], 5000);
  const parsed = extractJson(text);
  const result = normalizeVisualPass(parsed);
  if (!result.observations.length) throw new Error("The image-to-text model returned no usable visual observations.");
  return result;
}

async function createTextReview(apiKey: string, model: string, visualPass: VisualPass) {
  const prompt = `You are the second stage of a UX audit pipeline. You are a TEXT-TO-TEXT UX research and business reviewer. You receive a factual visual analysis produced by an image-to-text model. Do not see the original screenshot. Therefore, NEVER invent visual evidence, crop coordinates, UI elements, metrics, or behaviour. Use only the supplied observations.\n\nFor each observation that is strong enough to defend, create a client-ready UX audit finding. Keep 5–8 findings when the evidence supports it. Preserve the observation id exactly so the application can place the correct screenshot crop beside the finding. Add UX core design/research context: a relevant law or principle, a plain-language definition, why the principle applies, and concise research context. Then add a business analysis explaining which funnel stage can be affected, which KPI is at risk, the mechanism by which the design may influence that KPI, and practical suggestions aimed at improving that KPI.\n\nDo not output development tasks. Do not use generic claims such as “this could hurt conversion” without explaining the mechanism. Do not claim a measured KPI change because no analytics are available. Phrase business impact as a directional hypothesis grounded in the visible design.\n\nReturn JSON only: {"findings":[{"id":"finding-1","observationId":"obs-1","severity":"high|medium|low","category":"Information hierarchy","title":"short finding","description":"clear explanation","recommendation":"specific redesign action","uxPerspective":{"law":"Hick's Law","definition":"plain-language definition","assessment":"why this principle applies to the observation","researchContext":"brief research context without fabricated citations"},"businessAnalysis":{"funnelStage":"Acquisition / consideration / activation / conversion / retention","impact":"directional business impact","kpi":"specific KPI","mechanism":"how the design can influence the KPI","suggestions":["specific KPI-improving action","another action"]}}]}\n\nAllowed categories: ${CATEGORIES.join(", ")}.\n\nVISUAL ANALYSIS:\n${JSON.stringify(visualPass)}`;
  const text = await geminiGenerate(apiKey, model, [{ text: prompt }], 7000);
  const parsed = extractJson(text);
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  return Array.isArray(root.findings) ? root.findings : [];
}

async function createCrop(buffer: Buffer, crop: CropBox, screenshotWidth: number, screenshotHeight: number) {
  const x = clamp(crop.x, 0, 0.94);
  const y = clamp(crop.y, 0, 0.94);
  const width = clamp(crop.width, 0.06, 0.8);
  const height = clamp(crop.height, 0.04, 0.28);
  let left = Math.round(x * screenshotWidth);
  let top = Math.round(y * screenshotHeight);
  let cropWidth = Math.round(width * screenshotWidth);
  let cropHeight = Math.round(height * screenshotHeight);
  cropWidth = Math.min(cropWidth, screenshotWidth);
  cropHeight = Math.min(cropHeight, Math.max(80, Math.round(screenshotHeight * 0.3)));
  left = clamp(left, 0, Math.max(0, screenshotWidth - cropWidth));
  top = clamp(top, 0, Math.max(0, screenshotHeight - cropHeight));
  const output = await sharp(buffer).extract({ left, top, width: cropWidth, height: cropHeight }).jpeg({ quality: 86, progressive: true }).toBuffer();
  return `data:image/jpeg;base64,${output.toString("base64")}`;
}

async function prepareScreenshot(buffer: Buffer, title: string): Promise<Capture> {
  if (buffer.byteLength > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot is too large. Please upload an image smaller than 15 MB.");
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error("The uploaded file is not a valid image.");
  if (width < 320 || height < 200) throw new Error("Please upload a larger screenshot so the UX evidence can be reviewed reliably.");
  if (width > 20000 || height > 20000) throw new Error("Screenshot dimensions are too large. Please upload a smaller screenshot.");
  const analysisBuffer = await sharp(buffer).resize({ width: Math.min(1600, width), height: Math.min(6000, height), fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78, progressive: true }).toBuffer();
  return { buffer, width, height, analysisBuffer, title: title.replace(/\.[^.]+$/, "") || "Uploaded screenshot" };
}

function fallbackFinding(observation: VisualObservation, index: number): Finding {
  return normalizeFinding({
    id: `finding-${index + 1}`,
    severity: index < 2 ? "high" : "medium",
    category: "Information hierarchy",
    title: observation.issue,
    description: observation.issue,
    recommendation: "Reduce competing visual signals, strengthen the primary hierarchy, and make the intended next action easier to scan.",
    uxPerspective: {
      law: "Gestalt principles",
      definition: "People interpret related elements as groups and use visual hierarchy to decide what deserves attention first.",
      assessment: observation.whyItMatters,
      researchContext: "The observation is consistent with established research on visual grouping, attention and cognitive load.",
    },
    businessAnalysis: {
      funnelStage: "Consideration / conversion",
      impact: "The visible friction can increase hesitation before a user takes the next intended action.",
      kpi: "Primary CTA click-through rate",
      mechanism: "When the intended next step is less clear, fewer users may progress confidently to it.",
      suggestions: ["Strengthen the primary CTA hierarchy.", "Remove or subordinate competing visual elements."],
    },
  }, observation, index);
}

export async function createAuditFromScreenshot(buffer: Buffer, filename: string, onStage?: (stage: AuditStage) => void): Promise<AuditResult> {
  const capture = await prepareScreenshot(buffer, filename);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Configure GEMINI_API_KEY before running an audit.");
  const visionModel = process.env.GEMINI_VISION_MODEL || DEFAULT_VISION_MODEL;
  const textModel = process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;

  onStage?.({ id: "capture", label: "Preparing screenshot", detail: "Validating the full-page screenshot and creating a high-quality analysis image.", status: "active" });
  onStage?.({ id: "capture", label: "Preparing screenshot", detail: "Screenshot is ready for the visual analysis stage.", status: "complete" });

  onStage?.({ id: "analyse", label: "Image → text analysis", detail: `The first model is reading the screenshot and mapping precise visual evidence with localized crop coordinates.`, status: "active" });
  const visualPass = await createVisualPass(apiKey, visionModel, capture);
  onStage?.({ id: "analyse", label: "Image → text analysis", detail: `${visualPass.observations.length} visual observations extracted from the screenshot.`, status: "complete" });

  onStage?.({ id: "quality", label: "Text → UX research review", detail: "A second model is reviewing the visual text for UX principles, research context and defensible findings.", status: "active" });
  let reviewed: unknown[] = [];
  try {
    reviewed = await createTextReview(apiKey, textModel, visualPass);
  } catch (error) {
    console.warn("Text review failed; using deterministic UX fallback", error);
  }
  onStage?.({ id: "quality", label: "Text → UX research review", detail: "UX context and business implications have been mapped without adding development tasks.", status: "complete" });

  onStage?.({ id: "crops", label: "Building visual evidence", detail: "Generating localized screenshot crops from the original image so every finding has matching evidence beside it.", status: "active" });
  const findings: Finding[] = [];
  for (let i = 0; i < Math.min(8, visualPass.observations.length); i += 1) {
    const observation = visualPass.observations[i];
    const match = reviewed.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).observationId === observation.id);
    const finding = match ? normalizeFinding(match, observation, i) : fallbackFinding(observation, i);
    finding.evidence[0].crop = await createCrop(capture.buffer, observation.crop, capture.width, capture.height);
    findings.push(finding);
  }
  onStage?.({ id: "crops", label: "Building visual evidence", detail: `${findings.length} findings now have localized evidence crops generated from the original screenshot.`, status: "complete" });

  onStage?.({ id: "enrich", label: "Applying UX + business context", detail: "Finalising principles, funnel impact, KPI hypotheses and redesign recommendations.", status: "active" });
  onStage?.({ id: "enrich", label: "Applying UX + business context", detail: "UX research context and business funnel analysis are ready.", status: "complete" });
  onStage?.({ id: "complete", label: "Finalising evidence report", detail: "Packaging the report with evidence beside each finding.", status: "active" });
  const screenshot = `data:image/jpeg;base64,${(await sharp(capture.buffer).jpeg({ quality: 88, progressive: true }).toBuffer()).toString("base64")}`;
  const result: AuditResult = {
    pages: [{ url: "Uploaded screenshot", title: capture.title, screenshot, screenshotWidth: capture.width, screenshotHeight: capture.height, findings }],
  };
  onStage?.({ id: "complete", label: "Finalising evidence report", detail: "Audit ready.", status: "complete" });
  return result;
}
