import { freeLLMAPIModelCatalog, freeLlmApiModel } from "@/lib/freellmapi";

export const runtime = "nodejs";
export const maxDuration = 12;

export async function GET() {
  const rawBudget = Number(process.env.DAILY_BUDGET_INR ?? "100");
  const dailyBudgetInr = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 100;
  const model = freeLlmApiModel();
  let connected = false;
  let error: string | null = null;
  try {
    const { response } = await freeLLMAPIModelCatalog();
    connected = response.ok;
    if (!response.ok) error = "FreeLLMAPI catalogue returned HTTP " + response.status + ".";
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Could not reach FreeLLMAPI.";
  }
  const provider = {
    connected,
    keyConfigured: Boolean(process.env.FREELLMAPI_API_KEY && process.env.FREELLMAPI_BASE_URL),
    managementKeyConfigured: false,
    model: model.model,
    usageUsd: null,
    usageDailyUsd: null,
    usageWeeklyUsd: null,
    usageMonthlyUsd: null,
    limitUsd: null,
    remainingUsd: null,
    freeTier: null,
    creditsUsd: null,
    creditsUsedUsd: null,
    activity: [],
    activityError: "FreeLLMAPI does not expose provider-account credits/activity through the OpenAI-compatible API used here.",
    creditsError: "Credit balance is unavailable from the configured FreeLLMAPI API.",
    error,
  };
  return Response.json({
    checkedAt: new Date().toISOString(),
    dailyBudgetInr,
    dailySpendInr: null,
    dailyRemainingInr: null,
    dailySpendTracking: "not_available",
    tokenTracking: "per_response_when_returned",
    provider,
    note: "The local daily budget is a limit setting, not a spend measurement. FreeLLMAPI upstream spend and credits remain unknown unless its gateway returns per-request cost metadata or a separate verified usage ledger is configured.",
  }, { headers: { "Cache-Control": "no-store" } });
}
