import { getAudit, listAudits, listClients } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId");
    const auditId = url.searchParams.get("auditId");

    if (auditId) return Response.json({ audit: await getAudit(auditId) }, { headers: { "Cache-Control": "no-store" } });
    if (clientId) return Response.json({ audits: await listAudits(clientId) }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ clients: await listClients() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Knowledge base request failed", error);
    const message = error instanceof Error ? error.message : "Could not load the knowledge base.";
    return Response.json({ error: message }, { status: 500 });
  }
}
