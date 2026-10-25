import { freeLLMAPIChatCompletion, freeLlmApiModel } from "@/lib/freellmapi";
import { inspectImage } from "@/lib/image-utils";
import { privateHost, resolvesToPrivateAddress } from "@/lib/public-url";

export const runtime = "nodejs";
export const maxDuration = 60;

type VerifiedModel = ReturnType<typeof freeLlmApiModel>;
type Pattern = {
  title: string;
  observedPattern: string;
  screenshotEvidence: string;
  userBenefitHypothesis: string;
  ujjivanAdaptation: string;
  targetArea: string;
  priority: "High" | "Medium" | "Explore";
  effort: "Low" | "Medium" | "High";
  validation: string;
  tradeoffs: string;
};
type InsightResult = {
  captureValid: boolean;
  captureReason: string;
  summary: string;
  patterns: Pattern[];
  watchouts: string[];
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1000) : fallback;
}
function priority(value: unknown): Pattern["priority"] {
  return value === "High" || value === "Medium" || value === "Explore" ? value : "Explore";
}
function effort(value: unknown): Pattern["effort"] {
  return value === "Low" || value === "Medium" || value === "High" ? value : "Medium";
}
function parseJson(raw: string): any {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  throw new Error("Benchmark analysis model returned invalid JSON.");
}
function parseScreenshot(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(label + " screenshot is missing.");
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error(label + " screenshot must be a PNG, JPEG, or WebP data URL.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
    throw new Error(label + " screenshot is empty or exceeds 10 MB for side-by-side analysis.");
  }
  const info = inspectImage(bytes);
  return { url: "data:" + info.mimeType + ";base64," + bytes.toString("base64"), bytes: bytes.length };
}

function normalizeResult(raw: any): InsightResult {
  const patterns = Array.isArray(raw?.patterns) ? raw.patterns.slice(0, 5).map((item: any): Pattern => ({
    title: text(item?.title, "Potential pattern to inspect"),
    observedPattern: text(item?.observedPattern),
    screenshotEvidence: text(item?.screenshotEvidence),
    userBenefitHypothesis: text(item?.userBenefitHypothesis),
    ujjivanAdaptation: text(item?.ujjivanAdaptation),
    targetArea: text(item?.targetArea, "Ujjivan homepage / relevant journey"),
    priority: priority(item?.priority),
    effort: effort(item?.effort),
    validation: text(item?.validation),
    tradeoffs: text(item?.tradeoffs, "Validate the pattern against Ujjivan's customer needs and brand.")
  })).filter((item: Pattern) => item.observedPattern && item.screenshotEvidence && item.ujjivanAdaptation) : [];
  return {
    captureValid: raw?.captureValid === true,
    captureReason: text(raw?.captureReason, "The screenshot could not be confidently verified."),
    summary: text(raw?.summary, "Review the screenshot and validate the visible patterns before making a design decision."),
    patterns,
    watchouts: Array.isArray(raw?.watchouts) ? raw.watchouts.filter((x: unknown): x is string => typeof x === "string" && Boolean(x.trim())).slice(0, 5).map((x: string) => x.trim().slice(0, 500)) : []
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const competitorName = text(body?.competitorName, "Competitor bank");
    const baselineName = text(body?.baselineName, "Ujjivan Small Finance Bank");
    let competitorUrl: URL;
    try { competitorUrl = new URL(body?.competitorUrl); }
    catch { return Response.json({ error: "A valid competitor URL is required." }, { status: 400 }); }
    if (!["http:", "https:"].includes(competitorUrl.protocol) || privateHost(competitorUrl.hostname)) {
      return Response.json({ error: "Only public HTTP/HTTPS competitor URLs can be analyzed." }, { status: 400 });
    }
    if (await resolvesToPrivateAddress(competitorUrl.hostname)) {
      return Response.json({ error: "The competitor hostname did not resolve to a verified public address." }, { status: 400 });
    }

    const comparison = parseScreenshot(body?.comparisonScreenshot, "Side-by-side comparison");

    const model: VerifiedModel = freeLlmApiModel();

    const baselineFindings = Array.isArray(body?.baselineFindings)
      ? body.baselineFindings.slice(0, 8).map((f: any) => ({
          category: text(f?.category),
          title: text(f?.title),
          evidence: text(f?.evidence),
          recommendation: text(f?.recommendation)
        }))
      : [];

    const prompt = [
      "You are a senior digital-banking UX benchmark strategist helping redesign " + baselineName + ".",
      "The user wants to learn from competitor experiences and decide what to adapt into the Ujjivan revamp. This task is NOT a competitor usability audit and NOT a scorecard.",
      "A single side-by-side comparison image follows. The baseline homepage is on the LEFT and the competitor homepage is on the RIGHT; both are captured at the same viewport. Use the visible labels to distinguish them.",
      "FIRST verify that both screenshots show the intended real bank homepage rather than an access-denied page, CAPTCHA, browser error, proxy/CDN interstitial, blank/incomplete capture, or unrelated site. If either screenshot is invalid, set captureValid=false, explain why, and return zero patterns. Never infer or fabricate patterns from a blocked page.",
      "If both pages are valid, identify 3–5 concrete and potentially useful interface patterns visible on " + competitorName + " that could inform " + baselineName + "'s revamp. Look for product discovery, IA/navigation, hero/value proposition, task-oriented journeys, product comparison, calculators/filters, applications, trust and proof, contextual CTAs, digital servicing, accessibility, mobile adaptation, useful content structure, and helpful interaction ideas.",
      "Use visual evidence only: name the visible page section/component and describe what the competitor actually does. Distinguish direct observation from a user-benefit hypothesis. Do not say the competitor's design is effective just because it exists; explain why the pattern may help and how to validate it.",
      "For each pattern, show a specific adaptation for Ujjivan, where it belongs in the revamp, priority, effort, risks/trade-offs, and validation method. Tailor to Ujjivan rather than copying brand styles or banking claims. If a pattern is not visible, do not invent it. If fewer than 3 credible patterns exist, return fewer rather than padding.",
      "Ujjivan's current audit findings (use these as context for relevance, not as the sole benchmark rubric): " + JSON.stringify(baselineFindings),
      "Return one JSON object only, schema: {captureValid:boolean,captureReason:string,summary:string,patterns:[{title:string,observedPattern:string,screenshotEvidence:string,userBenefitHypothesis:string,ujjivanAdaptation:string,targetArea:string,priority:'High'|'Medium'|'Explore',effort:'Low'|'Medium'|'High',validation:string,tradeoffs:string}],watchouts:string[]}. No markdown, no invented metrics, no unverified competitor claims."
    ].join("\n\n");

    const completion = await freeLLMAPIChatCompletion({
      model: model.model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "text", text: "Attached image layout: left panel = " + baselineName + " baseline; right panel = " + competitorName + " (" + competitorUrl.origin + "). Each panel has its bank label above the screenshot." },
          { type: "image_url", image_url: { url: comparison.url } }
        ]
      }],
      temperature: 0.1,
      max_tokens: 3000,
      response_format: { type: "json_object" },
      timeoutMs: 30000
    });
    const payload: any = completion.payload;
    const answer = payload?.choices?.[0]?.message?.content;
    const output = typeof answer === "string" ? answer : Array.isArray(answer) ? answer.map((part: any) => part?.text || "").join("") : "";
    if (!output.trim()) throw new Error("Benchmark insights model returned no final text.");
    const normalized = normalizeResult(parseJson(output));
    if (normalized.captureValid && !normalized.patterns.length) {
      normalized.watchouts.push("No actionable pattern was returned. Inspect the screenshots manually rather than treating this as a completed benchmark.");
    }
    return Response.json({ ...normalized, competitorName, competitorUrl: competitorUrl.origin, baselineName, model: payload?.model || model.model }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate benchmark insights.";
    console.error("[uxaudit] benchmark_insights_failed", JSON.stringify({ error: message }));
    return Response.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
