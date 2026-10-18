import type { AuditPage, AuditResult } from "@/lib/audit";
import { retrieveSharedBrainContext } from "@/lib/ux-direct-brain";

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

function normalizeClientName(name: string) {
  const normalized = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return normalized || "unknown client";
}

export async function saveAudit(result: AuditResult, sourceFilename: string): Promise<string> {
  const page: AuditPage | undefined = result.pages[0];
  if (!page) throw new Error("Cannot save an audit without a report page.");
  const clientName = page.clientName?.trim() || "Unknown client";
  const normalizedName = normalizeClientName(clientName);

  const clients = await supabaseRequest("audit_clients?on_conflict=normalized_name", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ name: clientName, normalized_name: normalizedName, updated_at: new Date().toISOString() }),
  });
  const client = Array.isArray(clients) ? clients[0] : null;
  if (!client?.id) throw new Error("Supabase did not return the client record.");

  const audits = await supabaseRequest("audits", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ client_id: client.id, client_name: clientName, title: page.title, screenshot: page.screenshot, screenshot_width: page.screenshotWidth, screenshot_height: page.screenshotHeight, source_filename: sourceFilename }),
  });
  const audit = Array.isArray(audits) ? audits[0] : null;
  if (!audit?.id) throw new Error("Supabase did not return the audit record.");

  // audit_findings.page_id is NOT NULL and references audit_pages.id.
  // Persist the page first so findings always point at a real page row.
  const pages = await supabaseRequest("audit_pages", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      audit_id: audit.id,
      page_name: page.title?.trim() || "Audit page",
      source_filename: sourceFilename,
      title: page.title,
      screenshot: page.screenshot,
      screenshot_width: page.screenshotWidth,
      screenshot_height: page.screenshotHeight,
    }),
  });
  const savedPage = Array.isArray(pages) ? pages[0] : null;
  if (!savedPage?.id) throw new Error("Supabase did not return the audit page record.");
  page.id = savedPage.id as string;

  if (page.findings.length) {
    await supabaseRequest("audit_findings", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(page.findings.map((finding, index) => ({
        audit_id: audit.id,
        page_id: savedPage.id,
        finding_index: index,
        finding,
      }))),
    });
  }
  return audit.id as string;
}

export async function listClients() {
  return supabaseRequest("audit_clients?select=id,name,created_at,updated_at&order=name.asc");
}

export async function listAudits(clientId: string) {
  return supabaseRequest(`audits?select=id,client_id,client_name,title,source_filename,created_at,screenshot_width,screenshot_height&client_id=eq.${encodeURIComponent(clientId)}&order=created_at.desc`);
}

export async function getAudit(auditId: string) {
  const audits = await supabaseRequest(`audits?select=id,client_id,client_name,title,source_filename,created_at,screenshot,screenshot_width,screenshot_height&id=eq.${encodeURIComponent(auditId)}&limit=1`);
  const audit = Array.isArray(audits) ? audits[0] : null;
  if (!audit) return null;
  const findings = await supabaseRequest(`audit_findings?select=id,finding_index,finding,created_at&audit_id=eq.${encodeURIComponent(auditId)}&order=finding_index.asc`);
  return { ...audit, findings: Array.isArray(findings) ? findings : [] };
}

export async function retrieveRelevantAuditKnowledge(query: string, limit = 6): Promise<string> {
  try {
    const [findingRows, documents] = await Promise.all([
      supabaseRequest("audit_findings?select=finding,created_at,audits!audit_findings_audit_id_fkey(client_name,title,created_at)&order=created_at.desc&limit=120"),
      supabaseRequest("ux_knowledge_documents?select=title,source_name,source_url,topic,content,keywords,reviewed_at&order=reviewed_at.desc&limit=100"),
    ]);
    const stop = new Set(["the","and","for","with","from","that","this","into","your","have","has","are","was","were","will","their","they","them","page","site","website","user","users","visible","issue","finding","because","could","should","would","about","when","where","what","how","not","can","may","more","less"]);
    const terms = (value: string) => [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g," ").split(" ").filter(w=>w.length>2&&!stop.has(w)))];
    const queryTerms = terms(query);
    const candidates: Array<{kind:string;score:number;text:string}> = [];
    for (const row of Array.isArray(findingRows)?findingRows:[]) {
      const finding = row.finding && typeof row.finding === "object" ? row.finding : {};
      const audit = row.audits && typeof row.audits === "object" ? row.audits : {};
      const text = [audit.client_name,audit.title,finding.category,finding.title,finding.description,finding.recommendation,...(finding.evidence||[]).map((e:any)=>[e.section,e.element,e.detail].join(" "))].filter(Boolean).join(" ");
      const tokens = new Set(terms(text));
      const overlap = queryTerms.filter(t=>tokens.has(t)).length;
      const sameClient = queryTerms.some(t=>String(audit.client_name||"").toLowerCase().includes(t)) ? 2 : 0;
      const severity = finding.severity === "high" ? 0.5 : 0;
      if(overlap+sameClient+severity>0)candidates.push({kind:"past finding",score:overlap+sameClient+severity,text:`[LOCAL PAST FINDING; client ${audit.client_name||"unknown"}; audit ${audit.title||"untitled"}; saved ${audit.created_at||row.created_at||"date unavailable"}] ${finding.severity||"unrated"} · ${finding.category||"UX"} — ${finding.title||"Finding"}. Evidence: ${(finding.evidence||[]).map((e:any)=>e.detail).filter(Boolean).join("; ")||finding.description||"not supplied"}. Recommendation: ${finding.recommendation||"not supplied"}.`});
    }
    for (const doc of Array.isArray(documents)?documents:[]) {
      const text = [doc.title,doc.source_name,doc.topic,doc.content,...(Array.isArray(doc.keywords)?doc.keywords:[])].filter(Boolean).join(" ");
      const tokens = new Set(terms(text));
      const overlap = queryTerms.filter(t=>tokens.has(t)).length;
      if(overlap>0)candidates.push({kind:"local reference",score:overlap+1,text:`[LOCAL REFERENCE DOCUMENT: ${doc.title}; source: ${doc.source_name}; topic: ${doc.topic}; URL: ${doc.source_url}; reviewed: ${doc.reviewed_at}] ${String(doc.content||"").slice(0,900)}`});
    }
    const isBfsiContext = /\b(bfsi|bank|banking|finance|financial|insurance|nbfc|lender|loan|credit|upi|deposit|wealth|ujjivan|dmi|equitas|suryoday|hdfc|icici|sbi|axis|kotak|india|indian)\b/i.test(query);
    const scopes = ["UX_SHARED_BRAIN", "project:ux-audit"];
    if (isBfsiContext) scopes.push("indian-bfsi");
    const sharedBrain = await retrieveSharedBrainContext({ query, scopeKeys: scopes, limit: 5, maxChars: 2400 });
    const ranked = candidates.sort((a,b)=>b.score-a.score).slice(0,Math.max(1,Math.min(limit,6)));
    const sections = [
      sharedBrain.contextText
        ? "SHARED PRODUCT BRAIN (approved reusable rules and reference knowledge; not client past findings):\n" + sharedBrain.contextText
        : "",
      ranked.length
        ? "LOCAL AUDIT HISTORY (past client findings and locally stored references; examples only, never copy as current-page evidence or promote automatically into shared memory):\n" + ranked.map((item)=>item.text).join("\n")
        : "",
    ].filter(Boolean);
    return sections.join("\n\n").slice(0, 5200);
  } catch (error) {
    console.warn("[uxaudit] knowledge_retrieval_skipped", error instanceof Error ? error.message : "Knowledge base unavailable");
    return "";
  }
}
