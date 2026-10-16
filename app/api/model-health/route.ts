import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

// Explicit allowlist: do not discover/test unrelated models or spend test calls on them.
const OPENROUTER_ALLOWED_MODELS = [
  "nvidia/nemotron-3.5-super-vl:free",
  "dots-studio/dots-3-note-preview:free",
  "nvidia/nemotron-3.5-content-safety:free",
] as const;

const GEMINI_ALLOWED_MODELS = [
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
        { type: "text", text: "Respond with exactly one short JSON object: {\"ok\":true}. This is a model connectivity test. Do not analyze the screenshot." },
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
    if (!preview) throw new Error("Empty response from the selected model.");
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
        { text: "Respond with exactly one short JSON object: {\"ok\":true}. This is a model connectivity test. Do not analyze the screenshot." },
        { inline_data: { mime_type: "image/jpeg", data: image.toString("base64") } },
      ] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 30, temperature: 0 } }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT),
      cache: "no-store",
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof payload?.error?.message === "string" ? payload.error.message : "Provider error"}`);
    const content = (payload?.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
    if (!content) throw new Error("Empty response from the selected model.");
    return { model, provider: "Gemini", configured: true, status: "ok", latencyMs: Date.now() - started, responseModel: model, responsePreview: content.slice(0, 160) };
  } catch (error) {
    return { model, provider: "Gemini", configured: true, status: "error", latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET() {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  return Response.json({
    checkedAt: new Date().toISOString(),
    keys: { openRouter: Boolean(openRouterKey), gemini: Boolean(geminiKey) },
    models: [
      ...OPENROUTER_ALLOWED_MODELS.map((model) => ({ provider: "OpenRouter", model, configured: Boolean(openRouterKey) })),
      ...GEMINI_ALLOWED_MODELS.map((model) => ({ provider: "Gemini", model, configured: Boolean(geminiKey) })),
    ],
    note: "Exactly six allowlisted models are shown. Key configured means credentials exist; a model is confirmed responsive only after Check all models runs a live image-input request.",
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
      for (const model of OPENROUTER_ALLOWED_MODELS) tests.push(testOpenRouter(openRouterKey, model, image));
    } else {
      for (const model of OPENROUTER_ALLOWED_MODELS) tests.push(Promise.resolve({
        model, provider: "OpenRouter", configured: false, status: "error", latencyMs: 0, error: "OPENROUTER_API_KEY is not configured.",
      }));
    }

    if (geminiKey) {
      for (const model of GEMINI_ALLOWED_MODELS) tests.push(testGemini(geminiKey, model, image));
    } else {
      for (const model of GEMINI_ALLOWED_MODELS) tests.push(Promise.resolve({
        model, provider: "Gemini", configured: false, status: "error", latencyMs: 0, error: "GEMINI_API_KEY is not configured.",
      }));
    }

    const results = await Promise.all(tests);
    const ok = results.filter((item) => item.status === "ok").length;
    return Response.json({
      checkedAt: new Date().toISOString(),
      total: results.length,
      ok,
      failed: results.length - ok,
      keys: { openRouter: Boolean(openRouterKey), gemini: Boolean(geminiKey) },
      note: "Only the six explicitly approved models are tested. OpenRouter fallback is disabled so each result represents that exact model.",
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Model health check failed." }, { status: 500 });
  }
}
