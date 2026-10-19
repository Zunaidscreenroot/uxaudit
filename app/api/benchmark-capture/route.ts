import { privateHost, resolvesToPrivateAddress } from "@/lib/public-url";
import { captureWebsiteScreenshot } from "@/lib/capture-screenshot";
import { inspectImage } from "@/lib/image-utils";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let url: URL;
    try { url = new URL(body?.url); }
    catch { return Response.json({ error: "A valid competitor homepage URL is required." }, { status: 400 }); }
    if (!["http:", "https:"].includes(url.protocol) || privateHost(url.hostname)) {
      return Response.json({ error: "Only public HTTP/HTTPS pages can be captured for benchmarking." }, { status: 400 });
    }
    if (await resolvesToPrivateAddress(url.hostname)) {
      return Response.json({ error: "The competitor hostname did not resolve to a verified public address." }, { status: 400 });
    }

    const mode = body?.auditMode === "mobile" ? "mobile" : "desktop";
    const viewport = mode === "mobile" ? { width: 393, height: 852 } : { width: 1440, height: 900 };
    const captured = await captureWebsiteScreenshot({ url: url.href, width: viewport.width, height: viewport.height });
    if (!captured.bytes.length || captured.bytes.length > 15 * 1024 * 1024) {
      return Response.json({ error: "Captured screenshot is empty or exceeds 15 MB." }, { status: 502 });
    }
    const info = inspectImage(captured.bytes);
    const screenshot = "data:" + info.mimeType + ";base64," + captured.bytes.toString("base64");
    console.info("[uxaudit] benchmark_capture_ok", JSON.stringify({
      host: url.hostname, provider: captured.provider, width: info.width, height: info.height, bytes: captured.bytes.length, mode
    }));
    return Response.json({
      url: url.origin,
      mode,
      viewport,
      screenshot,
      screenshotWidth: info.width,
      screenshotHeight: info.height,
      captureMethod: captured.provider,
      findingCount: null,
      note: "Competitor screenshots are captured as benchmark evidence. The benchmark does not run a standalone competitor issue audit by default."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not capture this competitor homepage.";
    console.error("[uxaudit] benchmark_capture_failed", JSON.stringify({ error: message }));
    return Response.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
