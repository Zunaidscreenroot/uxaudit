import type { AuditResult, Finding, MarkerPoint } from "@/lib/audit";

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
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1800, temperature: 0.02 } }),
      signal: AbortSignal.timeout(25000),
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

function mobileFindingEntries(result: AuditResult) {
  return result.pages.flatMap((page) => page.viewMode === "mobile" ? page.findings.map((finding) => ({ finding, page })) : []);
}

function parseMarkers(parsed: unknown) {
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
  return byId;
}

export async function calibrateMobileMarkers(apiKey: string, result: AuditResult, screenshot: Buffer, mimeType = "image/png"): Promise<AuditResult> {
  const entries = mobileFindingEntries(result);
  if (!entries.length) return result;
  const imageBase64 = screenshot.toString("base64");
  const updatedMarkers = new Map<string, MarkerPoint>();

  // Verify only two findings per vision request. This keeps the model focused on exact UI elements
  // instead of losing vertical accuracy when several targets exist on a tall mobile screenshot.
  for (let start = 0; start < entries.length; start += 2) {
    const batch = entries.slice(start, start + 2);
    const targets = batch.map(({ finding }, index) => ({
      id: finding.id || `finding-${start + index + 1}`,
      title: finding.title,
      category: finding.category,
      description: finding.description,
      evidenceElement: finding.evidence[0]?.element ?? "",
      evidenceDetail: finding.evidence[0]?.detail ?? "",
    }));
    const prompt = `You are the FINAL SPATIAL VERIFICATION specialist for a mobile UX audit. The supplied image is the ORIGINAL full mobile-responsive webpage, not a crop. Existing findings are already approved; your only task is to correct their marker coordinates.

Inspect the COMPLETE image from top to bottom before answering. Locate the EXACT VISIBLE UI ELEMENT that is the evidence for each finding. Do not place a marker merely near a named section. Do not infer vertical position from page proportions. Do not place markers in blank space. If the evidence is an accordion, button, input, card, text block, image, navigation item, badge, etc., put the point directly ON that visible element, ideally near its visual centre.

Coordinates are integers from 0 to 1000 on the COMPLETE ORIGINAL IMAGE: x=0 left, x=1000 right, y=0 top, y=1000 bottom. Return one marker for every target. Do not rewrite the findings.

Return JSON only: {"markers":[{"id":"finding-id","x":500,"y":240}]}

TARGET FINDINGS:
${JSON.stringify(targets)}`;
    try {
      const text = await generate(apiKey, [
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
        { text: prompt },
      ]);
      for (const [id, marker] of parseMarkers(extractJson(text))) updatedMarkers.set(id, marker);
    } catch {
      // Keep the original marker if a verification request fails.
    }
  }

  if (!updatedMarkers.size) return result;
  return { ...result, pages: result.pages.map((page) => page.viewMode !== "mobile" ? page : {
    ...page,
    findings: page.findings.map((finding) => {
      const marker = updatedMarkers.get(finding.id);
      if (!marker || !finding.evidence.length) return finding;
      return { ...finding, evidence: finding.evidence.map((evidence, index) => index === 0 ? { ...evidence, marker } : evidence) };
    }),
  }) };
}
