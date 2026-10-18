import type { AuditPage, AuditResult } from "@/lib/audit";
import { retrieveSharedBrainContext } from "@/lib/shared-brain-client";
import { queryDb } from "@/lib/db";
import { readImageDataUri, storeImageDataUri } from "@/lib/r2-assets";

function normalizeClientName(name: string) {
  const normalized = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return normalized || "unknown client";
}

export async function saveAudit(result: AuditResult, sourceFilename: string): Promise<string> {
  const page: AuditPage | undefined = result.pages[0];
  if (!page) throw new Error("Cannot save an audit without a report page.");
  const clientName = page.clientName?.trim() || "Unknown client";
  const normalizedName = normalizeClientName(clientName);

  // Persist the image once in shared R2; relational records store only its reference.
  const screenshotRef = await storeImageDataUri(page.screenshot, { sourceScope: "ux-audit", referenceCount: 2 });
  const clients = await queryDb<{ id: string }>(
    `INSERT INTO public.audit_clients (name, normalized_name, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
     RETURNING id`,
    [clientName, normalizedName],
  );
  const client = clients[0];
  if (!client?.id) throw new Error("Neon did not return the client record.");

  const audits = await queryDb<{ id: string }>(
    `INSERT INTO public.audits
       (client_id, client_name, title, screenshot, screenshot_width, screenshot_height, source_filename)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [client.id, clientName, page.title, screenshotRef, page.screenshotWidth, page.screenshotHeight, sourceFilename],
  );
  const audit = audits[0];
  if (!audit?.id) throw new Error("Neon did not return the audit record.");

  const pages = await queryDb<{ id: string }>(
    `INSERT INTO public.audit_pages
       (audit_id, page_name, source_filename, title, screenshot, screenshot_width, screenshot_height)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [audit.id, page.title?.trim() || "Audit page", sourceFilename, page.title, screenshotRef, page.screenshotWidth, page.screenshotHeight],
  );
  const savedPage = pages[0];
  if (!savedPage?.id) throw new Error("Neon did not return the audit page record.");
  page.id = savedPage.id;

  if (page.findings.length) {
    const values: unknown[] = [];
    const tuples = page.findings.map((finding, index) => {
      const base = values.length;
      values.push(audit.id, savedPage.id, index, JSON.stringify(finding));
      return `(${base + 1}::uuid, ${base + 2}::uuid, ${base + 3}, ${base + 4}::jsonb)`;
    });
    await queryDb(
      `INSERT INTO public.audit_findings (audit_id, page_id, finding_index, finding)
       VALUES ${tuples.join(",")}`,
      values,
    );
  }
  return audit.id;
}

export async function listClients() {
  return await queryDb(
    "SELECT id, name, created_at, updated_at FROM public.audit_clients ORDER BY name ASC",
  );
}

export async function listAudits(clientId: string) {
  return await queryDb(
    `SELECT id, client_id, client_name, title, source_filename, created_at, screenshot_width, screenshot_height
     FROM public.audits
     WHERE client_id = $1::uuid
     ORDER BY created_at DESC`,
    [clientId],
  );
}

export async function getAudit(auditId: string) {
  const audits = await queryDb<Record<string, unknown>>(
    `SELECT id, client_id, client_name, title, source_filename, created_at, screenshot, screenshot_width, screenshot_height, view_mode, report_html, report_generated_at
     FROM public.audits WHERE id = $1::uuid LIMIT 1`,
    [auditId],
  );
  const audit = audits[0];
  if (!audit) return null;
  const findings = await queryDb(
    `SELECT id, finding_index, finding, created_at, page_id
     FROM public.audit_findings WHERE audit_id = $1::uuid ORDER BY finding_index ASC`,
    [auditId],
  );
  return {
    ...audit,
    screenshot: typeof audit.screenshot === "string" ? await readImageDataUri(audit.screenshot) : audit.screenshot,
    findings,
  };
}

export async function retrieveRelevantAuditKnowledge(query: string, limit = 6): Promise<string> {
  const stop = new Set([
    "the","and","for","with","from","that","this","into","your","have","has","are","was","were",
    "will","their","they","them","page","site","website","user","users","visible","issue","finding",
    "because","could","should","would","about","when","where","what","how","not","can","may","more","less",
  ]);
  const terms = (value: string) => [...new Set(
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 2 && !stop.has(word)),
  )];
  const queryTerms = terms(query);
  const [findingRows, sharedBrain] = await Promise.all([
    queryDb<Record<string, unknown>>(
      `SELECT f.finding, f.created_at, a.client_name, a.title AS audit_title, a.created_at AS audit_created_at
       FROM public.audit_findings f
       LEFT JOIN public.audits a ON a.id = f.audit_id
       ORDER BY f.created_at DESC
       LIMIT 120`,
    ).catch((error) => {
      console.warn("[uxaudit] past_findings_retrieval_skipped", error instanceof Error ? error.message.slice(0, 160) : "Past Findings unavailable");
      return [];
    }),
    retrieveSharedBrainContext(query, ["UX_SHARED_BRAIN", "indian-bfsi", "project:ux-audit"], Math.max(1, Math.min(limit, 8)))
      .catch((error) => {
        console.warn("[uxaudit] shared_brain_retrieval_skipped", error instanceof Error ? error.message.slice(0, 160) : "Shared brain unavailable");
        return { contextText: "", retrieval: { status: "degraded" as const } };
      }),
  ]);

  const candidates: Array<{ score: number; text: string }> = [];
  for (const row of findingRows) {
    const finding = row.finding && typeof row.finding === "object" && !Array.isArray(row.finding)
      ? row.finding as Record<string, unknown>
      : {};
    const evidence = Array.isArray(finding.evidence) ? finding.evidence as Array<Record<string, unknown>> : [];
    const clientName = String(row.client_name || "unknown client");
    const auditTitle = String(row.audit_title || "untitled");
    const searchable = [
      clientName, auditTitle, finding.category, finding.title, finding.description, finding.recommendation,
      ...evidence.flatMap((item) => [item.section, item.element, item.detail]),
    ].filter((item): item is string => typeof item === "string").join(" ");
    const tokenSet = new Set(terms(searchable));
    const overlap = queryTerms.filter((term) => tokenSet.has(term)).length;
    const sameClient = queryTerms.some((term) => clientName.toLowerCase().includes(term)) ? 2 : 0;
    const severity = finding.severity === "high" ? 0.5 : 0;
    const score = overlap + sameClient + severity;
    if (score <= 0) continue;
    const evidenceText = evidence.map((item) => item.detail).filter((item): item is string => typeof item === "string").join("; ");
    candidates.push({
      score,
      text: `[Past Finding; client: ${clientName}; audit: ${auditTitle}; saved: ${String(row.audit_created_at || row.created_at || "date unavailable")}] ${String(finding.severity || "unrated")} · ${String(finding.category || "UX")} — ${String(finding.title || "Finding")}. Evidence: ${evidenceText || String(finding.description || "not supplied")}. Recommendation: ${String(finding.recommendation || "not supplied")}.`,
    });
  }

  const rankedPastFindings = candidates.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 10)));
  const sections = [
    sharedBrain.contextText.trim()
      ? "SHARED KNOWLEDGE BASE (approved reusable rules and references; apply only within their scope. Current screenshot evidence takes precedence):\n" + sharedBrain.contextText.trim().slice(0, 3200)
      : "",
    rankedPastFindings.length
      ? "PAST FINDINGS (client-specific historical examples only; never assume the current page has the same issue):\n" + rankedPastFindings.map((item) => item.text).join("\n").slice(0, 1800)
      : "",
  ].filter(Boolean);
  return sections.join("\n\n").slice(0, 5000);
}
