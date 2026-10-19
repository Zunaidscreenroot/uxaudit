import { assertPaidOpenRouterModel } from "@/lib/openrouter-paid";
import { inspectImage } from "@/lib/image-utils";
import sharp from "sharp";
import { privateHost, resolvesToPrivateAddress } from "@/lib/public-url";

export const runtime = "nodejs";
export const maxDuration = 60;

type VerifiedModel = { provider: "OpenRouter"; model: string; tier: "paid" };
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
  return { bytes, mimeType: info.mimeType, width: info.width, height: info.height };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function composeBenchmarkImage(
  baseline: { bytes: Buffer; width: number; height: number },
  competitor: { bytes: Buffer; width: number; height: number },
  baselineName: string,
  competitorName: string
): Promise<string> {
  // Some vision providers accept one image part per request. Merge the same-viewport screenshots
  // into a single labelled image so the comparison remains visual while staying provider-compatible.
  const panelWidth = Math.min(960, Math.max(baseline.width, competitor.width));
  const maxPanelHeight = 4200;
  const labelHeight = 68;
  const [left, right] = await Promise.all([
    sharp(baseline.bytes).rotate().resize({ width: panelWidth, height: maxPanelHeight, fit: "inside", withoutEnlargement: true }).png().toBuffer(),
    sharp(competitor.bytes).rotate().resize({ width: panelWidth, height: maxPanelHeight, fit: "inside", withoutEnlargement: true }).png().toBuffer()
  ]);
  const [leftMeta, rightMeta] = await Promise.all([sharp(left).metadata(), sharp(right).metadata()]);
  const panelHeight = Math.max(leftMeta.height || 1, rightMeta.height || 1);
  const canvasWidth = panelWidth * 2;
  const canvasHeight = labelHeight + panelHeight;
  const label = (text: string) => Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + panelWidth + '" height="' + labelHeight + '">' +
    '<rect width="100%" height="100%" fill="#f0f3f7"/>' +
    '<text x="18" y="42" font-family="Arial,Helvetica,sans-serif" font-size="21" font-weight="700" fill="#1f2937">' +
    escapeXml(text.slice(0, 72)) + '</text></svg>'
  );
  const composite = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  }).composite([
    { input: label("BASELINE · " + baselineName), left: 0, top: 0 },
    { input: label("COMPETITOR · " + competitorName), left: panelWidth, top: 0 },
    { input: left, left: 0, top: labelHeight },
    { input: right, left: panelWidth, top: labelHeight }
  ]);
  const output = await composite.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  if (!output.length || output.length > 15 * 1024 * 1024) {
    throw new Error("The combined comparison image exceeds the 15 MB analysis limit.");
  }
  return "data:image/jpeg;base64," + output.toString("base64");
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

    const baseline = parseScreenshot(body?.baselineScreenshot, baselineName);
    const competitor = parseScreenshot(body?.competitorScreenshot, competitorName);
    if (baseline.bytes.length + competitor.bytes.length > 18 * 1024 * 1024) {
      return Response.json({ error: "The two screenshots together exceed 18 MB. Upload smaller screenshots or capture at the selected viewport." }, { status: 413 });
    }

    const models: VerifiedModel[] = Array.isArray(body?.verifiedModels)
      ? body.verifiedModels.filter((item: any) =>
          item?.provider === "OpenRouter" &&
          item?.tier === "paid" &&
          typeof item?.model === "string" &&
          !item.model.endsWith(":free") &&
          item.model !== "openrouter/auto"
        ).slice(0, 2)
      : [];
    const model = models[0] || {
      provider: "OpenRouter" as const,
      model: process.env.UX_AUDIT_VISION_MODEL?.trim() || "deepseek/deepseek-v4.1-flash-1017",
      tier: "paid" as const
    };
    await assertPaidOpenRouterModel(model.model);
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) throw new Error("Configure OPENROUTER_API_KEY before running benchmark analysis.");

    const baselineFindings = Array.isArray(body?.baselineFindings)
      ? body.baselineFindings.slice(0, 8).map((f: any) => ({
          category: text(f?.category),
          title: text(f?.title),
          evidence: text(f?.evidence),
          recommendation: text(f?.recommendation)
        }))
      : [];

    const comparisonImage = await composeBenchmarkImage(baseline, competitor, baselineName, competitorName);

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

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://uxaudit.zunaid-cb7.workers.dev",
        "X-Title": "UX Audit Competitor Benchmark"
      },
      body: JSON.stringify({
        model: model.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "text", text: "Attached image layout: left panel = " + baselineName + " baseline; right panel = " + competitorName + " (" + competitorUrl.origin + "). Each panel has its bank label above the screenshot." },
            { type: "image_url", image_url: { url: comparisonImage } }
          ]
        }],
        temperature: 0.1,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        provider: { allow_fallbacks: false, max_price: { prompt: 0.5, completion: 2 } }
      }),
      signal: AbortSignal.timeout(30000),
      cache: "no-store"
    });
    const rawBody = await response.text();
    let payload: any = {};
    try { payload = rawBody ? JSON.parse(rawBody) : {}; }
    catch { throw new Error("OpenRouter returned invalid JSON (HTTP " + response.status + ")."); }
    if (!response.ok) {
      throw new Error("Benchmark insights model returned HTTP " + response.status + ": " + text(payload?.error?.message, rawBody.slice(0, 220)));
    }
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
