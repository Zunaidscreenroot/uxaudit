import type { AuditPage, AuditResult, Finding } from "@/lib/audit";
import { buildClientReportHtml } from "@/lib/client-report";

function config() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configure SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) for the knowledge base.");
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function normalizeClientName(name: string) {
  const normalized = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return normalized || "unknown client";
}

function firstPage(result: AuditResult) {
  const page = result.pages[0];
  if (!page) throw new Error("Cannot save an audit without at least one page.");
  return page;
}

export async function saveAudit(result: AuditResult, sourceFilename: string): Promise<string> {
  const page = firstPage(result);
  const clientName = page.clientName?.trim() || "Unknown client";
  const normalizedName = normalizeClientName(clientName);
  const createdAt = new Date().toISOString();

  const clients = await supabaseRequest("audit_clients?on_conflict=normalized_name", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ name: clientName, normalized_name: normalizedName, updated_at: createdAt }),
  });
  const client = Array.isArray(clients) ? clients[0] : null;
  if (!client?.id) throw new Error("Supabase did not return the client record.");

  const auditTitle = result.pages.length === 1 ? page.title : `${result.pages.length} page audit · ${result.pages.map((item) => item.title).join(" · ")}`;
  const audits = await supabaseRequest("audits", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      client_id: client.id,
      client_name: clientName,
      title: auditTitle,
      screenshot: page.screenshot,
      screenshot_width: page.screenshotWidth,
      screenshot_height: page.screenshotHeight,
      view_mode: page.viewMode || "unknown",
      source_filename: result.pages.map((item) => item.title || sourceFilename).join(", "),
      created_at: createdAt,
    }),
  });
  const audit = Array.isArray(audits) ? audits[0] : null;
  if (!audit?.id) throw new Error("Supabase did not return the audit record.");

  const pagesPayload = result.pages.map((item) => ({
    audit_id: audit.id,
    page_name: item.title,
    source_filename: item.title,
    title: item.title,
    screenshot: item.screenshot,
    screenshot_width: item.screenshotWidth,
    screenshot_height: item.screenshotHeight,
    view_mode: item.viewMode || "unknown",
    created_at: createdAt,
  }));
  const storedPages = await supabaseRequest("audit_pages", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(pagesPayload) });
  if (!Array.isArray(storedPages) || storedPages.length !== result.pages.length) throw new Error("Supabase did not return all audit pages.");

  const pageByTitle = new Map<string, any>();
  for (const storedPage of storedPages) pageByTitle.set(String(storedPage.page_name), storedPage);
  const findingsPayload = result.pages.flatMap((item, pageIndex) => item.findings.map((finding, findingIndex) => ({ audit_id: audit.id, page_id: pageByTitle.get(item.title)?.id, finding_index: pageIndex * 100 + findingIndex, finding })));
  if (findingsPayload.some((item) => !item.page_id)) throw new Error("Supabase did not return page IDs for all audit pages.");
  if (findingsPayload.length) await supabaseRequest("audit_findings", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(findingsPayload) });

  (result as AuditResult & { auditId?: string }).auditId = audit.id as string;
  result.pages = result.pages.map((item, index) => ({ ...item, id: storedPages[index]?.id, createdAt }));
  return audit.id as string;
}

export async function generateClientReport(auditId: string) {
  const audit = await getAudit(auditId);
  if (!audit) throw new Error("Audit not found.");
  const html = await buildClientReportHtml(audit);
  const generatedAt = new Date().toISOString();
  await supabaseRequest(`audits?id=eq.${encodeURIComponent(auditId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ report_html: html, report_generated_at: generatedAt }) });
  return { auditId, generatedAt, html };
}

export async function deleteAudit(auditId: string) {
  const audit = await supabaseRequest(`audits?select=id,client_id&id=eq.${encodeURIComponent(auditId)}&limit=1`);
  const row = Array.isArray(audit) ? audit[0] : null;
  if (!row?.id) throw new Error("Audit not found.");
  await supabaseRequest(`audits?id=eq.${encodeURIComponent(auditId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  const remaining = await supabaseRequest(`audits?select=id&client_id=eq.${encodeURIComponent(row.client_id)}&limit=1`);
  if (!Array.isArray(remaining) || remaining.length === 0) await supabaseRequest(`audit_clients?id=eq.${encodeURIComponent(row.client_id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return { deleted: true, auditId };
}

export async function listClients() {
  return supabaseRequest("audit_clients?select=id,name,created_at,updated_at&order=name.asc");
}

export async function listAudits(clientId: string) {
  return supabaseRequest(`audits?select=id,client_id,client_name,title,source_filename,created_at,screenshot_width,screenshot_height,view_mode,report_generated_at,audit_pages(id,page_name,source_filename,view_mode)&client_id=eq.${encodeURIComponent(clientId)}&order=created_at.desc`);
}

export async function getAudit(auditId: string) {
  const audits = await supabaseRequest(`audits?select=id,client_id,client_name,title,source_filename,created_at,screenshot,screenshot_width,screenshot_height,view_mode,report_html,report_generated_at,audit_pages(id,page_name,source_filename,title,screenshot,screenshot_width,screenshot_height,view_mode,created_at)&id=eq.${encodeURIComponent(auditId)}&limit=1`);
  const audit = Array.isArray(audits) ? audits[0] : null;
  if (!audit) return null;

  const findingRows = await supabaseRequest(`audit_findings?select=id,page_id,finding_index,finding,created_at&audit_id=eq.${encodeURIComponent(auditId)}&order=finding_index.asc`);
  const rows = Array.isArray(findingRows) ? findingRows : [];
  const storedPages = Array.isArray(audit.audit_pages) ? audit.audit_pages : [];
  const pages = storedPages.length ? storedPages.map((page: any) => ({
    id: page.id,
    auditId: audit.id,
    clientName: audit.client_name,
    viewMode: page.view_mode,
    url: "",
    title: page.title || page.page_name,
    screenshot: page.screenshot,
    screenshotWidth: page.screenshot_width,
    screenshotHeight: page.screenshot_height,
    findings: rows.filter((row: any) => row.page_id === page.id).map((row: any) => row.finding as Finding),
    createdAt: page.created_at || audit.created_at,
  })) : [{
    id: audit.id,
    auditId: audit.id,
    clientName: audit.client_name,
    viewMode: audit.view_mode,
    url: "",
    title: audit.title,
    screenshot: audit.screenshot,
    screenshotWidth: audit.screenshot_width,
    screenshotHeight: audit.screenshot_height,
    findings: rows.map((row: any) => row.finding as Finding),
    createdAt: audit.created_at,
  }];

  return { ...audit, pages, findings: rows };
}
