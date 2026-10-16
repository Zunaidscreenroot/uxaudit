import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

// Discover actual vision-capable OpenRouter models instead of trusting a static model-name allowlist.
type OpenRouterVisionModel = { id: string; name?: string; architecture?: { input_modalities?: string[] }; pricing?: { prompt?: string; completion?: string } };

async function discoverOpenRouterVisionModels(apiKey: string): Promise<OpenRouterVisionModel[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OpenRouter model discovery returned HTTP ${response.status}`);
  const payload = await response.json();
  const models = Array.isArray(payload?.data) ? payload.data as OpenRouterVisionModel[] : [];
  return models
    .filter((model) => typeof model.id === "string" && model.architecture?.input_modalities?.includes("image"))
    .filter(isAllowedOpenRouterModel)
    .sort((a, b) => {
      const aPrompt = Number(a.pricing?.prompt ?? "0");
      const bPrompt = Number(b.pricing?.prompt ?? "0");
      const aCompletion = Number(a.pricing?.completion ?? "0");
      const bCompletion = Number(b.pricing?.completion ?? "0");
      const aFree = aPrompt === 0 && aCompletion === 0;
      const bFree = bPrompt === 0 && bCompletion === 0;
      if (aFree !== bFree) return aFree ? -1 : 1;
      return (aPrompt + aCompletion) - (bPrompt + bCompletion);
    })
    .slice(0, 3);
}

// Keep only the three OpenRouter models the user explicitly named as allowed.
// Match both the provider model ID and display name because catalog IDs can vary.
function isAllowedOpenRouterModel(model: OpenRouterVisionModel): boolean {
  const identity = `${model.id} ${model.name ?? ""}`.toLowerCase().replace(/[_-]+/g, " ");
  return (
    (identity.includes("nemotron") && identity.includes("super")) ||
    (identity.includes("dots") && identity.includes("node") && identity.includes("preview")) ||
    (identity.includes("nemotron") && identity.includes("content") && identity.includes("safety"))
  );
}

const CONFIGURED_GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

const OPENROUTER_TIMEOUT = 12000;
const GEMINI_TIMEOUT = 12000;

type ModelResult = {
  model: string;
  provider: "OpenRouter" | "Gemini";
  configured: boolean;
  status: "ok" | "error";
  latencyMs: number;
  responseModel?: string;
  responsePreview?: string;
  error?: string;
};

function previewText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 160);
  if (Array.isArray(value)) return value.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").slice(0, 160);
  return "";
}

async function testOpenRouter(apiKey: string, model: string, image: Buffer): Promise<ModelResult> {
  const started = Date.now();
  try {
    const client = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey, timeout: OPENROUTER_TIMEOUT, maxRetries: 0 });
    const response: any = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: [
        { type: "text", text: "Respond with exactly one short JSON object: {\"ok\":true}. You are being tested for image input and text output. Do not analyze the screenshot." },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
      ] }],
      reasoning: { enabled: false },
      max_tokens: 30,
      temperature: 0,
      response_format: { type: "json_object" },
      provider: { allow_fallbacks: false },
    } as any);
    const content = response.choices?.[0]?.message?.content;
    const preview = previewText(content);
    if (!preview) throw new Error("empty response");
    return { model, provider: "OpenRouter", configured: true, status: "ok", latencyMs: Date.now() - started, responseModel: response.model, responsePreview: preview };
  } catch (error) {
    return { model, provider: "OpenRouter", configured: true, status: "error", latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

async function testGemini(apiKey: string, model: string, image: Buffer): Promise<ModelResult> {
  const started = Date.now();
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [
        { text: "Respond with exactly one short JSON object: {\"ok\":true}. You are being tested for image input and text output. Do not analyze the screenshot." },
        { inline_data: { mime_type: "image/jpeg", data: image.toString("base64") } },
      ] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 30, temperature: 0 } }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT),
    });
    const payload: any = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof payload?.error?.message === "string" ? payload.error.message : "provider error"}`);
    const content = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
    if (!content) throw new Error("empty response");
    return { model, provider: "Gemini", configured: true, status: "ok", latencyMs: Date.now() - started, responseModel: model, responsePreview: content.slice(0, 160) };
  } catch (error) {
    return { model, provider: "Gemini", configured: true, status: "error", latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}


export async function GET() {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  let openRouterModels: OpenRouterVisionModel[] = [];
  let discoveryNote = "OpenRouter vision model discovery has not run because the API key is missing.";
  if (openRouterKey) {
    try {
      openRouterModels = await discoverOpenRouterVisionModels(openRouterKey);
      discoveryNote = `Discovered ${openRouterModels.length} image-input OpenRouter models, prioritising free and lower-priced options. Models are not considered connected until screenshot tests pass.`;
    } catch (error) {
      discoveryNote = error instanceof Error ? error.message : "OpenRouter model discovery failed.";
    }
  }
  return Response.json({
    checkedAt: new Date().toISOString(),
    keys: { openRouter: Boolean(openRouterKey), gemini: Boolean(geminiKey) },
    models: [
      ...openRouterModels.map((item) => ({ provider: "OpenRouter", model: item.id, configured: Boolean(openRouterKey) })),
      ...CONFIGURED_GEMINI_MODELS.map((model) => ({ provider: "Gemini", model, configured: Boolean(geminiKey) })),
    ],
    note: `${discoveryNote} Gemini entries show key configuration only until tested with a screenshot.`,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("screenshot");
    if (!(file instanceof File)) return Response.json({ error: "Upload a screenshot first." }, { status: 400 });
    if (!file.type.startsWith("image/")) return Response.json({ error: "Please upload an image screenshot." }, { status: 400 });
    const image = Buffer.from(await file.arrayBuffer());
    if (image.byteLength > 15 * 1024 * 1024) return Response.json({ error: "Screenshot must be under 15 MB." }, { status: 400 });

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    const tests: Promise<ModelResult>[] = [];
    if (openRouterKey) {
      try {
        const discovered = await discoverOpenRouterVisionModels(openRouterKey);
        for (const item of discovered) tests.push(testOpenRouter(openRouterKey, item.id, image));
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not discover OpenRouter vision models." }, { status: 502 });
      }
    }
    if (geminiKey) {
      for (const model of CONFIGURED_GEMINI_MODELS) tests.push(testGemini(geminiKey, model, image));
    }

    const results = await Promise.all(tests);
    const ok = results.filter((item) => item.status === "ok").length;
    const failed = results.length - ok;
    return Response.json({
      checkedAt: new Date().toISOString(),
      total: results.length,
      ok,
      failed,
      keys: { openRouter: Boolean(openRouterKey), gemini: Boolean(geminiKey) },
      note: "OpenRouter vision models are discovered live and sorted free-first, then by published prompt/completion pricing. Tests use allow_fallbacks=false; a passing result comes from the specific listed model.",
      results,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Model health check failed." }, { status: 500 });
  }
}
