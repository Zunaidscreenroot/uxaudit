import { freeLLMAPIModelCatalog, freeLlmApiModel } from "@/lib/freellmapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { response, payload } = await freeLLMAPIModelCatalog();
    if (!response.ok) {
      return Response.json({
        connected: false,
        provider: "FreeLLMAPI",
        model: freeLlmApiModel().model,
        error: "FreeLLMAPI model catalogue returned HTTP " + response.status + ".",
        checkedAt: new Date().toISOString(),
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const models = [
      ...(Array.isArray(payload.data) ? payload.data : []),
      ...(Array.isArray(payload.models) ? payload.models : []),
    ];
    return Response.json({
      connected: true,
      provider: "FreeLLMAPI",
      model: freeLlmApiModel().model,
      label: "Configured FreeLLMAPI gateway",
      catalogModelCount: models.length,
      checkedAt: new Date().toISOString(),
      note: "The catalogue is reachable. This check does not run inference or verify that the selected model can process images.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach FreeLLMAPI.";
    return Response.json({
      connected: false,
      provider: "FreeLLMAPI",
      error: message,
      checkedAt: new Date().toISOString(),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
