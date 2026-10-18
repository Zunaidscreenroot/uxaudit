import type { AuditPage, AuditResult } from "@/lib/audit";
import { listApprovedCoachLearnings, type CoachLearning } from "@/lib/coach-learning";
import { getSql } from "@/lib/neon-db";
import { resolveAuditScreenshot, storeAuditScreenshot } from "@/lib/audit-storage";

function normalizeClientName(name: string) {
  const normalized = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return normalized || "unknown client";
}

export async function saveAudit(result: AuditResult, sourceFilename: string): Promise<string> {
  const page: AuditPage | undefined = result.pages[0];
  if (!page) throw new Error("Cannot save an audit without a report page.");

  const sql = getSql();
  const clientName = page.clientName?.trim() || "Unknown client";
  const normalizedName = normalizeClientName(clientName);
  const [client] = await sql`
    INSERT INTO audit_clients (name, normalized_name, updated_at)
    VALUES (${clientName}, ${normalizedName}, now())
    ON CONFLICT (normalized_name)
    DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    RETURNING id
  `;
  if (!client?.id) throw new Error("Neon did not return the client record.");

  const auditId = crypto.randomUUID();
  const screenshotRef = await storeAuditScreenshot(page.screenshot, auditId);
  const viewMode = page.auditMode || "unknown";
  const [audit] = await sql`
    INSERT INTO audits (
      id, client_id, client_name, title, screenshot, screenshot_width,
      screenshot_height, source_filename, view_mode
    )
    VALUES (
      ${auditId}::uuid, ${client.id}::uuid, ${clientName},
      ${page.title?.trim() || "Audit"}, ${screenshotRef},
      ${page.screenshotWidth || 0}, ${page.screenshotHeight || 0},
      ${sourceFilename}, ${viewMode}
    )
    RETURNING id
  `;
  if (!audit?.id) throw new Error("Neon did not return the audit record.");

  // audit_findings.page_id references audit_pages.id; persist that parent row first.
  const [savedPage] = await sql`
    INSERT INTO audit_pages (
      audit_id, page_name, source_filename, title, screenshot,
      screenshot_width, screenshot_height, view_mode
    )
    VALUES (
      ${audit.id}::uuid, ${page.title?.trim() || "Audit page"}, ${sourceFilename},
      ${page.title?.trim() || "Audit page"}, ${screenshotRef},
      ${page.screenshotWidth || 0}, ${page.screenshotHeight || 0}, ${viewMode}
    )
    RETURNING id
  `;
  if (!savedPage?.id) throw new Error("Neon did not return the audit page record.");
  page.id = savedPage.id as string;

  await Promise.all(page.findings.map((finding, index) => sql`
    INSERT INTO audit_findings (audit_id, page_id, finding_index, finding)
    VALUES (${audit.id}::uuid, ${savedPage.id}::uuid, ${index}, ${JSON.stringify(finding)}::jsonb)
  `));
  return audit.id as string;
}

export async function listClients() {
  const sql = getSql();
  return sql`SELECT id, name, created_at, updated_at FROM audit_clients ORDER BY name ASC`;
}

export async function listAudits(clientId: string) {
  const sql = getSql();
  return sql`
    SELECT id, client_id, client_name, title, source_filename, created_at,
      screenshot_width, screenshot_height, view_mode
    FROM audits
    WHERE client_id = ${clientId}::uuid
    ORDER BY created_at DESC
  `;
}

export async function getAudit(auditId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(auditId)) return null;
  const sql = getSql();
  const [audit] = await sql`
    SELECT id, client_id, client_name, title, source_filename, created_at,
      screenshot, screenshot_width, screenshot_height, view_mode, report_html,
      report_generated_at
    FROM audits WHERE id = ${auditId}::uuid LIMIT 1
  `;
  if (!audit) return null;

  const findings = await sql`
    SELECT id, finding_index, finding, created_at
    FROM audit_findings
    WHERE audit_id = ${auditId}::uuid
    ORDER BY finding_index ASC
  `;
  return {
    ...audit,
    screenshot: resolveAuditScreenshot(audit.screenshot),
    findings: Array.isArray(findings) ? findings : [],
  };
}

export async function retrieveRelevantAuditKnowledge(query: string, limit = 6): Promise<string> {
  try {
    const db = getSql();
    const [findingRows, documents, coachLessons] = await Promise.all([
      db`
        SELECT f.finding, f.created_at, a.client_name, a.title AS audit_title,
          a.created_at AS audit_created_at
        FROM audit_findings f
        LEFT JOIN audits a ON a.id = f.audit_id
        ORDER BY f.created_at DESC LIMIT 120
      `,
      db`
        SELECT title, source_name, source_url, topic, content, keywords, reviewed_at
        FROM ux_knowledge_documents
        ORDER BY reviewed_at DESC LIMIT 100
      `,
      listApprovedCoachLearnings(100),
    ]);
    const stop = new Set(["the","and","for","with","from","that","this","into","your","have","has","are","was","were","will","their","they","them","page","site","website","user","users","visible","issue","finding","because","could","should","would","about","when","where","what","how","not","can","may","more","less"]);
    const terms = (value: string) => [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g," ").split(" ").filter(w=>w.length>2&&!stop.has(w)))];
    const queryTerms = terms(query);
    const candidates:any[] = [];
    for (const row of Array.isArray(findingRows)?findingRows:[]) {
      const finding = row.finding && typeof row.finding === "object" ? row.finding : {};
      const audit = { client_name: row.client_name, title: row.audit_title, created_at: row.audit_created_at };
      const text = [audit.client_name,audit.title,finding.category,finding.title,finding.description,finding.recommendation,...(finding.evidence||[]).map((e:any)=>[e.section,e.element,e.detail].join(" "))].filter(Boolean).join(" ");
      const tokens = new Set(terms(text));
      const overlap = queryTerms.filter(t=>tokens.has(t)).length;
      const sameClient = queryTerms.some(t=>String(audit.client_name||"").toLowerCase().includes(t)) ? 2 : 0;
      const severity = finding.severity === "high" ? 0.5 : 0;
      if(overlap+sameClient+severity>0)candidates.push({kind:"prior finding",score:overlap+sameClient+severity,text:`[Prior finding; client ${audit.client_name||"unknown"}; audit ${audit.title||"untitled"}; saved ${audit.created_at||row.created_at||"date unavailable"}] ${finding.severity||"unrated"} · ${finding.category||"UX"} — ${finding.title||"Finding"}. Evidence: ${(finding.evidence||[]).map((e:any)=>e.detail).filter(Boolean).join("; ")||finding.description||"not supplied"}. Recommendation: ${finding.recommendation||"not supplied"}.`});
    }
    for (const doc of Array.isArray(documents)?documents:[]) {
      const text = [doc.title,doc.source_name,doc.topic,doc.content,...(Array.isArray(doc.keywords)?doc.keywords:[])].filter(Boolean).join(" ");
      const tokens = new Set(terms(text));
      const overlap = queryTerms.filter(t=>tokens.has(t)).length;
      if(overlap>0)candidates.push({kind:"standard",score:overlap+1,text:`[Reference: ${doc.title}; source: ${doc.source_name}; topic: ${doc.topic}; URL: ${doc.source_url}; reviewed: ${doc.reviewed_at}] ${doc.content}`});
    }
    const isBfsiContext = /\b(bfsi|bank|banking|finance|financial|insurance|nbfc|lender|loan|credit|upi|deposit|wealth|ujjivan|dmi|equitas|suryoday|hdfc|icici|sbi|axis|kotak|india|indian)\b/i.test(query);
    const learningCandidates: Array<{ id: string; score: number; usageCount: number; text: string }> = [];
    for (const lesson of Array.isArray(coachLessons) ? coachLessons : []) {
      const learning = lesson as CoachLearning;
      const scope = String(learning.scope || "all audits");
      const keywordList = Array.isArray(learning.keywords) ? learning.keywords : [];
      const example = Array.isArray(learning.examples) ? learning.examples.find((value): value is string => typeof value === "string") : undefined;
      const searchable = [learning.title, learning.rule, learning.rationale, scope, ...keywordList].filter(Boolean).join(" ");
      const tokenSet = new Set(terms(searchable));
      const overlap = queryTerms.filter((term) => tokenSet.has(term)).length;
      const scopeTokens = new Set(terms(scope));
      const scopeOverlap = queryTerms.filter((term) => scopeTokens.has(term)).length;
      const globalScope = /^(all|global)(\s+audits?)?$/i.test(scope.trim());
      const bfsScope = /\b(bfsi|bank|finance|financial|insurance|nbfc|lender|indian)\b/i.test(scope);
      const score = overlap + scopeOverlap * 0.75 + (globalScope ? 1.25 : 0) + (isBfsiContext && bfsScope ? 2.5 : 0);
      if (score <= 0) continue;
      learningCandidates.push({
        id: learning.id,
        score,
        usageCount: Number(learning.usage_count || 0),
        text: `[APPROVED COACHING RULE; scope: ${scope}] ${String(learning.title || "UX rule").slice(0, 140)}: ${String(learning.rule || "").slice(0, 600)}${learning.rationale ? " Why it matters: " + String(learning.rationale).slice(0, 180) : ""}${example ? " Calibration example (preference only, not evidence): " + example.slice(0, 220) : ""}`,
      });
    }
    const rankedLessons = learningCandidates.sort((a,b)=>b.score-a.score).slice(0,3);
    if (rankedLessons.length) {
      const usedAt = new Date().toISOString();
      await Promise.all(rankedLessons.map(async (lesson) => {
        try {
          await db`UPDATE ux_coach_learnings
            SET usage_count = ${lesson.usageCount + 1}, last_used_at = ${usedAt}
            WHERE id = ${lesson.id}::uuid`;
        } catch { /* Usage metrics are non-critical; never fail an audit because a counter could not be updated. */ }
      }));
    }
    const ranked = candidates.sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(limit,10)));
    const sections = [
      rankedLessons.length ? "APPROVED COACHING RULES (apply only within the stated scope; current screenshot evidence remains mandatory):\n" + rankedLessons.map((item) => item.text).join("\n").slice(0, 2400) : "",
      ranked.length ? "RELEVANT HISTORICAL FINDINGS AND REFERENCE MATERIAL (examples only; never assume the current page has the same issue):\n" + ranked.map((item:any)=>item.text).join("\n") : "",
    ].filter(Boolean);
    return sections.join("\n\n");
  } catch (error) {
    console.warn("[uxaudit] knowledge_retrieval_skipped", error instanceof Error ? error.message : "Knowledge base unavailable");
    return "";
  }
}
