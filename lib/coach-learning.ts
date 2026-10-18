import { requestSharedBrain } from "@/lib/shared-brain-client";

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

const VALID_STATUSES = new Set<CoachLearningStatus>(["draft", "approved", "rejected", "archived"]);
const VALID_FEEDBACK_KINDS = new Set([
  "general", "false_positive", "missed_issue", "severity_calibration",
  "recommendation_quality", "duplicate_finding", "benchmarking", "scope",
  "visual_evidence", "accessibility", "interaction_logic", "design_system",
  "cost_optimization", "other",
]);

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
    .filter((item) => item.length > 0 && item.length <= 64))]
    .slice(0, 32);
}

function normalizeScopeKey(scope: string): string {
  const normalized = scope.trim().toLowerCase();
  if (/\b(ujjivan|ujjivan sfb)\b/.test(normalized)) return "project:ujjivan-sfb";
  if (/\b(dmi|dmi finance|dmi hfc|dmi wealth)\b/.test(normalized)) return "project:dmi-finance";
  if (/\b(express computers?)\b/.test(normalized)) return "project:express-computers";
  if (/\b(indian bfs(i)?|bank|banking|finance|financial|insurance|nbfc|lender|loan|credit|upi|deposit|wealth)\b/.test(normalized)) return "indian-bfsi";
  if (/\b(ux direct)\b/.test(normalized)) return "project:ux-direct";
  if (/\b(ux audit|mobile|desktop audit|audit layout)\b/.test(normalized)) return "project:ux-audit";
  return "UX_SHARED_BRAIN";
}

function normalizeStatus(value: unknown): CoachLearningStatus {
  const status = typeof value === "string" ? value : "draft";
  return VALID_STATUSES.has(status as CoachLearningStatus) ? status as CoachLearningStatus : "draft";
}

function mapFeedback(value: Record<string, unknown>): CoachLearning {
  const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
    ? value.metadata as Record<string, unknown>
    : {};
  const scopeKey = typeof value.scope_key === "string" ? value.scope_key : "UX_SHARED_BRAIN";
  const scopeDescription = typeof metadata.scopeDescription === "string" ? metadata.scopeDescription : "";
  const status = normalizeStatus(value.status);
  const keywords = Array.isArray(value.keywords) ? value.keywords.filter((item): item is string => typeof item === "string") : [];
  const examples = Array.isArray(value.examples) ? value.examples : [];
  return {
    id: String(value.id || ""),
    raw_feedback: typeof value.raw_feedback === "string" ? value.raw_feedback : "",
    title: typeof value.title === "string" ? value.title : "UX coaching rule",
    rule: typeof value.normalized_rule === "string" ? value.normalized_rule : "",
    rationale: typeof value.rationale === "string" ? value.rationale : "",
    scope: scopeDescription || scopeKey,
    keywords,
    examples,
    source_language: typeof value.original_language === "string" ? value.original_language : "unknown",
    source_type: typeof metadata.sourceType === "string" ? metadata.sourceType : "shared-brain",
    status,
    review_note: typeof value.review_note === "string" ? value.review_note : null,
    created_at: typeof value.created_at === "string" ? value.created_at : new Date().toISOString(),
    updated_at: typeof value.updated_at === "string" ? value.updated_at : new Date().toISOString(),
    approved_at: status === "approved"
      ? (typeof value.reviewed_at === "string" ? value.reviewed_at : typeof value.approved_at === "string" ? value.approved_at : null)
      : null,
    usage_count: Number.isFinite(Number(value.usage_count)) ? Number(value.usage_count) : 0,
    last_used_at: typeof value.last_used_at === "string" ? value.last_used_at : null,
    feedback_kind: typeof value.feedback_kind === "string" ? value.feedback_kind : "general",
    source_audit_id: typeof value.source_audit_ref === "string" ? value.source_audit_ref : null,
    source_finding_title: typeof value.source_finding_title === "string" ? value.source_finding_title : null,
  };
}

async function fetchFeedback(status: string, limit: number): Promise<CoachLearning[]> {
  const response = await requestSharedBrain<{ feedback?: Record<string, unknown>[] }>("api/brain/feedback", {
    action: "list",
    status,
    sourceProduct: "ux-audit",
    limit: Math.max(1, Math.min(100, Math.floor(limit))),
  });
  return Array.isArray(response.feedback) ? response.feedback.map(mapFeedback) : [];
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
  const rawFeedback = limitedText(input.rawFeedback, 8000, "rawFeedback", true);
  const title = limitedText(input.title, 180, "title", true);
  const rule = limitedText(input.rule, 1400, "rule", true);
  const scope = limitedText(input.scope, 160, "scope") || "all audits";
  const feedbackKind = limitedText(input.feedbackKind, 48, "feedbackKind") || "general";
  if (!VALID_FEEDBACK_KINDS.has(feedbackKind)) throw new Error("feedbackKind is not a supported coaching category.");
  const sourceAuditId = limitedText(input.sourceAuditId, 120, "sourceAuditId");
  const sourceFindingTitle = limitedText(input.sourceFindingTitle, 240, "sourceFindingTitle");
  const sourceType = limitedText(input.sourceType, 60, "sourceType") || "chatgpt_mcp";
  const scopeKey = normalizeScopeKey(scope);
  const explicitScopeNote = scope === "all audits" ? "" : `Applicability: ${scope}.`;
  const rationale = [limitedText(input.rationale, 1000, "rationale"), explicitScopeNote].filter(Boolean).join("\n").slice(0, 1700);
  const now = new Date().toISOString();

  const savedResponse = await requestSharedBrain<{ feedback?: Record<string, unknown> }>("api/brain/feedback", {
    action: "save",
    feedback: {
      rawFeedback,
      summary: rawFeedback.slice(0, 500),
      title,
      normalizedRule: rule,
      rationale,
      scopeKey,
      feedbackKind,
      keywords: normalizeKeywords(input.keywords),
      examples: Array.isArray(input.examples) ? input.examples.slice(0, 8) : [],
      originalLanguage: limitedText(input.sourceLanguage, 40, "sourceLanguage") || "unknown",
      sourceProduct: "ux-audit",
      ...(sourceAuditId ? { sourceAuditRef: sourceAuditId } : {}),
      ...(sourceFindingTitle ? { sourceFindingTitle } : {}),
      metadata: { sourceType, scopeDescription: scope },
    },
  });
  const saved = savedResponse.feedback;
  if (!saved || typeof saved.id !== "string") throw new Error("The shared brain did not confirm the saved coaching lesson.");

  if (input.activate === true) {
    await requestSharedBrain("api/brain/feedback", {
      action: "review",
      feedbackId: saved.id,
      decision: "approve",
      sourceProduct: "ux-audit",
      reviewNote: "Explicitly approved during coaching.",
    });
  }

  return mapFeedback({
    ...saved,
    status: input.activate === true ? "approved" : "draft",
    reviewed_at: input.activate === true ? now : null,
    metadata: { sourceType, scopeDescription: scope },
  });
}

export async function listCoachingLessons(status: string = "all", limit = 50) {
  const normalizedStatus = status === "all" || VALID_STATUSES.has(status as CoachLearningStatus)
    ? status
    : "all";
  return fetchFeedback(normalizedStatus, limit);
}

export async function listApprovedCoachLearnings(limit = 100) {
  const approved = await fetchFeedback("approved", limit);
  return approved.map(({ raw_feedback: _rawFeedback, ...lesson }) => lesson);
}

export async function reviewCoachingLesson(idValue: unknown, actionValue: unknown, noteValue?: unknown) {
  const id = limitedText(idValue, 64, "id", true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("id must be a valid shared-brain feedback UUID.");
  }
  const action = limitedText(actionValue, 20, "action", true) as CoachLearningAction;
  if (!["approve", "reject", "archive"].includes(action)) throw new Error("action must be approve, reject, or archive.");
  const existing = (await fetchFeedback("all", 100)).find((lesson) => lesson.id === id);
  if (!existing) throw new Error("Coaching lesson was not found in UX Audit's shared-brain records.");
  const now = new Date().toISOString();
  await requestSharedBrain("api/brain/feedback", {
    action: "review",
    feedbackId: id,
    decision: action,
    sourceProduct: "ux-audit",
    reviewNote: limitedText(noteValue, 1000, "reviewNote"),
  });
  const status: CoachLearningStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "archived";
  return {
    ...existing,
    status,
    updated_at: now,
    approved_at: status === "approved" ? now : null,
    review_note: limitedText(noteValue, 1000, "reviewNote") || null,
  };
}
