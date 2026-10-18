type BrainApiConfig = { baseUrl: string; apiKey: string };

function config(): BrainApiConfig | null {
  const baseUrl = process.env.UX_SHARED_BRAIN_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.UX_DIRECT_BRAIN_API_KEY?.trim();
  if (!baseUrl || !apiKey || apiKey.length < 32) return null;
  return { baseUrl, apiKey };
}

async function brainRequest(path: string, body: unknown, timeoutMs = 5000): Promise<any> {
  const settings = config();
  if (!settings) throw new Error("The UX Direct shared brain is not configured. Set UX_SHARED_BRAIN_URL and UX_DIRECT_BRAIN_API_KEY.");
  const response = await fetch(settings.baseUrl + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + settings.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { error: text.slice(0, 500) }; }
  if (!response.ok) {
    const message = typeof parsed?.error === "string" ? parsed.error : "Shared brain returned HTTP " + response.status + ".";
    throw new Error(message.slice(0, 500));
  }
  return parsed;
}

export function mapBrainScope(value: unknown): string {
  const input = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!input || ["all", "all audits", "global", "global audits", "ux shared brain"].includes(input)) return "UX_SHARED_BRAIN";
  if (/\b(ujjivan|ujjivan sfb)\b/.test(input)) return "project:ujjivan-sfb";
  if (/\b(dmi|dmi finance|housing finance)\b/.test(input)) return "project:dmi-finance";
  if (/\b(express computers|express-computers)\b/.test(input)) return "project:express-computers";
  if (/\b(ux direct|ux-direct)\b/.test(input)) return "project:ux-direct";
  if (/\b(ux audit|ux-audit)\b/.test(input)) return "project:ux-audit";
  if (/\b(bfsi|bank|banking|finance|financial|insurance|nbfc|indian)\b/.test(input)) return "indian-bfsi";
  return "UX_SHARED_BRAIN";
}

export async function retrieveSharedBrainContext(input: { query: string; scopeKeys?: string[]; maxChars?: number; limit?: number }) {
  try {
    const result = await brainRequest("/retrieve", {
      query: input.query.slice(0, 8000),
      scopeKeys: input.scopeKeys?.length ? input.scopeKeys : ["UX_SHARED_BRAIN"],
      maxChars: Math.max(600, Math.min(input.maxChars ?? 2400, 4000)),
      limit: Math.max(1, Math.min(input.limit ?? 5, 8)),
      includeKnowledge: true,
    });
    return {
      contextText: typeof result.contextText === "string" ? result.contextText.slice(0, input.maxChars ?? 2400) : "",
      retrieval: result.retrieval ?? { status: "unknown" },
      memories: Array.isArray(result.memories) ? result.memories : [],
      knowledge: Array.isArray(result.knowledge) ? result.knowledge : [],
    };
  } catch (error) {
    console.warn("[uxaudit] shared_brain_retrieval_degraded", error instanceof Error ? error.message.slice(0, 180) : "unknown");
    return { contextText: "", retrieval: { status: "degraded", memoryCount: 0, knowledgeChunkCount: 0 }, memories: [], knowledge: [] };
  }
}

export async function saveSharedBrainFeedback(input: {
  rawFeedback: string; title: string; rule: string; rationale?: string; scope?: string;
  keywords?: string[]; examples?: unknown[]; sourceLanguage?: string;
  feedbackKind?: string; sourceAuditId?: string; sourceFindingTitle?: string;
}) {
  const feedback = await brainRequest("/feedback", {
    action: "save",
    feedback: {
      rawFeedback: input.rawFeedback,
      summary: input.rawFeedback.slice(0, 500),
      title: input.title,
      normalizedRule: input.rule,
      rationale: input.rationale || "",
      scopeKey: mapBrainScope(input.scope),
      feedbackKind: input.feedbackKind || "general",
      keywords: input.keywords || [],
      examples: input.examples || [],
      originalLanguage: input.sourceLanguage || "unknown",
      sourceProduct: "ux-audit",
      sourceAuditRef: input.sourceAuditId || undefined,
      sourceFindingTitle: input.sourceFindingTitle || undefined,
      idempotencyKey: undefined,
    },
  });
  return feedback.feedback;
}

export async function listSharedBrainFeedback(input: { status?: string; limit?: number }) {
  const response = await brainRequest("/feedback", {
    action: "list",
    status: input.status || "all",
    sourceProduct: "ux-audit",
    limit: Math.max(1, Math.min(input.limit ?? 30, 100)),
  });
  return Array.isArray(response.feedback) ? response.feedback : [];
}

export async function reviewSharedBrainFeedback(input: { feedbackId: string; action: "approve" | "reject" | "archive"; reviewNote?: string }) {
  return brainRequest("/feedback", {
    action: "review",
    feedbackId: input.feedbackId,
    decision: input.action,
    reviewNote: input.reviewNote || "",
  });
}
