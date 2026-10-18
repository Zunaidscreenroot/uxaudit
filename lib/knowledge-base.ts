import { listApprovedKnowledgeMemory, recordKnowledgeMemoryUse, type KnowledgeMemory } from "@/lib/knowledge-memory";

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

export async function retrieveRelevantAuditKnowledge(query: string, limit = 6): Promise<string> {
  try {
    const [findingRows, documents, memoryRows] = await Promise.all([
      supabaseRequest("audit_findings?select=finding,created_at,audits!audit_findings_audit_id_fkey(client_name,title,created_at,view_mode)&order=created_at.desc&limit=120"),
      supabaseRequest("ux_knowledge_documents?select=title,source_name,source_url,topic,content,keywords,reviewed_at&order=reviewed_at.desc&limit=100"),
      listApprovedKnowledgeMemory(100),
    ]);

    const stop = new Set(["the","and","for","with","from","that","this","into","your","have","has","are","was","were","will","their","they","them","page","site","website","user","users","visible","issue","finding","because","could","should","would","about","when","where","what","how","not","can","may","more","less"]);
    const terms = (value: string) => [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 2 && !stop.has(word)))];
    const queryTerms = terms(query);
    const candidates: Array<{ kind: "past_finding" | "reference"; score: number; text: string }> = [];

    for (const row of Array.isArray(findingRows) ? findingRows : []) {
      const finding = row.finding && typeof row.finding === "object" ? row.finding : {};
      const audit = row.audits && typeof row.audits === "object" ? row.audits : {};
      const evidence = Array.isArray(finding.evidence)
        ? finding.evidence.map((item: any) => [item.section, item.element, item.detail].filter(Boolean).join(" ")).join(" ")
        : "";
      const searchable = [audit.client_name, audit.title, finding.category, finding.title, finding.description, finding.recommendation, evidence].filter(Boolean).join(" ");
      const tokenSet = new Set(terms(searchable));
      const overlap = queryTerms.filter((term) => tokenSet.has(term)).length;
      const sameClient = queryTerms.some((term) => String(audit.client_name || "").toLowerCase().includes(term)) ? 2 : 0;
      const severityWeight = finding.severity === "high" ? 0.5 : 0;
      const score = overlap + sameClient + severityWeight;
      if (score <= 0) continue;

      // Keep the saved finding JSON intact; source metadata is separate and explicitly archival.
      candidates.push({
        kind: "past_finding",
        score,
        text: `[PAST_FINDING_V1; examples only, not a reusable rule] ${JSON.stringify({
          source: {
            client: audit.client_name || "unknown",
            audit: audit.title || "untitled",
            auditCreatedAt: audit.created_at || row.created_at || null,
            viewMode: audit.view_mode || null,
          },
          finding,
        })}`,
      });
    }

    for (const doc of Array.isArray(documents) ? documents : []) {
      const searchable = [doc.title, doc.source_name, doc.topic, doc.content, ...(Array.isArray(doc.keywords) ? doc.keywords : [])].filter(Boolean).join(" ");
      const tokenSet = new Set(terms(searchable));
      const overlap = queryTerms.filter((term) => tokenSet.has(term)).length;
      if (overlap > 0) {
        candidates.push({
          kind: "reference",
          score: overlap + 1,
          text: `[REFERENCE_DOC_V1; use as sourced guidance] ${JSON.stringify({
            title: doc.title,
            source: doc.source_name,
            url: doc.source_url,
            topic: doc.topic,
            reviewedAt: doc.reviewed_at,
            content: doc.content,
          })}`,
        });
      }
    }

    const isBfsiContext = /\b(bfsi|bank|banking|finance|financial|insurance|nbfc|lender|loan|credit|upi|deposit|wealth|ujjivan|dmi|equitas|suryoday|hdfc|icici|sbi|axis|kotak|india|indian)\b/i.test(query);
    const learningCandidates: Array<{ id: string; score: number; usageCount: number; payload: KnowledgeMemory["model_payload"] }> = [];

    for (const memory of Array.isArray(memoryRows) ? memoryRows : []) {
      const payload: KnowledgeMemory["model_payload"] = memory.model_payload && typeof memory.model_payload === "object"
        ? memory.model_payload
        : { v: 1, k: "general", s: "all_audits", r: "", kw: [], ex: [], lang: "unknown" };
      const scope = String(payload.s || "all_audits");
      const keywords = Array.isArray(payload.kw) ? payload.kw : [];
      const searchable = [payload.k, payload.s, payload.r, ...keywords].filter(Boolean).join(" ");
      const tokenSet = new Set(terms(searchable));
      const overlap = queryTerms.filter((term) => tokenSet.has(term)).length;
      const scopeTokens = new Set(terms(scope.replace(/_/g, " ")));
      const scopeOverlap = queryTerms.filter((term) => scopeTokens.has(term)).length;
      const globalScope = /^(all|all_audits|global)(\s+audits?)?$/i.test(scope);
      const bfsScope = /\b(india_bfsi|bfsi|bank|finance|financial|insurance|nbfc|lender|indian)\b/i.test(scope);
      const score = overlap + scopeOverlap * 0.75 + (globalScope ? 1.25 : 0) + (isBfsiContext && bfsScope ? 2.5 : 0);
      if (score <= 0) continue;
      learningCandidates.push({
        id: memory.id,
        score,
        usageCount: Number(memory.usage_count || 0),
        payload,
      });
    }

    const rankedMemories = learningCandidates.sort((a, b) => b.score - a.score).slice(0, 3);
    if (rankedMemories.length) {
      const usedAt = new Date().toISOString();
      await Promise.all(rankedMemories.map((memory) =>
        recordKnowledgeMemoryUse(memory.id, memory.usageCount, usedAt).catch(() => undefined),
      ));
    }

    const rankedFindings = candidates.filter((item) => item.kind === "past_finding").sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 10)));
    const rankedReferences = candidates.filter((item) => item.kind === "reference").sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 10)));

    const sections = [
      rankedMemories.length
        ? "KNOWLEDGE_BASE_MODEL_MEMORY_V1 (approved, compact, generalized rules; obey scope fields):\n" + rankedMemories.map((item) => JSON.stringify(item.payload)).join("\n")
        : "",
      rankedFindings.length
        ? "PAST_FINDINGS_ARCHIVE_V1 (client-specific saved findings, preserved as-is; examples for retrieval only, never automatically promote them to general rules):\n" + rankedFindings.map((item) => item.text).join("\n")
        : "",
      rankedReferences.length
        ? "REFERENCE_DOCUMENTS_V1 (sourced guidance; respect source metadata):\n" + rankedReferences.map((item) => item.text).join("\n")
        : "",
    ].filter(Boolean);

    return sections.join("\n\n");
  } catch (error) {
    console.warn("[uxaudit] knowledge_retrieval_skipped", error instanceof Error ? error.message : "Knowledge Base unavailable");
    return "";
  }
}
