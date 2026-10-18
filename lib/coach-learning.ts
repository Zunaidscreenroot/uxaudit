export type CoachLearningStatus = "draft" | "approved" | "rejected" | "archived";
export type CoachLearningAction = "approve" | "reject" | "archive";

export type CoachLearning = {
  id: string;
  raw_feedback: string;
  title: string;
  rule: string;
  rationale: string;
  scope: string;
  keywords: string[];
  examples: unknown[];
  source_language: string;
  source_type: string;
  status: CoachLearningStatus;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  usage_count: number;
  last_used_at: string | null;
  feedback_kind: string;
  source_audit_id: string | null;
  source_finding_title: string | null;
};

function config() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Configure SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) to use Coach & Learn.");
  }
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
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new Error(`${field} is required.`);
  if (text.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return text;
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0 && item.length <= 60))]
    .slice(0, 20);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function saveCoachingLesson(input: {
  rawFeedback: unknown;
  title: unknown;
  rule: unknown;
  rationale?: unknown;
  scope?: unknown;
  keywords?: unknown;
  examples?: unknown;
  sourceLanguage?: unknown;
  sourceType?: unknown;
  feedbackKind?: unknown;
  sourceAuditId?: unknown;
  sourceFindingTitle?: unknown;
  activate?: unknown;
}) {
  const now = new Date().toISOString();
  const activate = input.activate === true;
  const examples = Array.isArray(input.examples) ? input.examples.slice(0, 8) : [];
  const sourceAuditId = limitedText(input.sourceAuditId, 64, "sourceAuditId");
  if (sourceAuditId && !isUuid(sourceAuditId)) throw new Error("sourceAuditId must be a valid audit UUID.");
  const feedbackKind = limitedText(input.feedbackKind, 40, "feedbackKind") || "general";
  const allowedFeedbackKinds = ["general", "false_positive", "missed_issue", "severity_calibration", "recommendation_quality", "duplicate_finding", "benchmarking", "scope", "visual_evidence", "accessibility", "other"];
  if (!allowedFeedbackKinds.includes(feedbackKind)) throw new Error("feedbackKind is not a supported coaching category.");
  const row = {
    raw_feedback: limitedText(input.rawFeedback, 8000, "rawFeedback", true),
    title: limitedText(input.title, 180, "title", true),
    rule: limitedText(input.rule, 1400, "rule", true),
    rationale: limitedText(input.rationale, 1000, "rationale"),
    scope: limitedText(input.scope, 160, "scope") || "all audits",
    keywords: normalizeKeywords(input.keywords),
    examples,
    source_language: limitedText(input.sourceLanguage, 40, "sourceLanguage") || "unknown",
    source_type: limitedText(input.sourceType, 40, "sourceType") || "chatgpt_voice",
    feedback_kind: feedbackKind,
    source_audit_id: sourceAuditId || null,
    source_finding_title: limitedText(input.sourceFindingTitle, 240, "sourceFindingTitle") || null,
    status: activate ? "approved" : "draft",
    approved_at: activate ? now : null,
    updated_at: now,
  };
  const result = await supabaseRequest("ux_coach_learnings", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const saved = Array.isArray(result) ? result[0] : null;
  if (!saved?.id) throw new Error("Supabase did not return the saved coaching lesson.");
  return saved as CoachLearning;
}

export async function listCoachingLessons(status: string = "all", limit = 50) {
  const allowed: CoachLearningStatus[] = ["draft", "approved", "rejected", "archived"];
  const normalizedStatus = status === "all" ? "all" : allowed.includes(status as CoachLearningStatus) ? status : "all";
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 50));
  const columns = "id,raw_feedback,title,rule,rationale,scope,keywords,examples,source_language,source_type,feedback_kind,source_audit_id,source_finding_title,status,review_note,created_at,updated_at,approved_at,usage_count,last_used_at";
  const filter = normalizedStatus === "all" ? "" : `&status=eq.${normalizedStatus}`;
  const result = await supabaseRequest(
    `ux_coach_learnings?select=${columns}${filter}&order=updated_at.desc&limit=${safeLimit}`,
  );
  return Array.isArray(result) ? result as CoachLearning[] : [];
}

export async function listApprovedCoachLearnings(limit = 100) {
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 100));
  const result = await supabaseRequest(
    `ux_coach_learnings?select=id,title,rule,rationale,scope,keywords,feedback_kind,source_audit_id,source_finding_title,status,created_at,updated_at,approved_at,usage_count,last_used_at&status=eq.approved&order=updated_at.desc&limit=${safeLimit}`,
  );
  return Array.isArray(result) ? result : [];
}

export async function reviewCoachingLesson(idValue: unknown, actionValue: unknown, noteValue?: unknown) {
  const id = limitedText(idValue, 64, "id", true);
  if (!isUuid(id)) throw new Error("id must be a valid learning UUID.");
  const action = limitedText(actionValue, 20, "action", true) as CoachLearningAction;
  if (!["approve", "reject", "archive"].includes(action)) {
    throw new Error("action must be approve, reject, or archive.");
  }
  const now = new Date().toISOString();
  const status: CoachLearningStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "archived";
  const result = await supabaseRequest(`ux_coach_learnings?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status,
      updated_at: now,
      approved_at: status === "approved" ? now : null,
      review_note: limitedText(noteValue, 1000, "reviewNote"),
    }),
  });
  const saved = Array.isArray(result) ? result[0] : null;
  if (!saved?.id) throw new Error("Learning rule was not found or could not be updated.");
  return saved as CoachLearning;
}
