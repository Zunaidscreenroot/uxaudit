import { freeLLMAPIChatCompletion, freeLLMAPIModelCatalog, freeLlmApiModel } from "@/lib/freellmapi";

export const runtime = "nodejs";
export const maxDuration = 30;

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => item && typeof item === "object" && "text" in item ? String((item as {text:unknown}).text ?? "") : "").join("");
  return "";
}

export async function GET() {
  const model = freeLlmApiModel();
  try {
    const { response, payload } = await freeLLMAPIModelCatalog();
    const models = [...(Array.isArray(payload.data) ? payload.data : []), ...(Array.isArray(payload.models) ? payload.models : [])];
    return Response.json({
      checkedAt: new Date().toISOString(),
      keys: { freeLlmApi: true },
      providers: { freeLlmApi: { connected: response.ok, error: response.ok ? null : "FreeLLMAPI catalogue HTTP " + response.status } },
      models: [{ provider: "FreeLLMAPI", model: model.model, tier: "router", configured: true, providerConnected: response.ok, listed: models.some((entry) => entry && typeof entry === "object" && ((entry as {id?:unknown}).id === model.model || (entry as {name?:unknown}).name === model.model)), status: response.ok ? "configured_not_tested" : "connection_error", contextLength: null, inputModalities: null, pricingPerMillion: null }],
      note: "This check reads the FreeLLMAPI model catalogue only. Use the explicit Verify action to make an inference request.",
    }, { status: response.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      checkedAt: new Date().toISOString(), keys: { freeLlmApi: false },
      providers: { freeLlmApi: { connected: false, error: error instanceof Error ? error.message : "Could not reach FreeLLMAPI." } },
      models: [{ provider: "FreeLLMAPI", model: model.model, tier: "router", configured: false, providerConnected: false, listed: false, status: "key_missing", contextLength: null, inputModalities: null, pricingPerMillion: null }],
      note: "Configure FREELLMAPI_BASE_URL and FREELLMAPI_API_KEY.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const model = freeLlmApiModel();
    if (body?.provider !== "FreeLLMAPI" || body?.model !== model.model) {
      return Response.json({ error: "Choose the configured FreeLLMAPI route before testing." }, { status: 400 });
    }
    const started = Date.now();
    const completion = await freeLLMAPIChatCompletion({
      model: model.model,
      messages: [{ role: "user", content: "Reply with exactly OK." }],
      max_tokens: 8,
      temperature: 0,
      timeoutMs: 20000,
    });
    const choice = (completion.payload as any)?.choices?.[0];
    const answer = extractText(choice?.message?.content);
    const usage = (completion.payload as any)?.usage ?? {};
    const ok = answer.trim().length > 0;
    return Response.json({
      model: (completion.payload as any)?.model || model.model,
      provider: "FreeLLMAPI",
      status: ok ? "connected" : "no_response",
      latencyMs: Date.now() - started,
      responsePreview: answer.slice(0, 80),
      usage: {
        promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
        completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
        totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
        costUsd: typeof usage.cost === "number" ? usage.cost : null,
      },
      note: "One small inference request was sent intentionally. Cost is unknown unless the gateway returned cost metadata.",
    }, { status: ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "FreeLLMAPI verification failed." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
