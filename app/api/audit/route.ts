import { createAuditFromScreenshot, type AuditStage, type AuditResult, type Finding } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

function fallbackEnrichment(finding: Finding): Finding {
  const category = finding.category.toLowerCase();
  let law = "UX Principle";
  let definition = "A practical usability principle used to evaluate how clearly an interface supports the user's goal.";

  if (category.includes("information hierarchy")) {
    law = "Hick's Law";
    definition = "The time and effort needed to make a decision increase as users are presented with more choices or competing actions.";
  } else if (category.includes("navigation")) {
    law = "Jakob's Law";
    definition = "Users expect interfaces to work in familiar ways, so navigation should follow clear, recognizable patterns and labels.";
  } else if (category.includes("usability") || category.includes("interaction")) {
    law = "Fitts's Law";
    definition = "The time required to reach a target depends on its size and distance, making clear, appropriately sized actions easier to use.";
  } else if (category.includes("visual design")) {
    law = "Gestalt Principles";
    definition = "People group and interpret visual elements based on relationships such as proximity, similarity, alignment, and continuity.";
  } else if (category.includes("language") || category.includes("tone")) {
    law = "Plain Language Principle";
    definition = "Interface language should be concise, familiar, specific, and easy to understand at the moment a user needs it.";
  } else if (category.includes("user engagement")) {
    law = "Von Restorff Effect";
    definition = "When several elements compete for attention, a clearly differentiated and prioritized element is more likely to be noticed.";
  } else if (category.includes("responsiveness")) {
    law = "Responsive Design Principle";
    definition = "Interface structure should adapt clearly to the available viewport so content and actions remain usable and understandable.";
  } else if (category.includes("performance")) {
    law = "Perceived Performance";
    definition = "Users judge an experience partly by how quickly and clearly the interface communicates progress and readiness.";
  }

  const section = finding.evidence[0]?.section || finding.category;
  const recommendation = finding.recommendation?.trim();
  const existingAssessment = finding.uxPerspective.assessment?.trim();
  const genericAssessment = !existingAssessment || existingAssessment === "This visible area deserves review based on the supplied screenshot.";

  return {
    ...finding,
    uxPerspective: {
      law: finding.uxPerspective.law && finding.uxPerspective.law !== "UX principle" ? finding.uxPerspective.law : law,
      definition: finding.uxPerspective.definition && finding.uxPerspective.definition !== "A usability principle used to evaluate interface design." ? finding.uxPerspective.definition : definition,
      assessment: genericAssessment
        ? `${finding.description.trim()} The issue is visible in the ${section.toLowerCase()} and should be addressed because it can make the intended user task harder to understand or complete.`
        : existingAssessment,
    },
    screenrootTasks: finding.screenrootTasks.length
      ? finding.screenrootTasks
      : [`Review ${section.toLowerCase()} hierarchy`, recommendation ? recommendation : `Refine the ${section.toLowerCase()} experience`],
    devTasks: finding.devTasks.length
      ? finding.devTasks
      : [recommendation ? `Implement: ${recommendation}` : `Refine the ${section.toLowerCase()} UI behavior and hierarchy`],
  };
}

function applyFallbackEnrichment(result: AuditResult): AuditResult {
  return { ...result, pages: result.pages.map((page) => ({ ...page, findings: page.findings.map(fallbackEnrichment) })) };
}

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
          const rawResult = await createAuditFromScreenshot(buffer, file.name || "uploaded-screenshot", stage);
          const result = applyFallbackEnrichment(rawResult);
          send({ type: "result", result });
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
