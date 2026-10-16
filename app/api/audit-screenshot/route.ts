import { createAuditFromScreenshot } from "@/lib/audit";
import { saveAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const maxDuration = 60;

type Model = { provider: "OpenRouter"; model: string; tier: "paid" };
type AuditMode = "desktop" | "mobile";

function event(controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) {
  controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(payload) + "\n\n"));
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid audit request." }, { status: 400 });
  }

  // The upload flow audits the attached image directly. URL-based page audits
  // may also call this route, so keep both inputs supported.
  const isUpload = body?.source === "upload";
  let sourceUrl: URL | null = null;
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";

  if (!isUpload) {
    try {
      sourceUrl = new URL(rawUrl);
    } catch {
      return Response.json({ error: "A valid page URL is required for a website screenshot." }, { status: 400 });
    }
    if (!["http:", "https:"].includes(sourceUrl.protocol)) {
      return Response.json({ error: "Only HTTP/HTTPS page URLs are supported." }, { status: 400 });
    }
  }

  const match = typeof body?.screenshot === "string"
    ? body.screenshot.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
    : null;
  if (!match) {
    return Response.json({ error: "Upload a valid PNG, JPEG or WebP screenshot before starting the AI audit." }, { status: 400 });
  }

  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
    return Response.json({ error: "Screenshot is empty or too large. Upload an image under 15 MB." }, { status: 400 });
  }

  const auditMode: AuditMode = body.auditMode === "mobile" ? "mobile" : "desktop";
  const viewportWidth = auditMode === "mobile" ? 393 : 1440;
  const viewportHeight = auditMode === "mobile" ? 852 : undefined;
  const uploadedTitle = typeof body.title === "string" ? body.title.trim() : "";
  const title = uploadedTitle || (sourceUrl
    ? (sourceUrl.pathname === "/" ? "Homepage" : sourceUrl.pathname.split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ") || sourceUrl.hostname)
    : "Uploaded screenshot");
  const project = typeof body.projectName === "string" && body.projectName.trim()
    ? body.projectName.trim()
    : (sourceUrl?.hostname || "Screenshot audit");
  const models: Model[] = [{ provider: "OpenRouter", model: "openrouter/auto", tier: "paid" }];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Keep long vision/reasoning requests alive through the Netlify streaming proxy.
      const heartbeat = setInterval(() => {
        try { event(controller, { type: "heartbeat", at: new Date().toISOString() }); } catch {}
      }, 5000);
      void (async () => {
        try {
          console.info("[uxaudit] screenshot_audit_start", JSON.stringify({
            source: isUpload ? "uploaded_screenshot" : "website_page",
            host: sourceUrl?.hostname ?? null,
            models: models.map((model) => model.model),
            screenshotBytes: bytes.length,
            auditMode,
          }));

          event(controller, {
            type: "stage",
            stage: {
              id: "model",
              label: "OpenRouter AI routing",
              detail: "The actual image is sent to OpenRouter Auto Router, which selects a suitable vision model and falls back when available.",
              status: "complete",
            },
          });
          event(controller, {
            type: "stage",
            stage: {
              id: "model-run",
              label: isUpload ? "Analyse uploaded screenshot" : "Analyse captured website screenshot",
              detail: "The AI is inspecting visible interface elements, hierarchy, content, controls and evidence in the supplied image.",
              status: "active",
            },
          });

          const result = await createAuditFromScreenshot(
            bytes,
            title + ".jpg",
            (stage) => event(controller, { type: "stage", stage }),
            models,
            auditMode,
          );

          result.pages = result.pages.map((page) => ({
            ...page,
            clientName: project,
            url: sourceUrl?.href || "Uploaded screenshot",
            title,
            createdAt: new Date().toISOString(),
            auditMode,
            viewportWidth,
            viewportHeight,
          }));

          // Deliver the analysis immediately; database persistence is a separate concern.
          // If Supabase is slow or unavailable, the user should still receive the generated findings.
          event(controller, { type: "result", payload: { page: result.pages[0] } });
          console.info("[uxaudit] screenshot_analysis_ok", JSON.stringify({
            source: isUpload ? "uploaded_screenshot" : "website_page",
            findingCount: result.pages[0]?.findings?.length ?? 0,
          }));

          event(controller, {
            type: "stage",
            stage: {
              id: "save",
              label: "Save audit report",
              detail: "Saving the screenshot evidence and AI findings to the audit knowledge base.",
              status: "active",
            },
          });

          const sourceLabel = isUpload ? "Screenshot upload" : "URL audit";
          try {
            const auditId = await saveAudit(result, sourceLabel + " · " + project + " · " + title);
            event(controller, {
              type: "saved",
              auditId,
            });
            event(controller, {
              type: "stage",
              stage: {
                id: "save",
                label: "Save audit report",
                detail: "Audit report saved successfully.",
                status: "complete",
              },
            });
            console.info("[uxaudit] screenshot_audit_saved", JSON.stringify({
              source: isUpload ? "uploaded_screenshot" : "website_page",
              auditId,
            }));
          } catch (saveError) {
            const saveMessage = saveError instanceof Error ? saveError.message : "Unknown knowledge-base error.";
            console.error("[uxaudit] screenshot_audit_save_failed", JSON.stringify({ error: saveMessage }));
            event(controller, {
              type: "warning",
              warning: "AI analysis completed, but saving to the knowledge base failed: " + saveMessage,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "AI screenshot audit failed.";
          console.error("[uxaudit] screenshot_audit_failed", JSON.stringify({ error: message }));
          event(controller, { type: "error", error: message });
        } finally {
          clearInterval(heartbeat);
          try { controller.close(); } catch {}
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
