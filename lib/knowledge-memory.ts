export type KnowledgeMemoryStatus = "draft" | "approved" | "rejected" | "archived";
export type KnowledgeMemoryAction = "approve" | "reject" | "archive";

export type ModelMemoryPayload = {
  v: 1;
  k: string;
  s: string;
  r: string;
  kw: string[];
  ex: string[];
  lang: string;
};

export type KnowledgeMemory = {
  id: string;
  raw_feedback?: string;
  model_payload: ModelMemoryPayload;
  source_type: string;
  status: KnowledgeMemoryStatus;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  usage_count: number;
  last_used_at: string | null;
  source_audit_id: string | null;
  source_finding_title: string | null;
};

const FEEDBACK_KINDS = [
  "general", "false_positive", "missed_issue", "severity_calibration",
  "recommendation_quality", "duplicate_finding", "benchmarking", "scope",
  "visual_evidence", "accessibility", "other",
] as const;

function config() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configure SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) for the Knowledge Base.");
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function limitedText(value: unknown, max: number, field: string, required = false): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return text;
}

function normalizeScope(value: unknown): string {
  const normalized = limitedText(value, 160, "scope")
    .toLowerCase()
    .replace(/\bindian\s+bfsi\b/g, "india_bfsi")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized.slice(0, 96) || "all_audits";
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 40))
    .filter(Boolean))]
    .slice(0, 12);
}

function normalizeExamples(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => typeof item === "string" ? item : "")
    .map((item) => item.trim().replace(/\s+/g, " ").slice(0, 180))
    .filter(Boolean))]
    .slice(0, 4);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function memoryColumns(includeRawFeedback = false) {
  return [
    "id",
    ...(includeRawFeedback ? ["raw_feedback"] : []),
    "model_payload", "source_type", "status", "review_note", "created_at", "updated_at",
    "approved_at", "usage_count", "last_used_at", "source_audit_id", "source_finding_title",
  ].join(",");
}

export async function saveKnowledgeMemory(input: {
  rawFeedback: unknown;
  title?: unknown;
  rule: unknown;
  rationale?: unknown;
  scope?: unknown;
  keywords?: unknown;
  examples?: unknown;
  sourceLanguage?: unknown;
  sourceType?: unknown;
  sourceAuditId?: unknown;
  sourceFindingTitle?: unknown;
  feedbackKind?: unknown;
  activate?: unknown;
}) {
  const rawFeedback = limitedText(input.rawFeedback, 8000, "rawFeedback", true);
  const rule = limitedText(input.rule, 650, "rule", true);
  const feedbackKind = limitedText(input.feedbackKind, 40, "feedbackKind") || "general";
  if (!FEEDBACK_KINDS.includes(feedbackKind as typeof FEEDBACK_KINDS[number])) throw new Error("feedbackKind is not a supported Knowledge Base category.");

  const sourceAuditId = limitedText(input.sourceAuditId, 64, "sourceAuditId");
  if (sourceAuditId && !isUuid(sourceAuditId)) throw new Error("sourceAuditId must be a valid audit UUID.");

  const sourceLanguage = limitedText(input.sourceLanguage, 32, "sourceLanguage").toLowerCase() || "unknown";
  const activate = input.activate === true;
  const now = new Date().toISOString();
  const modelPayload: ModelMemoryPayload = {
    v: 1,
    k: feedbackKind,
    s: normalizeScope(input.scope),
    r: rule,
    kw: normalizeKeywords(input.keywords),
    ex: normalizeExamples(input.examples),
    lang: sourceLanguage,
  };
  const row = {
    raw_feedback: rawFeedback,
    model_payload: modelPayload,
    source_type: limitedText(input.sourceType, 40, "sourceType") || "chatgpt_mcp",
    source_audit_id: sourceAuditId || null,
    source_finding_title: limitedText(input.sourceFindingTitle, 240, "sourceFindingTitle") || null,
    status: activate ? "approved" : "draft",
    approved_at: activate ? now : null,
    updated_at: now,
  };
  const result = await supabaseRequest("ux_knowledge_memory", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const saved = Array.isArray(result) ? result[0] : null;
  if (!saved?.id) throw new Error("Supabase did not return the saved Knowledge Base memory.");
  return saved as KnowledgeMemory;
}

export async function listKnowledgeMemory(status: string = "all", limit = 50) {
  const allowed: KnowledgeMemoryStatus[] = ["draft", "approved", "rejected", "archived"];
  const normalizedStatus = status === "all" ? "all" : allowed.includes(status as KnowledgeMemoryStatus) ? status : "all";
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 50));
  const filter = normalizedStatus === "all" ? "" : `&status=eq.${normalizedStatus}`;
  const result = await supabaseRequest(
    `ux_knowledge_memory?select=${memoryColumns(true)}${filter}&order=updated_at.desc&limit=${safeLimit}`,
  );
  return Array.isArray(result) ? result as KnowledgeMemory[] : [];
}

export async function listApprovedKnowledgeMemory(limit = 100) {
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 100));
  const result = await supabaseRequest(
    `ux_knowledge_memory?select=${memoryColumns(false)}&status=eq.approved&order=updated_at.desc&limit=${safeLimit}`,
  );
  return Array.isArray(result) ? result as KnowledgeMemory[] : [];
}

export async function listApprovedKnowledgeMemoryForExport(limit = 1000) {
  const safeLimit = Math.max(1, Math.min(2000, Number.isFinite(limit) ? Math.floor(limit) : 1000));
  const result = await supabaseRequest(
    `ux_knowledge_memory?select=${memoryColumns(true)}&status=eq.approved&order=updated_at.asc&limit=${safeLimit}`,
  );
  return Array.isArray(result) ? result as KnowledgeMemory[] : [];
}

export async function reviewKnowledgeMemory(idValue: unknown, actionValue: unknown, noteValue?: unknown) {
  const id = limitedText(idValue, 64, "id", true);
  if (!isUuid(id)) throw new Error("id must be a valid Knowledge Base memory UUID.");
  const action = limitedText(actionValue, 20, "action", true) as KnowledgeMemoryAction;
  if (!["approve", "reject", "archive"].includes(action)) throw new Error("action must be approve, reject, or archive.");

  const now = new Date().toISOString();
  const status: KnowledgeMemoryStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "archived";
  const result = await supabaseRequest(`ux_knowledge_memory?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status,
      updated_at: now,
      approved_at: status === "approved" ? now : null,
      review_note: limitedText(noteValue, 1000, "reviewNote") || null,
    }),
  });
  const saved = Array.isArray(result) ? result[0] : null;
  if (!saved?.id) throw new Error("Knowledge Base memory was not found or could not be updated.");
  return saved as KnowledgeMemory;
}

export async function recordKnowledgeMemoryUse(id: string, usageCount: number, usedAt: string) {
  await supabaseRequest(`ux_knowledge_memory?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ usage_count: usageCount + 1, last_used_at: usedAt }),
  });
}
