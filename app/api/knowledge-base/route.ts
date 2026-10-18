import { timingSafeEqual } from "node:crypto";
import { listApprovedKnowledgeMemoryForExport } from "@/lib/knowledge-memory";
import { listFindingsForTraining } from "@/lib/past-findings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request, expected: string): boolean {
  const authorization = request.headers.get("authorization") || "";
  const supplied = /^Bearer\s+/i.test(authorization) ? authorization.replace(/^Bearer\s+/i, "").trim() : "";
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

function jsonlResponse(dataset: string, rows: unknown[]) {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  return new Response(body ? body + "\n" : "", {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="knowledge-base-${dataset}.jsonl"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const expectedToken = process.env.KNOWLEDGE_BASE_EXPORT_TOKEN?.trim();
  if (!expectedToken) {
    return Response.json(
      { error: "Knowledge Base export is disabled. Configure KNOWLEDGE_BASE_EXPORT_TOKEN on the server." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isAuthorized(request, expectedToken)) {
    return Response.json({ error: "A valid Knowledge Base export token is required." }, {
      status: 401,
      headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" },
    });
  }

  const url = new URL(request.url);
  const dataset = url.searchParams.get("dataset") || "learnings";
  const format = url.searchParams.get("format") || "jsonl";
  const requestedLimit = Number(url.searchParams.get("limit") || 1000);
  const limit = Math.max(1, Math.min(2000, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 1000));
  if (format !== "jsonl") return Response.json({ error: "Only JSONL export is supported." }, { status: 400 });
  if (dataset !== "learnings" && dataset !== "past-findings") {
    return Response.json({ error: "dataset must be learnings or past-findings." }, { status: 400 });
  }

  try {
    if (dataset === "learnings") {
      const memories = await listApprovedKnowledgeMemoryForExport(limit);
      const examples = memories
        .filter((memory) => memory.raw_feedback && memory.model_payload)
        .map((memory) => ({
          messages: [
            {
              role: "system",
              content: "Convert UX audit feedback into one compact version-1 Knowledge Base JSON object. Output valid JSON only, with keys v (1), k (correction kind), s (normalized scope), r (actionable rule), kw (keywords), ex (short calibration examples), and lang (source language). Do not invent page evidence or treat a historical client finding as a universal rule.",
            },
            { role: "user", content: memory.raw_feedback || "" },
            { role: "assistant", content: JSON.stringify(memory.model_payload) },
          ],
        }));
      return jsonlResponse("learnings", examples);
    }

    const findings = await listFindingsForTraining(limit);
    const examples = findings.map((row: any) => ({
      schema_version: 1,
      record_type: "past_finding",
      source: {
        finding_id: row.id,
        audit_id: row.audit_id,
        client: row.audits?.client_name || "unknown",
        audit_title: row.audits?.title || "untitled",
        audit_created_at: row.audits?.created_at || row.created_at || null,
        view_mode: row.audit_pages?.view_mode || row.audits?.view_mode || "unknown",
        page_title: row.audit_pages?.title || row.audit_pages?.page_name || null,
        source_filename: row.audit_pages?.source_filename || null,
      },
      finding: row.finding,
    }));
    return jsonlResponse("past-findings", examples);
  } catch (error) {
    console.error("Knowledge Base export failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Knowledge Base export failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
