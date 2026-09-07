import { generateClientReport, getAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function filename(clientName: string) {
  return `${clientName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "client"}-UX-Audit.pdf`;
}

async function exportPdf(audit: any) {
  const token = process.env.BROWSERLESS_API_TOKEN;
  if (!token) throw new Error("Configure BROWSERLESS_API_TOKEN to export the client report as PDF.");
  if (!audit.report_html) throw new Error("Generate the client report before exporting it.");

  const assetUrl = `/api/audit-assets/${encodeURIComponent(audit.id)}`;
  const html = audit.report_html.replaceAll(`src="${assetUrl}"`, `src="${audit.screenshot}"`);
  const endpoint = `${process.env.BROWSERLESS_ENDPOINT || "https://production-sfo.browserless.io"}/pdf?token=${encodeURIComponent(token)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: JSON.stringify({
      html,
      options: {
        printBackground: true,
        width: "1280px",
        height: "720px",
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        preferCSSPageSize: true,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`PDF export service returned HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const auditId = typeof body?.auditId === "string" ? body.auditId : "";
    if (!auditId) return Response.json({ error: "auditId is required." }, { status: 400 });
    const result = await generateClientReport(auditId);
    return Response.json({ auditId: result.auditId, generatedAt: result.generatedAt, reportUrl: `/report/${encodeURIComponent(result.auditId)}` });
  } catch (error) {
    console.error("Client report generation failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not generate the client report." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const auditId = params.get("auditId");
    if (!auditId) return Response.json({ error: "auditId is required." }, { status: 400 });
    const audit = await getAudit(auditId);
    if (!audit) return Response.json({ error: "Audit not found." }, { status: 404 });

    if (params.get("format") === "pdf") {
      const pdf = await exportPdf(audit);
      return new Response(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename(audit.client_name)}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (!audit.report_html) return Response.json({ error: "Client report has not been generated yet." }, { status: 404 });
    return new Response(audit.report_html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Client report request failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the client report." }, { status: 500 });
  }
}
