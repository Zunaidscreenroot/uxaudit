export type SharedBrainScope =
  | "UX_SHARED_BRAIN" | "UX_DIRECT" | "UX_AUDIT" | "EXPRESS_COMPUTERS"
  | "DMI_HFC" | "UJJIVAN_SFB" | "INDIA_BFCI_SHARED";

function config() {
  const url = (process.env.UX_SHARED_BRAIN_URL || process.env.UX_DIRECT_BRAIN_API_URL || "https://uxdirect.netlify.app/api/brain").trim();
  const key = process.env.UX_DIRECT_BRAIN_API_KEY?.trim();
  if (!key || key.length < 32) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function inferSharedBrainScope(query: string): SharedBrainScope {
  if (/\b(express computers|express-computers)\b/i.test(query)) return "EXPRESS_COMPUTERS";
  if (/\b(dmi|dmi hfc|dmi finance)\b/i.test(query)) return "DMI_HFC";
  if (/\b(ujjivan|ujjivan sfb)\b/i.test(query)) return "UJJIVAN_SFB";
  if (/\b(bfsi|bank|banking|finance|financial services|insurance|nbfc|lender|loan|credit|upi|deposit|wealth|indian)\b/i.test(query)) return "INDIA_BFCI_SHARED";
  return "UX_AUDIT";
}

export function resolveCoachingBrainScope(scopeText: string, ruleText = "", rawFeedback = ""): SharedBrainScope {
  const value = (scopeText + " " + ruleText + " " + rawFeedback).toLowerCase();
  if (/\\b(express computers|express-computers)\\b/i.test(value)) return "EXPRESS_COMPUTERS";
  if (/\\b(dmi|dmi hfc|dmi finance|dmi housing finance)\\b/i.test(value)) return "DMI_HFC";
  if (/\\b(ujjivan|ujjivan sfb|ujjivan small finance)\\b/i.test(value)) return "UJJIVAN_SFB";
  if (/\\b(bfsi|indian bank|india banking|banking|banks?|nbfc|lender|insurance|loans?|credit|upi|deposit|financial services|small finance bank|sfb)\\b/i.test(value)) return "INDIA_BFCI_SHARED";
  if (/\\b(all products|all tools|all agents|global|cross.product|shared brain|all audits|every audit)\\b/i.test(value)) return "UX_SHARED_BRAIN";
  if (/\\b(ux direct|wirefram|design system|figma plugin|design execution)\\b/i.test(value)) return "UX_DIRECT";
  if (/\\b(ux audit|audit only|auditing|audit finding|false positive|severity calibration|screenshot evidence)\\b/i.test(value)) return "UX_AUDIT";
  return "UX_AUDIT";
}

export async function sharedBrainRequest<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const cfg = config();
  if (!cfg) throw new Error("Shared UX Brain is not configured. Set UX_DIRECT_BRAIN_API_URL and the server-only UX_DIRECT_BRAIN_API_KEY on UX Audit.");
  const response = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + cfg.key,
    },
    body: JSON.stringify({ ...payload, action }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({ error: "UX Direct Shared Brain returned invalid JSON." })) as any;
  if (!response.ok || body?.ok === false) {
    const error = typeof body?.error === "string" ? body.error
      : typeof body?.message === "string" ? body.message
      : "Shared UX Brain returned HTTP " + response.status + ".";
    throw new Error(error.slice(0, 400));
  }
  return body as T;
}

export async function retrieveSharedBrainContext(query: string, options: {
  scopeKey?: SharedBrainScope; relatedScopes?: SharedBrainScope[]; limit?: number; maxContextChars?: number; includeKnowledge?: boolean;
} = {}) {
  if (!config()) return { available: false, context: "", memoryCount: 0, knowledgeCount: 0, retrievalMode: "not-configured" as const };
  try {
    const result = await sharedBrainRequest<{
      ok: boolean; context?: string; memoryCount?: number; knowledgeCount?: number;
      retrievalMode?: string; contextCharacters?: number; items?: unknown[];
    }>("retrieve", {
      query: query.slice(0, 4000),
      scopeKey: options.scopeKey || inferSharedBrainScope(query),
      relatedScopes: options.relatedScopes || [],
      maxResults: Math.max(1, Math.min(10, options.limit || 6)),
      maxContextChars: Math.max(300, Math.min(5000, options.maxContextChars || 2800)),
      includeKnowledge: options.includeKnowledge !== false,
    });
    return {
      available: true,
      context: typeof result.context === "string" ? result.context : "",
      memoryCount: Number(result.memoryCount || 0),
      knowledgeCount: Number(result.knowledgeCount || 0),
      retrievalMode: result.retrievalMode || "unknown",
      contextCharacters: Number(result.contextCharacters || 0),
      items: Array.isArray(result.items) ? result.items : [],
    };
  } catch (error) {
    // An unavailable cross-product brain must not block a valid screenshot audit.
    console.warn("[uxaudit] shared_brain_retrieval_skipped", error instanceof Error ? error.message.slice(0, 200) : "Shared brain unavailable");
    return { available: false, context: "", memoryCount: 0, knowledgeCount: 0, retrievalMode: "unavailable" as const };
  }
}

export function saveSharedBrainFeedback(input: Record<string, unknown>) {
  return sharedBrainRequest("save-feedback", input);
}
export function listSharedBrainFeedback(input: Record<string, unknown> = {}) {
  return sharedBrainRequest("list-feedback", input);
}
export function reviewSharedBrainFeedback(input: Record<string, unknown>) {
  return sharedBrainRequest("review-feedback", input);
}
export function upsertSharedBrainDocument(input: Record<string, unknown>) {
  return sharedBrainRequest("upsert-document", input);
}
export function saveSharedBrainEvalCase(input: Record<string, unknown>) {
  return sharedBrainRequest("save-eval-case", input);
}
export function listSharedBrainEvalCases(input: Record<string, unknown> = {}) {
  return sharedBrainRequest("list-eval-cases", input);
}
export function runSharedBrainEvals(input: Record<string, unknown> = {}) {
  return sharedBrainRequest("run-evals", input);
}
