import { retrieveRelevantAuditKnowledge } from "@/lib/knowledge-base";
import type { SharedBrainScope } from "@/lib/shared-brain";
import sharp from "sharp";

export type Severity = "high" | "medium" | "low";
export type MarkerPoint = { x: number; y: number };
export type Evidence = { section: string; element: string; detail: string; marker?: MarkerPoint };
export type BusinessAnalysis = { funnelStage: string; impact: string; kpi: string; mechanism: string; suggestions: string[] };
export type UxContext = { law: string; definition: string; assessment: string; researchContext: string };
export type Finding = { id: string; severity: Severity; category: string; title: string; description: string; recommendation: string; uxPerspective: UxContext; businessAnalysis: BusinessAnalysis; evidence: Evidence[] };
export type AuditPage = { id?: string; clientName: string; url: string; title: string; screenshot: string; screenshotWidth: number; screenshotHeight: number; findings: Finding[]; createdAt?: string; auditMode?: "desktop" | "mobile"; viewportWidth?: number; viewportHeight?: number };
export type AuditResult = { pages: AuditPage[] };
export type AuditStage = { id: string; label: string; detail: string; status: "active" | "complete" };

type Capture = { buffer: Buffer; width: number; height: number; analysisBuffer: Buffer; title: string };
type VisualObservation = { id: string; section: string; element: string; issue: string; whyItMatters: string; marker: MarkerPoint };
type VisualPass = { clientName: string; pageSummary: string; observations: VisualObservation[] };

const DEFAULT_VISION_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_TEXT_MODEL = "gemini-3.1-flash-lite";
const GEMINI_TIMEOUT_MS = 30000;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const CATEGORIES = ["Navigation", "Information hierarchy", "Usability & interaction", "Content & tone", "Visual design", "Responsiveness", "Web performance"] as const;

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

type VerifiedModel = {provider:"OpenRouter"|"Gemini";model:string;tier:"free"|"paid"};
async function modelGenerate(model: VerifiedModel, parts: Array<Record<string, unknown>>, maxOutputTokens = 6000, timeoutMs = 12000) {
 if(model.provider!=="OpenRouter")throw new Error("Only verified OpenRouter models are enabled for UX Audit.");
 const key=process.env.OPENROUTER_API_KEY;if(!key)throw new Error("Configure OPENROUTER_API_KEY before running an audit.");
 const content:any[]=[];for(const part of parts){if(typeof part.text==="string")content.push({type:"text",text:part.text});else if(part.inline_data&&typeof part.inline_data==="object"){const im=part.inline_data as {mime_type?:string;data?:string};if(im.data)content.push({type:"image_url",image_url:{url:"data:"+(im.mime_type||"image/jpeg")+";base64,"+im.data}});}}
 let lastError="OpenRouter model request failed.";const started=Date.now();
 try{
  const stage=parts.some(p=>typeof p.text==="string"&&/IMAGE-TO-TEXT stage/.test(String(p.text)))?"visual":"text";
  console.info("[uxaudit] model_request_start",JSON.stringify({model:model.model,stage,timeoutMs,maxOutputTokens}));
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json","HTTP-Referer":"https://uxauditscreenroot.vercel.app","X-Title":"UX Audit","X-OpenRouter-Metadata":"enabled"},body:JSON.stringify({model:model.model,messages:[{role:"user",content}],max_tokens:maxOutputTokens,temperature:0.1,reasoning:{effort:"low",exclude:true},response_format:{type:"json_object"},plugins:[{id:"auto-router",cost_tier:"low"}],provider:{allow_fallbacks:true,max_price:{prompt:0.5,completion:2}}}),signal:AbortSignal.timeout(timeoutMs),cache:"no-store"});
  const rawBody=await response.text();let payload:any={};try{payload=rawBody?JSON.parse(rawBody):{};}catch{throw new Error("OpenRouter returned invalid JSON (HTTP "+response.status+"): "+rawBody.slice(0,180));}
  if(response.ok){
   const message=payload?.choices?.[0]?.message;const raw=message?.content;
   const text=typeof raw==="string"?raw:Array.isArray(raw)?raw.map((x:any)=>x?.text??x?.content??"").join(""):"";
   if(text.trim()){console.info("[uxaudit] model_request_ok",JSON.stringify({requestedModel:model.model,actualModel:payload?.model??null,stage,elapsedMs:Date.now()-started,finishReason:payload?.choices?.[0]?.finish_reason??null,usage:payload?.usage??null,routerMetadata:payload?.openrouter_metadata??null}));return text;}
   const finish=payload?.choices?.[0]?.finish_reason??"unknown";const usage=payload?.usage??{};const messageKeys=message&&typeof message==="object"?Object.keys(message):[];
   console.warn("[uxaudit] openrouter_empty_response",JSON.stringify({requestedModel:model.model,actualModel:payload?.model??null,requestId:payload?.id??null,stage,finishReason:finish,usage,messageFields:messageKeys,contentType:Array.isArray(raw)?"array":typeof raw,contentLength:typeof raw==="string"?raw.length:Array.isArray(raw)?raw.length:0,reasoningLength:typeof message?.reasoning==="string"?message.reasoning.length:0}));lastError="HTTP 200 but no final text (finish_reason="+finish+", prompt_tokens="+(usage.prompt_tokens??"?")+", completion_tokens="+(usage.completion_tokens??"?")+", message_fields="+messageKeys.join(",")+")";
  }else lastError="OpenRouter "+model.model+" returned HTTP "+response.status+": "+(payload?.error?.message??rawBody.slice(0,180)??"Provider request failed");
 }catch(e){lastError=e instanceof Error?(e.name==="TimeoutError"||e.name==="AbortError"?"Timed out after "+timeoutMs+"ms waiting for "+model.model+".":e.message):"OpenRouter request failed";}
 console.warn("[uxaudit] model_request_failed",JSON.stringify({model:model.model,elapsedMs:Date.now()-started,error:lastError}));throw new Error(lastError);
}

function normalizeMarker(value: unknown): MarkerPoint {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const x = Number(raw.x); const y = Number(raw.y);
  return { x: Number.isFinite(x) ? clamp(x, 0.02, 0.98) : 0.5, y: Number.isFinite(y) ? clamp(y, 0.02, 0.98) : 0.5 };
}

function normalizeVisualPass(value: unknown): VisualPass {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const candidate = root.observations ?? root.visualObservations ?? root.issues ?? root.findings ?? root.items;
  const observations = Array.isArray(candidate) ? candidate : [];
  const rawClientName = typeof root.clientName === "string" ? root.clientName.trim() : typeof root.brandName === "string" ? root.brandName.trim() : "";
  return {
    clientName: rawClientName || "Unknown client",
    pageSummary: typeof root.pageSummary === "string" ? root.pageSummary.trim() : typeof root.summary === "string" ? root.summary.trim() : "The screenshot contains visible interface patterns that can be reviewed for hierarchy, usability and conversion friction.",
    observations: observations.slice(0, 10).map((raw, index) => {
      const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const issue = item.issue ?? item.problem ?? item.title ?? item.description;
      const section = item.section ?? item.region ?? item.area;
      const element = item.element ?? item.component ?? item.target;
      const why = item.whyItMatters ?? item.impact ?? item.rationale;
      return {
        id: typeof item.id === "string" ? item.id : typeof item.observationId === "string" ? item.observationId : `obs-${index + 1}`,
        section: typeof section === "string" && section.trim() ? section.trim() : "Visible screenshot region",
        element: typeof element === "string" && element.trim() ? element.trim() : "Visible interface element",
        issue: typeof issue === "string" ? issue.trim() : "",
        whyItMatters: typeof why === "string" && why.trim() ? why.trim() : "This visible pattern may make the intended action harder to understand.",
        marker: normalizeMarker(item.marker ?? item.point ?? item.coordinates),
      };
    }).filter((item) => item.issue.length > 0),
  };
}

function normalizeIssueText(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " "); }

function inferredCategory(observation: VisualObservation): typeof CATEGORIES[number] {
  const text = normalizeIssueText([observation.section, observation.element, observation.issue, observation.whyItMatters].join(" "));
  if (/\b(responsive|responsiveness|mobile|viewport|breakpoint|horizontal overflow|clipped|off screen|screen width|stacked layout|touch target|thumb reach)\b/.test(text)) return "Responsiveness";
  if (/\b(performance|slow|loading time|load time|latency|spinner|skeleton|loading state|unloaded|page speed|web vital|lcp|cls|inp)\b/.test(text)) return "Web performance";
  if (/\b(navigation|nav bar|navbar|menu|breadcrumb|sitemap|page not found|discoverability|discoverable|menu item|navigation item|tabs?)\b/.test(text)) return "Navigation";
  if (/\b(form|button|click|tap|checkbox|radio button|stepper|input|dropdown|select control|interactive|interaction|disabled|error state|feedback|submit|login|sign in|control)\b/.test(text)) return "Usability & interaction";
  if (/\b(copy|content|tone|wording|label|microcopy|text|sentence|description|instruction|ambiguous wording|unclear language|typo|grammar|readability|headline|duplicate copy)\b/.test(text)) return "Content & tone";
  if (/\b(hierarchy|prioriti[sz]|prominence|competing|overload|grouping|grouped|clutter|scannability|scan|primary cta|secondary cta|information architecture|information overload|visual order)\b/.test(text)) return "Information hierarchy";
  return "Visual design";
}
function categoryFor(value: unknown, observation?: VisualObservation): typeof CATEGORIES[number] {
  const requested = typeof value === "string" ? value.trim().toLowerCase() : "";
  const matched = CATEGORIES.find((category) => category.toLowerCase() === requested);
  if (matched) return matched;
  const legacy: Record<string, typeof CATEGORIES[number]> = {
    "language & tone": "Content & tone", "content": "Content & tone", "user engagement": "Usability & interaction",
    "conversion": "Usability & interaction", "accessibility": "Usability & interaction",
    "responsive design": "Responsiveness", "performance": "Web performance",
  };
  return legacy[requested] ?? (observation ? inferredCategory(observation) : "Visual design");
}
function severityFor(value: unknown): Severity { const v = typeof value === "string" ? value.toLowerCase() : "medium"; return v === "high" || v === "low" ? v : "medium"; }
function stringList(value: unknown, limit = 4) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, limit) : []; }
function textValue(value: unknown, fallback: string) { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function capWords(value: string, maxLength: number) { const trimmed = value.trim(); return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength - 1).trimEnd() + "…"; }
function isRepeated(value: string, prior: Finding[], selector: (finding: Finding) => string) {
  const normalized = normalizeIssueText(value);
  return normalized.length > 0 && prior.some((finding) => normalizeIssueText(selector(finding)) === normalized);
}
function isGenericTitle(value: string) {
  const normalized = normalizeIssueText(value);
  return normalized.length < 10 || /^(visual design|information hierarchy|navigation|poor ux|usability issue|high density|content issue|mobile issue|performance issue|unclear design)$/.test(normalized);
}
function evidenceSpecificTitle(observation: VisualObservation, index: number, prior: Finding[] = []): string {
  const element = capWords(observation.element || observation.section || "Interface element", 44);
  const issue = capWords(observation.issue || "creates user friction", 72).replace(/[.!?]+$/, "");
  let title = element + ": " + issue;
  if (isRepeated(title, prior, (finding) => finding.title)) title = capWords(observation.section || "Page section", 28) + " — " + title;
  if (isRepeated(title, prior, (finding) => finding.title)) title += " (" + (index + 1) + ")";
  return title;
}
function evidenceSpecificDescription(observation: VisualObservation): string {
  const section = observation.section || "the visible page";
  const element = observation.element || "the interface element";
  const issue = (observation.issue || "shows a potential usability issue").replace(/[.!?]+$/, "");
  const impact = (observation.whyItMatters || "this may make the next step harder to understand").replace(/^[Tt]his matters because\s*/, "").replace(/[.!?]+$/, "");
  return "In " + section + ", " + element + " shows this issue: " + issue + ". This matters because " + impact + ".";
}
function evidenceSpecificRecommendation(observation: VisualObservation, category: typeof CATEGORIES[number]): string {
  const section = observation.section || "the affected section";
  const element = observation.element || "the affected element";
  const issue = (observation.issue || "the observed friction").replace(/[.!?]+$/, "");
  switch (category) {
    case "Navigation": return "Make " + element + " easier to find in " + section + ": use a descriptive label, place it beside related destinations, and link directly to the relevant page instead of forcing users to infer where “" + capWords(issue, 70) + "” is resolved.";
    case "Information hierarchy": return "Restructure " + section + " so " + element + " has a clear priority: use a specific heading, group supporting information nearby, and reduce competing messages around the decision this element supports.";
    case "Usability & interaction": return "Revise " + element + " in " + section + " with an explicit action label, a clear interactive affordance, an adequate target size, and visible feedback or a next state after the action.";
    case "Content & tone": return "Rewrite the copy for " + element + " in " + section + " to state the product or task and expected next step in plain language; replace wording that creates “" + capWords(issue, 70) + "” with concise, specific, scannable content.";
    case "Visual design": return "Update " + element + " in " + section + " to use consistent typography, spacing, alignment, and contrast while giving this element a purposeful treatment that fits the established brand system.";
    case "Responsiveness": return "Rework " + element + " in " + section + " for the 393 × 852 CSS-pixel mobile viewport: prevent clipping and horizontal overflow, preserve readable type and logical stacking, and provide comfortably spaced touch targets.";
    case "Web performance": return "Investigate the loading behavior around " + element + " in " + section + "; prioritize critical assets, defer non-critical media or scripts, and keep the loading state stable. Validate the change with measured performance data before claiming a speed improvement.";
  }
}
function evidenceSpecificBusinessAnalysis(observation: VisualObservation, category: typeof CATEGORIES[number]): BusinessAnalysis {
  const section = observation.section || "the affected section";
  const element = observation.element || "the affected element";
  const issue = (observation.issue || "the visible issue").replace(/[.!?]+$/, "");
  const basis = "Evidence on " + element + " in " + section + ": " + issue + ".";
  const reason = observation.whyItMatters || "users may need extra effort to understand or complete the intended next step";
  const variants: Record<typeof CATEGORIES[number], BusinessAnalysis> = {
    "Navigation": {
      funnelStage: "Acquisition / discovery", impact: basis + " " + reason + " This may prevent users from reaching the relevant product or information.",
      kpi: "Navigation-to-destination click-through rate", mechanism: "Unclear routes around " + element + " can cause additional search and backtracking before users reach the intended destination.",
      suggestions: ["Add a direct, descriptive route to " + element + " from " + section + ".", "Track destination clicks and exits from the menu or page."],
    },
    "Information hierarchy": {
      funnelStage: "Consideration", impact: basis + " " + reason + " Users may miss the key value or decision cue before choosing a next step.",
      kpi: "Primary CTA click-through rate", mechanism: "When " + element + " is not clearly prioritized, attention may be diverted from the main decision in " + section + ".",
      suggestions: ["Give " + element + " stronger hierarchy and group its supporting details nearby.", "Compare primary-action engagement before and after the change."],
    },
    "Usability & interaction": {
      funnelStage: "Activation / conversion", impact: basis + " " + reason + " Users may hesitate, make errors, or abandon the task at this interaction.",
      kpi: "Task completion rate", mechanism: "Ambiguity or friction around " + element + " can interrupt the action sequence between user intent and successful completion.",
      suggestions: ["Clarify the action and expected result for " + element + ".", "Track interaction errors and completion by step."],
    },
    "Content & tone": {
      funnelStage: "Awareness / consideration", impact: basis + " " + reason + " Users may misunderstand the offer or need to reread the content before proceeding.",
      kpi: "Content-to-CTA click-through rate", mechanism: "Unclear language around " + element + " can weaken comprehension of the value proposition immediately before the next action.",
      suggestions: ["Rewrite " + element + " with explicit, user-centred wording.", "Test comprehension and CTA engagement for the revised copy."],
    },
    "Visual design": {
      funnelStage: "Consideration", impact: basis + " " + reason + " The presentation may reduce confidence or make key information harder to scan.",
      kpi: "Primary CTA engagement / task success", mechanism: "Inconsistent visual cues around " + element + " may make the interface feel less coherent and reduce confidence in the next step.",
      suggestions: ["Align " + element + " with the page's spacing, typography, and contrast rules.", "Validate scan success and action engagement after the visual update."],
    },
    "Responsiveness": {
      funnelStage: "Mobile acquisition / conversion", impact: basis + " " + reason + " On narrow screens, this can make a key page or control harder to use and increase mobile abandonment risk.",
      kpi: "Mobile task completion rate", mechanism: "Responsive layout friction around " + element + " can add scrolling, missed taps, or content loss on phone-sized screens.",
      suggestions: ["Test " + element + " at 393 × 852 CSS px and common responsive breakpoints.", "Compare mobile completion and exit rates by device width."],
    },
    "Web performance": {
      funnelStage: "Landing / activation", impact: basis + " " + reason + " Perceived delay or unstable rendering can interrupt momentum before the user completes the task.",
      kpi: "Largest Contentful Paint (LCP) / bounce rate", mechanism: "Slow or unstable rendering of " + element + " may delay comprehension and interaction; confirm this hypothesis with real-user or lab measurements.",
      suggestions: ["Measure the page's Core Web Vitals and isolate the cost of " + element + ".", "Prioritize critical resources and re-test on a representative mobile connection."],
    },
  };
  return variants[category];
}
function normalizeFinding(raw: unknown, observation: VisualObservation, index: number, prior: Finding[] = []): Finding {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const ux = item.uxPerspective && typeof item.uxPerspective === "object" ? item.uxPerspective as Record<string, unknown> : {};
  const business = item.businessAnalysis && typeof item.businessAnalysis === "object" ? item.businessAnalysis as Record<string, unknown> : {};
  const category = categoryFor(item.category, observation);
  const uniqueTitle = evidenceSpecificTitle(observation, index, prior);
  const suppliedTitle = textValue(item.title, "");
  const title = !suppliedTitle || isGenericTitle(suppliedTitle) || isRepeated(suppliedTitle, prior, (finding) => finding.title) ? uniqueTitle : capWords(suppliedTitle, 130);
  const descriptionValue = textValue(item.description, "");
  const description = !descriptionValue || normalizeIssueText(descriptionValue) === normalizeIssueText(title) || isRepeated(descriptionValue, prior, (finding) => finding.description) || /^(this issue|this finding|poor ux|visual design|high density|the design is poor)\b/i.test(descriptionValue) ? evidenceSpecificDescription(observation) : capWords(descriptionValue, 700);
  const recommendationValue = textValue(item.recommendation, "");
  const recommendation = !recommendationValue || isRepeated(recommendationValue, prior, (finding) => finding.recommendation) || /^(improve the design|make it better|enhance usability|improve visual hierarchy|simplify the interface)[.! ]*$/i.test(recommendationValue) || /\b(use a specific heading, group supporting information nearby|reduce competing messages|improve visual hierarchy|make the design more consistent)\b/i.test(recommendationValue) ? evidenceSpecificRecommendation(observation, category) : capWords(recommendationValue, 850);
  const businessDefaults = evidenceSpecificBusinessAnalysis(observation, category);
  function businessField(key: "funnelStage" | "impact" | "kpi" | "mechanism" | "suggestions"): any {
    const value = business[key];
    if (key === "suggestions") {
      const list = stringList(value, 4);
      const repeated = list.length > 0 && prior.some((finding) => normalizeIssueText(finding.businessAnalysis.suggestions.join(" ")) === normalizeIssueText(list.join(" ")));
      return !list.length || repeated ? businessDefaults.suggestions : list;
    }
    const supplied = textValue(value, "");
    const generic = /^(consideration\s*\/\s*conversion|cta click through\s*\/\s*conversion rate|primary cta click through rate|users may take longer to understand the value proposition or choose the next action|the friction can reduce clarity and increase hesitation before the next funnel step)[.! ]*$/i.test(supplied);
    const repeated = isRepeated(supplied, prior, (finding) => String(finding.businessAnalysis[key] ?? ""));
    return !supplied || generic || repeated ? businessDefaults[key] : supplied;
  }
  return {
    id: textValue(item.id, "finding-" + (index + 1)),
    severity: severityFor(item.severity),
    category, title, description, recommendation,
    // Keep good model-generated UX research as-is; only fill missing fields.
    uxPerspective: {
      law: textValue(ux.law, "Relevant UX principle"),
      definition: textValue(ux.definition, "A research-backed principle describing how the interface supports user goals."),
      assessment: textValue(ux.assessment, observation.whyItMatters),
      researchContext: textValue(ux.researchContext, "Use this principle as a research-backed lens; validate the observed friction with user research where practical."),
    },
    businessAnalysis: {
      funnelStage: businessField("funnelStage"),
      impact: businessField("impact"),
      kpi: businessField("kpi"),
      mechanism: businessField("mechanism"),
      suggestions: businessField("suggestions"),
    },
    evidence: [{ section: observation.section, element: observation.element, detail: observation.issue, marker: observation.marker }],
  };
}

async function createVisualPass(model: VerifiedModel, capture: Capture, timeoutMs = 12000, auditMode: "desktop" | "mobile" = "desktop"): Promise<VisualPass> {
  const aspect = capture.width / capture.height;
  const viewportHint = aspect < 0.75 ? "portrait or full-page narrow capture (verify actual visible UI; do not assume mobile solely from aspect ratio)" : aspect < 1.15 ? "square-ish or tablet-like capture (verify actual visible UI)" : "wide capture (likely desktop, but verify actual visible UI)";
  const modeInstruction = auditMode === "mobile" ? "MOBILE WEBSITE AUDIT. The intended CSS viewport is 393 × 852 pixels. Prioritize mobile-specific evidence: compact navigation and menus, touch target size and spacing, thumb reach, text legibility at phone width, horizontal overflow, responsive stacking, sticky elements consuming viewport space, form usability, CTA competition, mobile layout breaks and conversion friction. Analyse only what is visibly present in the captured image; do not invent controls or claim unsupported measurements." : "DESKTOP WEBSITE AUDIT. Prioritize desktop navigation, wide-screen hierarchy, multi-column layout, density, hover/keyboard affordances when visible, CTA hierarchy and desktop conversion friction. Analyse only visible evidence.";
  const prompt = `You are the IMAGE-TO-TEXT stage of a UX audit. ${modeInstruction} Analyze the supplied screenshot itself, not an imagined website. Original dimensions are ${capture.width}x${capture.height}px; aspect-ratio hint: ${viewportHint}. Determine DEVICE / VIEWPORT from visible evidence first: narrow single-column layout, mobile hamburger/menu, stacked cards, mobile-sized controls, desktop multi-column layout, wide navigation, sidebars, or desktop utility bars. In JSON include "deviceType" as "mobile", "desktop", "tablet", or "uncertain" and explain the visible cue in pageSummary. Never label a full-page screenshot mobile just because it is tall; never label it desktop just because it contains lots of content.\n\nFIRST identify the CLIENT / BRAND NAME visible in the screenshot. Look specifically for explicit company or product text, logo/wordmark text, domain text, browser/site identity, distinctive brand naming, or a clearly visible legal/company name. Use the strongest explicit evidence. If the screenshot is Tata Capital, return exactly "Tata Capital". Do not infer a client from generic colours, layout style, or industry alone. If no reliable name is visible, return "Unknown client".\n\nThe final report will display the ENTIRE original screenshot once, with numbered colored dots overlaid on the exact regions you identify. There is NO CROPPING in this product. Do not return bounding boxes, crop widths, crop heights, or image snippets.\n\nFind 2–6 strong, DISTINCT UX observations. Each observation must refer to a different specific visible UI region and a different concrete issue grounded only in pixels actually visible in this screenshot. Do not repeat the same issue under synonyms, do not repeat generic labels such as "high density" for multiple unrelated sections, and do not reuse a title/issue/element for multiple observations. If the screenshot does not support distinct, meaningful issues, return fewer—including zero—rather than inventing or duplicating. Describe intentional design choices neutrally unless a concrete user problem is visible. Titles must name the actual element and problem, not just a generic category. If the screenshot is narrow/tall, reason about the actual responsive mobile layout shown; never assume desktop. Prefer concrete issues involving hierarchy, labels, grouping, density, CTA competition, form clarity, content scanning, navigation, trust, or conversion friction.\n\nFor EVERY observation return ONE MARKER POINT at the visual centre of the specific UI region that demonstrates the issue. Coordinates must be normalized from 0 to 1 using the ORIGINAL supplied image dimensions: x=0 is the left edge, x=1 the right edge, y=0 is the top edge, y=1 the bottom edge. The dot should land ON the relevant text, control, card, image, navigation item, or other visible evidence—not in empty space. Use the exact visible location, not a section estimate or page-percentage guess. Never place two observations at the same point. Keep observations ordered from top to bottom of the screenshot.\n\nThe marker is the permanent spatial link between the visual observation and the later text review. Do not change or reinterpret the marker after choosing it.\n\nReturn JSON only: {"clientName":"Tata Capital","deviceType":"mobile|desktop|tablet|uncertain","pageSummary":"one factual sentence including visible device/layout cues","observations":[{"id":"obs-1","section":"exact visible section","element":"exact visible element","issue":"factual visible issue","whyItMatters":"user-visible consequence","marker":{"x":0.50,"y":0.20}}]}`;
  const imagePart = { inline_data: { mime_type: "image/jpeg", data: capture.analysisBuffer.toString("base64") } };
  let lastProblem = "The image-to-text model returned no usable visual observations.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retryPrompt = attempt === 0 ? prompt : `Inspect the attached screenshot and return ONLY valid JSON with this exact shape: {"clientName":"visible brand or Unknown client","pageSummary":"one sentence describing visible layout","observations":[{"id":"obs-1","section":"visible region","element":"visible control or content","issue":"specific UX issue visibly supported by screenshot","whyItMatters":"user impact","marker":{"x":0.5,"y":0.2}}]}. Return 0 to 5 observations only when supported by visible evidence; an empty observations array is valid when no meaningful issue is visible. Coordinates must be numbers from 0 to 1. Do not return markdown or any other schema.`;
    try {
      const text = await modelGenerate(model, [{ text: retryPrompt }, imagePart], attempt === 0 ? 4500 : 3500, timeoutMs);
      const parsed = extractJson(text);
      const result = normalizeVisualPass(parsed);
      return result;
      const keys = parsed && typeof parsed === "object" ? Object.keys(parsed as Record<string, unknown>) : [];
      lastProblem = "No usable observations; returned JSON keys: " + (keys.join(", ") || "none");
      console.warn("[uxaudit] visual_schema_mismatch", JSON.stringify({ attempt: attempt + 1, keys, responsePreview: text.slice(0, 500) }));
    } catch (e) {
      lastProblem = e instanceof Error ? e.message : "Visual analysis failed.";
      if (attempt === 1) throw e;
    }
  }
  throw new Error("The image-to-text model returned no usable visual observations after one retry. " + lastProblem);
}

async function createTextReview(model: VerifiedModel, visualPass: VisualPass, timeoutMs = 12000, knowledgeContext = "") {
  const prompt = `You are the SECOND stage of a UX audit. You are a TEXT-TO-TEXT UX research and business reviewer. The first model already inspected the screenshot and produced the visual observations below. You do NOT see the screenshot.\n\nPreserve observationId exactly. Do not change, merge, reorder, or reinterpret the visual location. Never invent UI elements, coordinates, measurements, analytics, or behaviour. For each observation create a client-ready finding with UX research context and business funnel analysis. Category-tag EVERY finding with exactly one allowed category using the visual evidence, not by spreading categories evenly. Titles must name the specific element and flaw; the description must explain the observed flaw AND its user consequence (never copy the title). The recommendation must directly redesign the observed element and name the section or component; avoid generic advice like “improve visual hierarchy”. Business analysis must be individually derived from this issue: write a distinct impact, causal mechanism, relevant KPI, funnel stage, and concrete suggestions. Do not reuse a template paragraph across findings. Repeat a KPI or funnel stage only when genuinely appropriate, while keeping each causal explanation specific to the issue. Calibrate severity independently: high only for a major blocker, misleading interaction, serious trust/accessibility issue, or clear primary-journey failure; medium for meaningful friction; low for polish/minor clarity issues. Vary severity only when evidence warrants it—never alternate high/low as a pattern. KPI and funnel stage must fit the actual issue; use different values where the evidence points to different outcomes.\n\nUX context must include a relevant law/principle, a plain-language definition, why it applies, and concise research context. Business analysis must identify funnel stage, directional impact, KPI at risk, mechanism, and practical suggestions that could improve that KPI. Do not create development tasks. Do not claim measured KPI changes.\n\nReturn JSON only: {"findings":[{"id":"finding-1","observationId":"obs-1","severity":"high|medium|low","category":"Information hierarchy","title":"short finding","description":"clear explanation","recommendation":"specific UX redesign action","uxPerspective":{"law":"Hick's Law","definition":"plain-language definition","assessment":"why it applies","researchContext":"brief research context"},"businessAnalysis":{"funnelStage":"Acquisition / consideration / activation / conversion / retention","impact":"directional impact","kpi":"specific KPI","mechanism":"how the design can influence it","suggestions":["specific action","specific action"]}}]}\n\nAllowed categories: ${CATEGORIES.join(", ")}.\n\nVISUAL OBSERVATIONS:\n${JSON.stringify(visualPass)}\n\nINTERNAL UX AUDIT KNOWLEDGE (approved coaching rules are operating standards within their stated scope; historical findings and reference documents are examples only):\n${knowledgeContext || "No relevant saved audit findings were retrieved. Rely on screenshot evidence and established UX principles."}\nApply approved coaching rules only when their declared scope matches this audit. Current screenshot evidence must support every finding. Never copy historical findings blindly, and do not claim a problem unless visible evidence supports it. Do not cite internal examples as external research or invent sources.`;
  const text = await modelGenerate(model, [{ text: prompt }], 4800, timeoutMs);
  const parsed = extractJson(text); const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  return Array.isArray(root.findings) ? root.findings : [];
}


function isGenericOrRepeatedFinding(finding: Finding, prior: Finding[]) {
  const title = normalizeIssueText(finding.title);
  const description = normalizeIssueText(finding.description);
  const evidence = finding.evidence[0];
  const element = normalizeIssueText(evidence?.element ?? "");
  const issue = normalizeIssueText(evidence?.detail ?? "");
  const generic = ["high density", "utility bar navigation", "navigation", "visual design", "information hierarchy", "poor ux", "usability issue"];
  if (title.length < 8 || generic.includes(title)) return true;
  return prior.some((item) => {
    const priorTitle = normalizeIssueText(item.title);
    const priorEvidence = item.evidence[0];
    const priorElement = normalizeIssueText(priorEvidence?.element ?? "");
    const priorIssue = normalizeIssueText(priorEvidence?.detail ?? "");
    return title === priorTitle || (element && element === priorElement && issue === priorIssue) || (description.length > 20 && description === normalizeIssueText(item.description));
  });
}

function fallbackFinding(observation: VisualObservation, index: number): Finding {
  const category = inferredCategory(observation);
  return normalizeFinding({ id: `finding-${index + 1}`, severity: /\b(blocks access|cannot submit|dead link|misleading|critical|unreadable|prevents completion|broken form|error message)\b/i.test(observation.issue) ? "high" : "low", category, title: observation.issue, description: observation.issue, recommendation: evidenceSpecificRecommendation(observation, category), uxPerspective: { law: "Visual hierarchy and cognitive load", definition: "Users scan interfaces by relative prominence and grouping, so competing or unclear signals increase the effort needed to decide what matters.", assessment: observation.whyItMatters, researchContext: "The observation is consistent with established research on visual grouping, attention and cognitive load." }, businessAnalysis: { funnelStage: "Consideration / conversion", impact: "The visible friction can increase hesitation before the next intended action.", kpi: "Primary CTA click-through rate", mechanism: "When the intended next step is harder to understand, users can delay, miss or abandon the action.", suggestions: ["Strengthen the primary hierarchy.", "Remove or reduce competing signals around the key action."] } }, observation, index);
}

export async function createAuditFromScreenshot(buffer: Buffer, filename: string, onStage?: (stage: AuditStage) => void, verifiedModels: VerifiedModel[] = [], auditMode: "desktop" | "mobile" = "desktop", brainScope?: SharedBrainScope): Promise<AuditResult> {
  if (buffer.byteLength > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot is too large. Please upload an image smaller than 15 MB.");
  const metadata = await sharp(buffer).metadata(); const width = metadata.width ?? 0; const height = metadata.height ?? 0;
  if (!width || !height) throw new Error("The uploaded file is not a valid image.");
  if (width < 320 || height < 200) throw new Error("Please upload a larger screenshot so the UX evidence can be reviewed reliably.");
  if (width > 20000 || height > 20000) throw new Error("Screenshot dimensions are too large. Please upload a smaller screenshot.");
  const analysisBuffer = await sharp(buffer).resize({ width: Math.min(1280, width), height: Math.min(5000, height), fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72, progressive: true }).toBuffer();
  const capture: Capture = { buffer, width, height, analysisBuffer, title: filename.replace(/\.[^.]+$/, "") || "Uploaded screenshot" };
  const allowedModels=verifiedModels.filter(m=>m&&m.provider==="OpenRouter"&&typeof m.model==="string"&&m.model.length>0);
  // The connection layer owns model selection: the first verified model is the primary; later entries are ordered fallbacks.
  const primaryModel=allowedModels[0];
  const visionModel=primaryModel;
  const textModel=primaryModel;
  if(!visionModel||!textModel)throw new Error("At least one verified OpenRouter model is required; refresh model availability and retry.");

  onStage?.({ id: "capture", label: "Preparing screenshot", detail: auditMode === "mobile" ? `Using a mobile capture with a 393 × 852 CSS-pixel reference viewport; captured image size is ${width} × ${height}px.` : `Using the original ${width} × ${height}px desktop full-page screenshot; no visual crops will be generated.`, status: "complete" });
  onStage?.({ id: "analyse", label: "OpenRouter screenshot analysis", detail: "OpenRouter Auto Router · low-cost tier · image input enabled · provider price ceiling applied. OpenRouter selects the vision-capable model.", status: "active" });
  let visualPass: VisualPass | null = null;let visualErrors:string[]=[];
  const visionCandidates=[visionModel,...allowedModels.filter(m=>m.model!==visionModel.model)];
  for(let i=0;i<visionCandidates.length;i++){const candidate=visionCandidates[i];const timeoutMs=i===0?18000:i===1?10000:8000;try{visualPass=await createVisualPass(candidate,capture,timeoutMs,auditMode);break;}catch(e){visualErrors.push(candidate.model+": "+(e instanceof Error?e.message:"failed"));}}
  if(!visualPass)throw new Error("OpenRouter Auto Router could not analyze the screenshot. "+visualErrors.join(" | "));
  // Deduplicate near-identical model observations before review and marker generation.
  const distinctObservations: VisualObservation[] = [];
  const tokenSet = (value: string) => new Set(normalizeIssueText(value).split(" ").filter((token) => token.length > 2));
  const similarity = (a: string, b: string) => { const aa = tokenSet(a); const bb = tokenSet(b); if (!aa.size || !bb.size) return 0; let overlap = 0; aa.forEach((token) => { if (bb.has(token)) overlap += 1; }); return overlap / (aa.size + bb.size - overlap); };
  for (const observation of visualPass.observations) {
    const duplicate = distinctObservations.some((prior) => {
      const sameElement = normalizeIssueText(prior.element) === normalizeIssueText(observation.element);
      const sameIssue = normalizeIssueText(prior.issue) === normalizeIssueText(observation.issue);
      return (sameElement && (sameIssue || similarity(prior.issue, observation.issue) >= 0.55)) || similarity(prior.element + " " + prior.issue, observation.element + " " + observation.issue) >= 0.78;
    });
    if (!duplicate) distinctObservations.push(observation);
  }
  visualPass = { ...visualPass, observations: distinctObservations };
  const captureEvidence=[visualPass.pageSummary,...visualPass.observations.map(o=>o.issue+" "+o.element+" "+o.whyItMatters)].join(" ").toLowerCase();
  const blockedCapturePatterns=[/err_tunnel_connection_failed/,/err_connection_(?:failed|timed_out|refused)/,/dns_probe_finished_nxdomain/,/this site can.t be reached/,/403 forbidden/,/access denied/,/verify you are human/,/checking your browser/,/cloudflare ray id/,/robot check/];
  if(blockedCapturePatterns.some(pattern=>pattern.test(captureEvidence)))throw new Error("Screenshot capture appears to show a browser, proxy, CDN, or access-block page rather than the intended website. No UX findings were generated. Open the site in your normal browser and upload/paste a screenshot of the actual page.");
  onStage?.({ id: "analyse", label: "Image → text", detail: `${visualPass.clientName} · ${visualPass.observations.length} visual regions identified on the full screenshot.`, status: "complete" });

  const knowledgeQuery=[auditMode === "mobile" ? "mobile audit mobile viewport" : "desktop audit desktop viewport",visualPass.clientName,visualPass.pageSummary,...visualPass.observations.map(o=>[o.section,o.element,o.issue,o.whyItMatters].join(" "))].join(" ");
  const knowledgeContext=await retrieveRelevantAuditKnowledge(knowledgeQuery,6,brainScope);
  if(knowledgeContext)onStage?.({id:"knowledge",label:"Retrieve prior audit evidence",detail:"Retrieved relevant saved findings from the Supabase knowledge base to calibrate recommendations; current findings still require screenshot evidence.",status:"complete"});

  onStage?.({ id: "quality", label: "OpenRouter UX reasoning", detail: "OpenRouter Auto Router · low-cost tier · text-only UX research and business analysis. OpenRouter selects the reasoning model.", status: "active" });
  let review: unknown[]=[];let reviewOk=visualPass.observations.length===0;let reviewErrors:string[]=[];
  const textCandidates=[textModel,...allowedModels.filter(m=>m.model!==textModel.model)];
  if (visualPass.observations.length > 0) for(let i=0;i<textCandidates.length;i++){const candidate=textCandidates[i];const timeoutMs=i===0?14000:i===1?10000:8000;try{review=await createTextReview(candidate,visualPass,timeoutMs,knowledgeContext);if(review.length){reviewOk=true;break;}reviewErrors.push(candidate.model+": empty findings");}catch(e){reviewErrors.push(candidate.model+": "+(e instanceof Error?e.message:"failed"));}}
  if(!reviewOk){console.warn("[uxaudit] text_review_degraded",JSON.stringify({errors:reviewErrors,observations:visualPass.observations.length}));onStage?.({id:"quality",label:"OpenRouter UX reasoning",detail:"OpenRouter did not return valid structured research findings; preserving screenshot evidence and using conservative evidence-linked fallback recommendations. "+reviewErrors.join(" | "),status:"complete"});review=[];}else{onStage?.({id:"quality",label:"OpenRouter UX reasoning",detail:"OpenRouter returned structured UX laws, research context and business-funnel hypotheses.",status:"complete"});}

  onStage?.({ id: "markers", label: "Place evidence markers", detail: "Linking each finding to its exact region on the original screenshot; no crops are created.", status: "active" });
  const reviewByObservation = new Map<string, unknown>();
  for (const raw of review) { if (raw && typeof raw === "object") { const item = raw as Record<string, unknown>; if (typeof item.observationId === "string" && !reviewByObservation.has(item.observationId)) reviewByObservation.set(item.observationId, raw); } }
  const findings: Finding[] = [];
  for (const observation of visualPass.observations) {
    const index = findings.length;
    const match = reviewByObservation.get(observation.id);
    const candidate = match ? normalizeFinding(match, observation, index, findings) : normalizeFinding(fallbackFinding(observation, index), observation, index, findings);
    findings.push(candidate);
  }
  onStage?.({ id: "markers", label: "Place evidence markers", detail: `${findings.length} numbered markers mapped to the original screenshot.`, status: "complete" });

  onStage?.({ id: "enrich", label: "Applying UX + business context", detail: "Finalising funnel impact, KPI hypotheses and redesign recommendations.", status: "active" });
  onStage?.({ id: "enrich", label: "Applying UX + business context", detail: "UX research context and business funnel analysis are ready.", status: "complete" });
  onStage?.({ id: "complete", label: "Finalise report", detail: "Building the client-ready report with one full screenshot and linked evidence markers.", status: "active" });
  const screenshot = `data:image/jpeg;base64,${(await sharp(buffer).jpeg({ quality: 88, progressive: true }).toBuffer()).toString("base64")}`;
  const result: AuditResult = { pages: [{ clientName: visualPass.clientName, url: "Uploaded screenshot", title: capture.title, screenshot, screenshotWidth: width, screenshotHeight: height, findings, auditMode, viewportWidth: auditMode === "mobile" ? 393 : 1440, ...(auditMode === "mobile" ? { viewportHeight: 852 } : {}) }] };
  onStage?.({ id: "complete", label: "Finalise report", detail: "Audit ready.", status: "complete" });
  return result;
}