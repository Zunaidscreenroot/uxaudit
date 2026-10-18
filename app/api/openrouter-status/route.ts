import { getRuntimeEnv } from "@/lib/neon-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 503) {
  return Response.json(
    { connected: false, provider: "OpenRouter", error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  const key = getRuntimeEnv().OPENROUTER_API_KEY?.trim();
  if (!key) {
    return jsonError("OPENROUTER_API_KEY is not configured as a Cloudflare Worker secret for this environment.");
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: "Bearer " + key },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        return jsonError(
          "OpenRouter rejected OPENROUTER_API_KEY (HTTP 401). The configured key may be invalid, revoked, expired, or copied incorrectly. Configure a valid standard OpenRouter API key as a secret in the Cloudflare Preview environment, then redeploy. Do not use a Management API key for model inference."
        );
      }
      if (response.status === 403) {
        return jsonError(
          "OpenRouter denied the configured API key (HTTP 403). Check the key and account/workspace access in Cloudflare Preview secrets, then redeploy."
        );
      }
      if (response.status === 429) {
        return jsonError(
          "OpenRouter rate-limited the connection check (HTTP 429). Wait briefly and try again."
        );
      }
      return jsonError("OpenRouter key check returned HTTP " + response.status + ".");
    }

    return Response.json(
      {
        connected: true,
        provider: "OpenRouter",
        label: typeof payload?.data?.label === "string" ? payload.data.label : undefined,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not reach OpenRouter.");
  }
}
