import { freeLLMAPIChatCompletion, freeLlmApiModel } from "@/lib/freellmapi";

export const runtime = "nodejs";
export const maxDuration = 30;

let lastVerification: { expiresAt: number; payload: any } | null = null;

export async function GET() {
  if (lastVerification && lastVerification.expiresAt > Date.now()) {
    return Response.json({ ...lastVerification.payload, cacheHit: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const model = freeLlmApiModel();
  return Response.json({
    checkedAt: new Date().toISOString(),
    models: [{ model: model.model, label: "FreeLLMAPI Auto", ok: false, status: "not_tested", latencyMs: 0, totalTokens: null, costUsd: null, promptPrice: null, completionPrice: null }],
    selectedModel: null,
    fallbackModels: [],
    verificationRunCostUsd: null,
    verificationRunTokens: null,
    selectionReason: "No inference test has been run. Use Verify now to send one small test request. Upstream selection is managed by FreeLLMAPI.",
    cacheHit: false,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const model = freeLlmApiModel();
  const started = Date.now();
  try {
    const result = await freeLLMAPIChatCompletion({
      model: model.model,
      messages: [{ role: "user", content: "Reply with exactly OK. Do not explain." }],
      max_tokens: 8,
      temperature: 0,
      timeoutMs: 20000,
    });
    const payload = result.payload as any;
    const raw = payload?.choices?.[0]?.message?.content;
    const answer = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((item: any) => typeof item === "string" ? item : item?.text ?? "").join("") : "";
    const usage = payload?.usage ?? {};
    const modelResult = {
      model: typeof payload?.model === "string" ? payload.model : model.model,
      label: "FreeLLMAPI Auto",
      ok: Boolean(answer.trim()),
      status: answer.trim() ? "verified" : "no_response",
      latencyMs: Date.now() - started,
      totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
      promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
      costUsd: typeof usage.cost === "number" ? usage.cost : null,
      promptPrice: null,
      completionPrice: null,
      responsePreview: answer.slice(0, 80),
    };
    const data = {
      checkedAt: new Date().toISOString(),
      models: [modelResult],
      selectedModel: modelResult.ok ? modelResult : null,
      fallbackModels: [],
      verificationRunCostUsd: modelResult.costUsd,
      verificationRunTokens: modelResult.totalTokens,
      selectionReason: modelResult.ok
        ? "FreeLLMAPI Auto returned a visible response. The selected upstream model is shown when supplied by the gateway; cost is known only if usage.cost was returned."
        : "The gateway returned no visible response. Check its routing profile and model logs.",
      cacheHit: false,
      note: "This test deliberately sends one short inference request. It may incur upstream usage. No screenshot or client content was sent.",
    };
    lastVerification = { expiresAt: Date.now() + 5 * 60 * 1000, payload: data };
    return Response.json(data, { status: modelResult.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const data = {
      checkedAt: new Date().toISOString(),
      models: [{ model: model.model, label: "FreeLLMAPI Auto", ok: false, status: "failed", latencyMs: Date.now() - started, totalTokens: null, costUsd: null, promptPrice: null, completionPrice: null, error: error instanceof Error ? error.message : "FreeLLMAPI test failed." }],
      selectedModel: null,
      fallbackModels: [],
      verificationRunCostUsd: null,
      verificationRunTokens: null,
      selectionReason: "FreeLLMAPI inference failed. Check endpoint, key, model alias and upstream gateway logs.",
      cacheHit: false,
    };
    lastVerification = { expiresAt: Date.now() + 60 * 1000, payload: data };
    return Response.json(data, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
