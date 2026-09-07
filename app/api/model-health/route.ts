import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONFIGURED_OPENROUTER_MODELS = [
  "google/gemma-4-31b-it:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-26b-a4b-it:free",
  "sourceful/Sourceful-MultiModal:free",
  "xiaomi/mimo-v2-omni:free",
  "allenai/molmo-2-8b:free",
  "google/gemma-3-27b-it:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "google/gemma-3-12b-it:free",
  "qwen/qwen3-vl-235b-a22b-thinking:free",
  "qwen/qwen3-vl-235b-a22b-instruct:free",
] as const;

const CONFIGURED_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

const OPENROUTER_TIMEOUT = 12000;
const GEMINI_TIMEOUT = 12000;
const MAX_DISCOVERED = 40;

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

async function discoverFreeMultimodalModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [...CONFIGURED_OPENROUTER_MODELS];
    const payload: any = await response.json();
    const discovered = Array.isArray(payload?.data)
      ? payload.data.filter((model: any) => {
          const id = typeof model?.id === "string" ? model.id : "";
          const inputs = model?.architecture?.input_modalities;
          const outputs = model?.architecture?.output_modalities;
          const pricing = model?.pricing;
          const imageInput = Array.isArray(inputs) && inputs.includes("image");
          const textOutput = !Array.isArray(outputs) || outputs.includes("text");
          const free = id.endsWith(":free") || (pricing && Number(pricing.prompt) === 0 && Number(pricing.completion) === 0);
          return id && imageInput && textOutput && free;
        }).map((model: any) => String(model.id))
      : [];
    return Array.from(new Set([...CONFIGURED_OPENROUTER_MODELS, ...discovered])).slice(0, MAX_DISCOVERED);
  } catch {
    return [...CONFIGURED_OPENROUTER_MODELS];
  }
}

function previewText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 160);
  if (Array.isArray(value)) return value.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").slice(0, 160);
  return "";
}

async function testOpenRouter(apiKey: string, model: string, image: Buffer, configured: boolean): Promise<ModelResult> {
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
    });
    const content = response.choices?.[0]?.message?.content;
    const preview = previewText(content);
    if (!preview) throw new Error("empty response");
    return { model, provider: "OpenRouter", configured, status: "ok", latencyMs: Date.now() - started, responseModel: response.model, responsePreview: preview };
  } catch (error) {
    return { model, provider: "OpenRouter", configured, status: "error", latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
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
    const openRouterModels = openRouterKey ? await discoverFreeMultimodalModels(openRouterKey) : [];

    const tests: Promise<ModelResult>[] = [];
    if (openRouterKey) {
      for (const model of openRouterModels) tests.push(testOpenRouter(openRouterKey, model, image, CONFIGURED_OPENROUTER_MODELS.includes(model as any)));
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
      note: "OpenRouter tests use allow_fallbacks=false, so each listed model is tested directly. This isolates model availability from OpenRouter provider fallback routing.",
      results,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Model health check failed." }, { status: 500 });
  }
}
