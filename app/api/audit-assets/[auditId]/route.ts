import { getAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: { auditId: string } }) {
  try {
    const audit = await getAudit(context.params.auditId);
    if (!audit?.screenshot) return new Response("Not found", { status: 404 });
    const match = audit.screenshot.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return new Response("Invalid screenshot", { status: 500 });
    return new Response(Buffer.from(match[2], "base64"), {
      status: 200,
      headers: { "Content-Type": match[1], "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    console.error("Audit asset request failed", error);
    return new Response("Could not load screenshot", { status: 500 });
  }
}
