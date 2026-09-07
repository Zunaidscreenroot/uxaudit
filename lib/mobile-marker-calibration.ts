import type { AuditResult, Finding, MarkerPoint } from "@/lib/audit";

const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
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

async function generate(apiKey: string, parts: Array<Record<string, unknown>>) {
  let lastError: unknown;
  for (const model of FALLBACK_MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1800, temperature: 0.02 } }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) { lastError = new Error(`Gemini ${model} returned ${response.status}`); continue; }
      const payload: any = await response.json();
      const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
      if (text) return text;
      lastError = new Error(`Gemini ${model} returned an empty response`);
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Mobile marker verification failed");
}

function parseBoxes(parsed: unknown) {
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const out = new Map<string, MarkerPoint>();
  for (const raw of Array.isArray(root.boxes) ? root.boxes : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !Array.isArray(item.box_2d) || item.box_2d.length < 4) continue;
    const b = item.box_2d.map(Number);
    if (b.some((x) => !Number.isFinite(x))) continue;
    const y1 = clamp(b[0], 0, 1000), x1 = clamp(b[1], 0, 1000), y2 = clamp(b[2], 0, 1000), x2 = clamp(b[3], 0, 1000);
    out.set(item.id, { x: clamp((x1 + x2) / 2000, 0.02, 0.98), y: clamp((y1 + y2) / 2000, 0.02, 0.98) });
  }
  return out;
}

export async function calibrateMobileMarkers(apiKey: string, result: AuditResult, screenshot: Buffer, mimeType = "image/png"): Promise<AuditResult> {
  const entries = result.pages.flatMap((page) => page.viewMode === "mobile" ? page.findings.map((finding) => ({ finding, page })) : []);
  if (!entries.length) return result;

  const imageBase64 = screenshot.toString("base64");
  const targets = entries.map(({ finding }, index) => ({
    id: finding.id || `finding-${index + 1}`,
    title: finding.title,
    category: finding.category,
    description: finding.description,
    evidenceElement: finding.evidence[0]?.element ?? "",
    evidenceDetail: finding.evidence[0]?.detail ?? "",
  }));
  const prompt = `You are the FINAL SPATIAL VERIFICATION stage of a mobile UX audit. The supplied image is the COMPLETE ORIGINAL mobile-responsive webpage. Existing findings are approved; locate only the exact visible UI region that each finding refers to.\n\nInspect the entire image from top to bottom. Do not estimate location from section names, page proportions, or finding order. Do not choose blank space. Find the actual visible control, text, card, image, accordion, navigation item, badge, or form element described by the evidence.\n\nFor each target, return a 2D bounding box around the exact evidence element, not a box around the whole section. Use [ymin,xmin,ymax,xmax] integers normalized 0-1000 relative to the COMPLETE ORIGINAL IMAGE. Return one box for every target you can verify.\n\nReturn JSON only: {"boxes":[{"id":"finding-id","box_2d":[ymin,xmin,ymax,xmax]}]}\n\nTARGETS:\n${JSON.stringify(targets)}`;

  try {
    const text = await generate(apiKey, [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: prompt }]);
    const updated = parseBoxes(extractJson(text));
    if (!updated.size) return result;
    return {
      ...result,
      pages: result.pages.map((page) => page.viewMode !== "mobile" ? page : {
        ...page,
        findings: page.findings.map((finding) => {
          const marker = updated.get(finding.id);
          if (!marker || !finding.evidence.length) return finding;
          return { ...finding, evidence: finding.evidence.map((e, index) => index === 0 ? { ...e, marker } : e) };
        }),
      }),
    };
  } catch {
    return result;
  }
}
