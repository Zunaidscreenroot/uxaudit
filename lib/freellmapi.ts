export type FreeLLMAPIModel = { provider: "FreeLLMAPI"; model: string; tier: "router" };

function config() {
  const baseUrl = process.env.FREELLMAPI_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.FREELLMAPI_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error("Configure FREELLMAPI_BASE_URL and FREELLMAPI_API_KEY on the UX Audit Worker.");
  }
  return { baseUrl, apiKey };
}

export function freeLlmApiModel(): FreeLLMAPIModel {
  return {
    provider: "FreeLLMAPI",
    model: process.env.FREELLMAPI_MODEL?.trim() || "auto",
    tier: "router",
  };
}

export async function assertFreeLLMAPIModel(modelId: string): Promise<void> {
  const { baseUrl, apiKey } = config();
  const allowed = (process.env.FREELLMAPI_MODELS?.trim() || "auto")
    .split(",").map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(modelId)) {
    throw new Error("The selected FreeLLMAPI route is not in FREELLMAPI_MODELS: " + modelId);
  }
  const response = await fetch(baseUrl + "/models", {
    headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown; name?: unknown }> };
  if (!response.ok) {
    throw new Error("FreeLLMAPI model catalogue returned HTTP " + response.status + ".");
  }
  const ids = [
    ...(Array.isArray(payload.data) ? payload.data : []),
    ...(Array.isArray(payload.models) ? payload.models : []),
  ].flatMap((item) => [item.id, item.name].filter((value): value is string => typeof value === "string"));
  if (!ids.includes(modelId)) {
    throw new Error("The configured FreeLLMAPI model route is not listed by the gateway: " + modelId);
  }
}

export async function freeLLMAPIChatCompletion(input: {
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: "json_object" };
  timeoutMs?: number;
}) {
  const { baseUrl, apiKey } = config();
  const model = input.model || process.env.FREELLMAPI_MODEL?.trim() || "auto";
  const allowed = (process.env.FREELLMAPI_MODELS?.trim() || "auto")
    .split(",").map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(model)) throw new Error("The requested route is not in FREELLMAPI_MODELS: " + model);
  const response = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      ...(input.max_tokens ? { max_tokens: input.max_tokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.response_format ? { response_format: input.response_format } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
  });
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
  catch { throw new Error("FreeLLMAPI returned invalid JSON (HTTP " + response.status + ")."); }
  if (!response.ok) {
    const error = payload.error;
    const detail = typeof error === "string" ? error :
      error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string"
        ? String((error as Record<string, unknown>).message) : "";
    throw new Error("FreeLLMAPI returned HTTP " + response.status + (detail ? ": " + detail.slice(0, 180) : "."));
  }
  return { payload, response };
}
