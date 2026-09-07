import { createAuditFromScreenshot, type AuditStage } from "@/lib/audit";
import { calibrateMobileMarkers } from "@/lib/mobile-marker-calibration";
import { saveAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("screenshot");
    if (!(file instanceof File)) return Response.json({ error: "Upload a screenshot to start the audit." }, { status: 400 });
    if (!file.type.startsWith("image/")) return Response.json({ error: "Please upload a PNG, JPG, JPEG, or WebP screenshot." }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return Response.json({ error: "Screenshot is too large. Please upload an image smaller than 15 MB." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        const stage = (value: AuditStage) => send({ type: "stage", stage: value });
        try {
          send({ type: "start" });
          const result = await createAuditFromScreenshot(buffer, file.name || "uploaded-screenshot", stage);
          const calibratedResult = process.env.GEMINI_API_KEY
            ? await calibrateMobileMarkers(process.env.GEMINI_API_KEY, result, buffer, file.type)
            : result;
          const auditId = await saveAudit(calibratedResult, file.name || "uploaded-screenshot");
          calibratedResult.pages = calibratedResult.pages.map((page) => ({ ...page, id: auditId, createdAt: new Date().toISOString() }));
          send({ type: "result", result: calibratedResult });
          controller.close();
        } catch (error) {
          console.error("UX screenshot audit failed", error);
          const message = error instanceof Error ? error.message : "Unknown audit error.";
          send({ type: "error", error: `The audit could not be completed: ${message}` });
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    console.error("UX screenshot audit request failed", error);
    const message = error instanceof Error ? error.message : "Unknown audit error.";
    return Response.json({ error: `The audit could not be completed: ${message}` }, { status: 500 });
  }
}
