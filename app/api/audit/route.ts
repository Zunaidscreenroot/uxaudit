import { createAuditFromScreenshot, type AuditStage, type AuditResult } from "@/lib/audit";
import { calibrateMobileMarkers } from "@/lib/mobile-marker-calibration";
import { saveAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILES = 4;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4.2 * 1024 * 1024;

function pageNameFromFilename(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return stem.replace(/\b\w/g, (char) => char.toUpperCase()) || "Page";
}

function setPageIdentity(result: AuditResult, filename: string) {
  const page = result.pages[0];
  if (!page) throw new Error("The audit did not return a page result.");
  page.title = pageNameFromFilename(filename);
  page.url = filename;
  return page;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploaded = formData.getAll("screenshots");
    const legacy = formData.get("screenshot");
    const files = (uploaded.length ? uploaded : legacy ? [legacy] : []).filter((value): value is File => value instanceof File);
    if (!files.length) return Response.json({ error: "Upload at least one screenshot to start the audit." }, { status: 400 });
    if (files.length > MAX_FILES) return Response.json({ error: `Please upload no more than ${MAX_FILES} screenshots per audit run.` }, { status: 400 });

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) return Response.json({ error: "The combined screenshot upload is too large. Keep the total upload under 4 MB." }, { status: 400 });
    for (const file of files) {
      if (!file.type.startsWith("image/")) return Response.json({ error: `${file.name} is not a supported image file.` }, { status: 400 });
      if (file.size > MAX_FILE_BYTES) return Response.json({ error: `${file.name} is too large. Please use a screenshot smaller than 4 MB.` }, { status: 400 });
    }

    const prepared = await Promise.all(files.map(async (file) => ({ file, buffer: Buffer.from(await file.arrayBuffer()) })));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        const stage = (value: AuditStage) => send({ type: "stage", stage: value });
        try {
          send({ type: "start", pageCount: prepared.length });
          const results = await Promise.all(prepared.map(async ({ file, buffer }, index) => {
            const pageName = pageNameFromFilename(file.name);
            stage({ id: "capture", label: "Prepare screenshots", detail: `Preparing ${pageName} (${index + 1} of ${prepared.length}).`, status: "active" });
            const result = await createAuditFromScreenshot(buffer, file.name || pageName, (value) => stage({ ...value, detail: `${pageName}: ${value.detail}` }));
            setPageIdentity(result, file.name);
            stage({ id: "markers", label: "Place evidence markers", detail: `Verifying exact evidence regions for ${pageName}.`, status: "active" });
            const calibrated = process.env.GEMINI_API_KEY
              ? await calibrateMobileMarkers(process.env.GEMINI_API_KEY, result, buffer, file.type)
              : result;
            setPageIdentity(calibrated, file.name);
            return calibrated.pages[0];
          }));

          const clientName = results.find((page) => page.clientName && page.clientName.trim() && page.clientName.trim().toLowerCase() !== "unknown client")?.clientName?.trim() || "Unknown client";
          const normalizedResults: AuditResult = { pages: results.map((page) => ({ ...page, clientName })) };

          // Publish the complete analysis to the browser before the database write.
          // This prevents a slow Supabase write from leaving the user stuck on the
          // final pipeline step without any visible analysis.
          send({ type: "result", result: normalizedResults });
          stage({ id: "complete", label: "Finalise report", detail: "Saving the complete multi-page audit run.", status: "active" });

          const auditId = await saveAudit(normalizedResults, files.map((file) => file.name).join(", "));
          (normalizedResults as AuditResult & { auditId?: string }).auditId = auditId;
          send({ type: "result", result: normalizedResults });
          send({ type: "stage", stage: { id: "complete", label: "Finalise report", detail: `${normalizedResults.pages.length} pages saved as one audit run.`, status: "complete" } });
          controller.close();
        } catch (error) {
          console.error("UX multi-page screenshot audit failed", error);
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
