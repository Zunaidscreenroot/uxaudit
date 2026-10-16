export const runtime = "nodejs";
export const maxDuration = 15;

type OpenRouterKeyInfo = {
  label?: string;
  limit?: number | null;
  limit_remaining?: number | null;
  usage?: number;
  is_free_tier?: boolean;
};

export async function GET() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const managementKeyConfigured = Boolean(process.env.OPENROUTER_MANAGEMENT_KEY);
  const budgetRaw = Number(process.env.DAILY_BUDGET_INR ?? "100");
  const dailyBudgetInr = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 100;

  let provider: Record<string, unknown> = {
    connected: false,
    keyConfigured: Boolean(apiKey),
    managementKeyConfigured,
    usageUsd: null,
    limitUsd: null,
    remainingUsd: null,
    freeTier: null,
    error: null,
  };

  if (apiKey) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        provider.error = `OpenRouter key status returned HTTP ${response.status}`;
      } else {
        const data = (payload?.data ?? payload) as OpenRouterKeyInfo;
        provider = {
          connected: true,
          keyConfigured: true,
          managementKeyConfigured,
          label: data.label ?? null,
          usageUsd: typeof data.usage === "number" ? data.usage : null,
          limitUsd: typeof data.limit === "number" ? data.limit : null,
          remainingUsd: typeof data.limit_remaining === "number" ? data.limit_remaining : null,
          freeTier: typeof data.is_free_tier === "boolean" ? data.is_free_tier : null,
          error: null,
        };
      }
    } catch {
      provider.error = "Could not reach OpenRouter key-status API.";
    }
  }

  return Response.json({
    checkedAt: new Date().toISOString(),
    dailyBudgetInr,
    dailySpendInr: null,
    dailyRemainingInr: null,
    dailySpendTracking: "not_available",
    tokenTracking: "not_available",
    provider,
    note: "OpenRouter key usage is provider-reported cumulative usage, not today's audit spend. Per-request token and stage-level cost tracking is not yet persisted, so daily spend and remaining INR budget are intentionally not estimated.",
  }, { headers: { "Cache-Control": "no-store" } });
}
