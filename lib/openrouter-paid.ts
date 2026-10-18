type OpenRouterPrice = { prompt: number; completion: number };

let paidModelCatalogCache: { expiresAt: number; entries: Map<string, OpenRouterPrice> } | null = null;
let paidModelCatalogPending: Promise<Map<string, OpenRouterPrice>> | null = null;

/** Server-side pricing verification; never trust a client-supplied "paid" label. */
export async function assertPaidOpenRouterModel(modelId: string): Promise<void> {
  const model = modelId.trim();
  if (!model || model.endsWith(":free") || model === "openrouter/auto") {
    throw new Error("An explicit paid OpenRouter model is required; free models and automatic routing are disabled for paid workloads.");
  }

  const cacheValid = paidModelCatalogCache && paidModelCatalogCache.expiresAt > Date.now();
  let catalogue: Map<string, OpenRouterPrice>;
  if (cacheValid) {
    catalogue = paidModelCatalogCache!.entries;
  } else if (paidModelCatalogPending) {
    catalogue = await paidModelCatalogPending;
  } else {
    paidModelCatalogPending = (async () => {
      const key = process.env.OPENROUTER_API_KEY?.trim();
      if (!key) throw new Error("Configure OPENROUTER_API_KEY before running a paid model task.");
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: "Bearer " + key },
        signal: AbortSignal.timeout(7000),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as {
        data?: Array<{ id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }>;
      };
      if (!response.ok || !Array.isArray(payload.data)) {
        throw new Error("Could not verify paid-model pricing from OpenRouter.");
      }
      const entries = new Map<string, OpenRouterPrice>();
      for (const item of payload.data) {
        if (typeof item.id !== "string") continue;
        entries.set(item.id, {
          prompt: Number(item.pricing?.prompt ?? 0),
          completion: Number(item.pricing?.completion ?? 0),
        });
      }
      paidModelCatalogCache = { expiresAt: Date.now() + 15 * 60 * 1000, entries };
      return entries;
    })();
    try {
      catalogue = await paidModelCatalogPending;
    } finally {
      paidModelCatalogPending = null;
    }
  }

  const price = catalogue.get(model);
  if (!price) throw new Error("Selected model is not present in the current OpenRouter catalogue: " + model);
  if (!(price.prompt > 0 || price.completion > 0)) {
    throw new Error("Selected model has zero-priced inference and cannot be used for paid audit workloads.");
  }
}
