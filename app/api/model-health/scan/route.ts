import { freeLLMAPIModelCatalog } from "@/lib/freellmapi";
import { freeLlmApiModel } from "@/lib/freellmapi";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST() {
  const model = freeLlmApiModel();
  const checkedAt = new Date().toISOString();
  try {
    const { response, payload } = await freeLLMAPIModelCatalog();
    if (!response.ok) {
      const candidate = { provider: "FreeLLMAPI", model: model.model, tier: "router", ok: false, latencyMs: 0, promptPrice: null, completionPrice: null, estimatedCostUsd: null, totalTokens: null, error: "FreeLLMAPI catalogue returned HTTP " + response.status + "." };
      return Response.json({
        checkedAt, modelCount: 1, auditCandidateCount: 1, working: [], failed: [candidate], selected: candidate, selectedModels: [candidate],
        verificationRunCostUsd: null, verificationRunTokens: null, verificationActivity: [],
        selectionReason: "The gateway catalogue could not be reached. No inference request was sent.",
        cacheHit: false, cacheTtlMinutes: 0, error: candidate.error,
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const catalog = [
      ...(Array.isArray(payload.data) ? payload.data : []),
      ...(Array.isArray(payload.models) ? payload.models : []),
    ];
    const route = {
      provider: "FreeLLMAPI", model: model.model, tier: "router", ok: false, latencyMs: 0,
      promptPrice: null, completionPrice: null, estimatedCostUsd: null, totalTokens: null,
      status: "configured_not_tested", catalogReachable: true,
    };
    return Response.json({
      checkedAt, modelCount: catalog.length, auditCandidateCount: 1, working: [], failed: [],
      selected: route, selectedModels: [route], verificationRunCostUsd: null, verificationRunTokens: null,
      verificationActivity: [],
      selectionReason: "FreeLLMAPI catalogue is reachable. The configured route is ready for a manual inference test; no tokens were spent by this check.",
      cacheHit: false, cacheTtlMinutes: 0,
      upstreamCatalogCount: catalog.length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach FreeLLMAPI.";
    const candidate = { provider: "FreeLLMAPI", model: model.model, tier: "router", ok: false, latencyMs: 0, promptPrice: null, completionPrice: null, estimatedCostUsd: null, totalTokens: null, error: message };
    return Response.json({
      checkedAt, modelCount: 1, auditCandidateCount: 1, working: [], failed: [candidate], selected: candidate, selectedModels: [candidate],
      verificationRunCostUsd: null, verificationRunTokens: null, verificationActivity: [],
      selectionReason: "No inference request was sent.",
      cacheHit: false, cacheTtlMinutes: 0, error: message,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
