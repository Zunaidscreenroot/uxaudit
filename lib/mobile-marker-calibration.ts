import sharp from "sharp";
import type { AuditResult, Finding, MarkerPoint } from "@/lib/audit";

const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];

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

async function generate(apiKey: string, parts: Array<Record<string, unknown>>) {
  let lastError: unknown;
  for (const model of FALLBACK_MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2400, temperature: 0.02 } }),
        signal: AbortSignal.timeout(22000),
      });
      if (!response.ok) { lastError = new Error(`Gemini ${model} returned ${response.status}`); continue; }
      const payload: any = await response.json();
      const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
      if (text) return text;
      lastError = new Error(`Gemini ${model} returned an empty response`);
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Evidence marker verification failed");
}

function parseBoxes(parsed: unknown) {
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const out = new Map<string, MarkerPoint>();
  for (const raw of Array.isArray(root.boxes) ? root.boxes : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !Array.isArray(item.box_2d) || item.box_2d.length < 4) continue;
    const box = item.box_2d.map(Number);
    if (box.some((value) => !Number.isFinite(value))) continue;
    const ymin = clamp(box[0], 0, 1000), xmin = clamp(box[1], 0, 1000);
    const ymax = clamp(box[2], 0, 1000), xmax = clamp(box[3], 0, 1000);
    if (xmax <= xmin || ymax <= ymin) continue;
    out.set(item.id, {
      x: clamp((xmin + xmax) / 2000, 0.01, 0.99),
      y: clamp((ymin + ymax) / 2000, 0.01, 0.99),
    });
  }
  return out;
}

function targetForFinding(finding: Finding, index: number) {
  const evidence = finding.evidence[0];
  return {
    id: finding.id || `finding-${index + 1}`,
    findingNumber: index + 1,
    title: finding.title,
    category: finding.category,
    description: finding.description,
    evidenceElement: evidence?.element ?? "",
    evidenceDetail: evidence?.detail ?? "",
    existingMarker: evidence?.marker ?? null,
  };
}

/** Final spatial pass for every viewport mode. It verifies the finished finding against the complete screenshot. */
export async function calibrateMobileMarkers(
  apiKey: string,
  result: AuditResult,
  screenshot: Buffer,
  _mimeType = "image/jpeg",
): Promise<AuditResult> {
  const entries = result.pages.flatMap((page) => page.findings.map((finding, index) => ({ finding, index })));
  if (!entries.length) return result;

  let verificationImage = screenshot;
  try {
    verificationImage = await sharp(screenshot)
      .resize({ width: 2200, height: 11000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, progressive: true })
      .toBuffer();
  } catch {}

  const targets = entries.map(({ finding, index }) => targetForFinding(finding, index));
  const prompt = `You are the FINAL SPATIAL VERIFICATION stage of a screenshot UX audit.\n\nYou are given the COMPLETE webpage screenshot and the FINAL UX findings generated from it. Your only job is to locate the exact visible UI element that each finding describes. This applies equally to desktop, mobile and tablet screenshots.\n\nCRITICAL RULES:\n1. Inspect the supplied screenshot itself from top to bottom.\n2. Locate the actual visual evidence, not the section name or an approximate page percentage.\n3. If evidence describes text, box that exact text or its immediate control. If it describes a button, card, image, navigation item, accordion, form field, badge, icon group or other control, box that exact visible element.\n4. Never choose blank space or a nearby element merely because it is in the same section.\n5. Do not use the existing marker as the answer. It is only a weak hint and may be wrong. Re-find the evidence from the screenshot.\n6. If a finding describes a sub-element inside a larger section, box the sub-element, NOT the whole section.\n7. Each finding must have its own distinct evidence region.\n8. Return one TIGHT bounding box per finding, only large enough to contain the evidence element.\n9. Coordinates must be [ymin,xmin,ymax,xmax] normalized from 0 to 1000 relative to the COMPLETE SUPPLIED IMAGE.\n10. Return JSON only. No prose and no crops.\n\nFor long full-page screenshots, inspect the complete vertical image before answering. Do not assume the footer is near the bottom of the currently visible model viewport.\n\nReturn exactly: {"boxes":[{"id":"finding-id","box_2d":[ymin,xmin,ymax,xmax]}]}\n\nFINAL FINDINGS TO LOCATE:\n${JSON.stringify(targets)}`;

  try {
    // Gemini's image-understanding guidance recommends putting the text instruction before the image.
    const text = await generate(apiKey, [
      { text: prompt },
      { inline_data: { mime_type: "image/jpeg", data: verificationImage.toString("base64") } },
    ]);
    const boxes = parseBoxes(extractJson(text));
    if (!boxes.size) return result;

    return {
      ...result,
      pages: result.pages.map((page) => ({
        ...page,
        findings: page.findings.map((finding) => {
          const marker = boxes.get(finding.id);
          if (!marker || !finding.evidence.length) return finding;
          return {
            ...finding,
            evidence: finding.evidence.map((evidence, index) => index === 0 ? { ...evidence, marker } : evidence),
          };
        }),
      })),
    };
  } catch {
    // Spatial verification is an enhancement; never fail an otherwise valid audit.
    return result;
  }
}
