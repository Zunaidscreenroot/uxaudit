import { createAudit, type AuditStage } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let rawUrl = "";
  try {
    const body = await request.json();
    rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
    if (!rawUrl) return Response.json({ error: "Enter a website URL." }, { status: 400 });
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let parsed: URL;
    try { parsed = new URL(normalizedUrl); } catch { return Response.json({ error: "Enter a valid website URL, for example https://example.com" }, { status: 400 }); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return Response.json({ error: "Use an HTTP or HTTPS website URL." }, { status: 400 });
    if (!parsed.hostname || !parsed.hostname.includes(".")) return Response.json({ error: "Enter a valid website URL, for example https://example.com" }, { status: 400 });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        const stage = (value: AuditStage) => send({ type: "stage", stage: value });
        try {
          send({ type: "start" });
          const result = await createAudit(parsed.toString(), stage);
          send({ type: "result", result });
          controller.close();
        } catch (error) {
          console.error("UX audit failed", error);
          const message = error instanceof Error ? error.message : "Unknown audit error.";
          send({ type: "error", error: `The audit could not be completed: ${message}` });
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    console.error("UX audit request failed", error);
    const message = error instanceof Error ? error.message : "Unknown audit error.";
    return Response.json({ error: `The audit could not be completed: ${message}` }, { status: 500 });
  }
}
