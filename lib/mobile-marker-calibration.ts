import type { AuditResult, Finding, MarkerPoint } from "@/lib/audit";

const MODEL = "gemini-3.1-flash-lite";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];

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

async function generate(apiKey: string, parts: Array<Record<string, unknown>>) {
  let lastError = "Mobile marker calibration failed.";
  for (const model of FALLBACK_MODELS) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 3600, temperature: 0.05 } }),
      signal: AbortSignal.timeout(30000),
    });
    if (response.ok) {
      const payload: any = await response.json();
      const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
      if (text) return text;
      lastError = `Gemini ${model} returned an empty response.`;
      continue;
    }
    const body = await response.text().catch(() => "");
    lastError = `Gemini ${model} returned HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`;
  }
  throw new Error(lastError);
}

function mobileFindings(result: AuditResult): Finding[] {
  return result.pages.flatMap((page) => page.viewMode === "mobile" ? page.findings : []);
}

export async function calibrateMobileMarkers(apiKey: string, result: AuditResult, screenshot: Buffer): Promise<AuditResult> {
  const findings = mobileFindings(result);
  if (!findings.length) return result;

  const imageBase64 = screenshot.toString("base64");
  const targets = findings.map((finding, index) => ({
    id: finding.id || `finding-${index + 1}`,
    title: finding.title,
    category: finding.category,
    description: finding.description,
    evidenceElement: finding.evidence[0]?.element ?? "",
    evidenceDetail: finding.evidence[0]?.detail ?? "",
  }));
  const prompt = `You are the FINAL SPATIAL VERIFICATION stage of a mobile UX audit. The supplied screenshot is the ORIGINAL full mobile-responsive webpage. Existing UX findings were created from this screenshot, but their marker coordinates can be inaccurate on long/tall mobile pages.

Your only job is to locate the exact visible UI region described by each finding and return a corrected marker. Do NOT rewrite the finding, infer new findings, or change the order. Inspect the entire screenshot from top to bottom. Mobile screenshots are often very tall, so do not estimate y from section names or page proportions. Find the actual visible element in the pixels.

For each target, return the marker at the visual centre of the exact text, button, card, navigation item, image, form field, or other UI region that provides the evidence. Coordinates MUST be integers from 0 to 1000: x=0 is the left edge, x=1000 the right edge, y=0 the top edge, y=1000 the bottom edge. This is a point-location task, not a section-location task. Never put the marker in empty space. If the evidence describes a specific control, put the point on that control.

Return JSON only: {"markers":[{"id":"finding-id","x":500,"y":240}]}

FINDINGS TO LOCATE:
${JSON.stringify(targets)}`;

  let parsed: unknown;
  try {
    const text = await generate(apiKey, [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }]);
    parsed = extractJson(text);
  } catch {
    return result;
  }
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const markers = Array.isArray(root.markers) ? root.markers : [];
  const byId = new Map<string, MarkerPoint>();
  for (const raw of markers) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string") continue;
    const x = Number(item.x); const y = Number(item.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    byId.set(item.id, { x: clamp(x / 1000, 0.02, 0.98), y: clamp(y / 1000, 0.02, 0.98) });
  }
  if (!byId.size) return result;

  return { ...result, pages: result.pages.map((page) => page.viewMode !== "mobile" ? page : {
    ...page,
    findings: page.findings.map((finding) => {
      const marker = byId.get(finding.id);
      if (!marker || !finding.evidence.length) return finding;
      return { ...finding, evidence: finding.evidence.map((evidence, index) => index === 0 ? { ...evidence, marker } : evidence) };
    }),
  }) };
}
