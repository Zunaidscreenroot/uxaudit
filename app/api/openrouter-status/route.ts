export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_CACHE_TTL_MS = 20_000;
let lastVerifiedStatus: { expiresAt: number; payload: { connected: boolean; provider: string; label?: string; checkedAt: string } } | null = null;

function jsonError(error: string, status = 503) {
  return Response.json(
    { connected: false, provider: "OpenRouter", error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!force && lastVerifiedStatus && lastVerifiedStatus.expiresAt > Date.now()) {
    return Response.json(lastVerifiedStatus.payload, { headers: { "Cache-Control": "private, max-age=10" } });
  }
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    return jsonError("OPENROUTER_API_KEY is not configured on the server.");
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
          "OpenRouter rejected OPENROUTER_API_KEY (HTTP 401). The configured key may be invalid, revoked, expired, or copied incorrectly. Replace it with a standard OpenRouter API key in Netlify environment variables for this deploy context, then redeploy. Do not use a Management API key for model inference."
        );
      }
      if (response.status === 403) {
        return jsonError(
          "OpenRouter denied the configured API key (HTTP 403). Check the key and account/workspace access, then redeploy."
        );
      }
      if (response.status === 429) {
        return jsonError(
          "OpenRouter rate-limited the connection check (HTTP 429). Wait briefly and try again."
        );
      }
      return jsonError("OpenRouter key check returned HTTP " + response.status + ".");
    }

    const verified = {
      connected: true,
      provider: "OpenRouter",
      label: typeof payload?.data?.label === "string" ? payload.data.label : undefined,
      checkedAt: new Date().toISOString(),
    };
    lastVerifiedStatus = { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, payload: verified };
    return Response.json(verified, { headers: { "Cache-Control": "private, max-age=10" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not reach OpenRouter.");
  }
}
