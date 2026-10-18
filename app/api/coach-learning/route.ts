import { listApprovedCoachLearnings } from "@/lib/coach-learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 100);
    const lessons = await listApprovedCoachLearnings(requestedLimit);
    return Response.json(
      {
        lessons,
        activeCount: lessons.length,
        policy: "Only approved lessons are used to calibrate future audits. Raw coaching transcripts are not returned by this read-only endpoint.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Coach learning request failed", error);
    const message = error instanceof Error ? error.message : "Could not load approved coaching lessons.";
    return Response.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
