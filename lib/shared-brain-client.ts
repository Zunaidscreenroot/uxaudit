import { getCloudflareContext } from "@opennextjs/cloudflare";

type SharedBrainEnv = {
  UX_SHARED_BRAIN_URL?: string;
  UX_DIRECT_BRAIN_API_KEY?: string;
};

function readBrainSetting(name: keyof SharedBrainEnv): string {
  try {
    const context = getCloudflareContext();
    const value = (context.env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // Local development may use process.env instead of a Worker request context.
  }
  const localValue = process.env[name];
  return typeof localValue === "string" ? localValue.trim() : "";
}

export async function requestSharedBrain<T = Record<string, unknown>>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const baseUrl = readBrainSetting("UX_SHARED_BRAIN_URL").replace(/\/+$/, "");
  const apiKey = readBrainSetting("UX_DIRECT_BRAIN_API_KEY");
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error("UX_SHARED_BRAIN_URL is not configured for this Worker.");
  }
  if (apiKey.length < 32) {
    throw new Error("UX_DIRECT_BRAIN_API_KEY is not configured for this Worker.");
  }
  const safePath = path.replace(/^\/+/, "");
  const response = await fetch(`${baseUrl}/${safePath}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });
  const raw = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `Shared brain returned HTTP ${response.status}.`;
    throw new Error(message.slice(0, 500));
  }
  return data as T;
}

export type SharedBrainRetrieval = {
  contextText: string;
  retrieval?: {
    status?: "complete" | "empty" | "degraded";
    memoryCount?: number;
    knowledgeChunkCount?: number;
  };
};

export async function retrieveSharedBrainContext(
  query: string,
  scopeKeys: string[] = ["UX_SHARED_BRAIN", "indian-bfsi", "project:ux-audit"],
  limit = 6,
): Promise<SharedBrainRetrieval> {
  return requestSharedBrain<SharedBrainRetrieval>("api/brain/retrieve", {
    query: query.slice(0, 8000),
    scopeKeys: [...new Set(scopeKeys)].slice(0, 8),
    limit: Math.max(1, Math.min(12, Math.floor(limit))),
    maxChars: 3200,
    includeKnowledge: true,
  });
}
