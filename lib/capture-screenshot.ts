import { inspectImage } from "@/lib/image-utils";

type CaptureOptions = { url: string; width: number; height: number };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function browserlessEndpoints() {
  // BROWSERLESS_ENDPOINT/BROWSERLESS_BASE_URL lets deployments use their dedicated fleet URL.
  // Shared REST endpoints are kept as fallbacks because a token may not be enabled on every host.
  const configured = (process.env.BROWSERLESS_ENDPOINT || process.env.BROWSERLESS_BASE_URL || "").trim().replace(/\/+$/, "");
  const candidates = [
    configured,
    "https://production-sfo.browserless.io",
    "https://chrome.browserless.io",
  ].filter(Boolean);
  return [...new Set(candidates)].slice(0, 2);
}

function screenshotEndpoint(base: string, token: string) {
  const parsed = new URL(base);
  if (parsed.protocol !== "https:") throw new Error("Browserless endpoint must use HTTPS.");
  if (!parsed.pathname.endsWith("/screenshot")) parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/screenshot";
  parsed.searchParams.set("token", token);
  return parsed;
}

export async function captureWebsiteScreenshot({ url, width, height }: CaptureOptions) {
  const errors: string[] = [];
  const token = process.env.BROWSERLESS_API_TOKEN;

  // Browserless is the preferred full-browser renderer. Use short, bounded attempts across
  // the configured fleet and the standard endpoint so a bad region or stale endpoint cannot
  // consume the whole request budget before the secondary provider is tried.
  if (token) {
    for (const base of browserlessEndpoints()) {
      const started = Date.now();
      let endpoint: URL;
      try {
        endpoint = screenshotEndpoint(base, token);
      } catch (error) {
        errors.push("Browserless endpoint: " + (error instanceof Error ? error.message : "invalid endpoint"));
        continue;
      }

      try {
        const response = await fetch(endpoint.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "image/*", "Cache-Control": "no-cache" },
          body: JSON.stringify({
            url,
            options: { type: "jpeg", quality: 78, fullPage: true, captureBeyondViewport: true, waitForImages: false },
            viewport: { width, height, deviceScaleFactor: 1 },
            gotoOptions: { waitUntil: "domcontentloaded", timeout: 8000 },
            waitForTimeout: 700,
            scrollPage: true,
            bestAttempt: true,
          }),
          signal: AbortSignal.timeout(10500),
          cache: "no-store",
        });
        const type = response.headers.get("content-type") || "";
        if (response.ok && type.startsWith("image/")) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES) {
            inspectImage(bytes);
            return { bytes, provider: "browserless" as const };
          }
          errors.push("Browserless (" + new URL(base).host + "): empty or oversized image");
        } else {
          errors.push("Browserless (" + new URL(base).host + "): " + (!response.ok ? "HTTP " + response.status : "non-image response (" + type + ")"));
          await response.body?.cancel().catch(() => {});
          // Authentication and quota errors are not fixed by trying another hostname.
          if ([401, 403, 429].includes(response.status)) break;
        }
        console.warn("[uxaudit] browserless_capture_attempt_failed", JSON.stringify({
          host: new URL(base).host,
          status: response.status,
          elapsedMs: Date.now() - started,
        }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : "capture failed";
        errors.push("Browserless (" + new URL(base).host + "): " + detail);
        console.warn("[uxaudit] browserless_capture_attempt_failed", JSON.stringify({
          host: new URL(base).host,
          elapsedMs: Date.now() - started,
          error: detail,
        }));
        // A timeout generally means the renderer is overloaded or the destination is stalled.
        // Move to the secondary provider rather than spending another full timeout on an alias.
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) break;
      }
    }
  } else {
    errors.push("Browserless API token is not configured");
  }

  // Thum.io is an independent fallback. Keep a bounded wait so the route can still return
  // actionable error text and the UI's manual screenshot-upload recovery before its deadline.
  const thumUrl = "https://image.thum.io/get/fullpage/width/" + width + "/viewportWidth/" + width + "/wait/1/maxAge/60/noanimate/" + url;
  try {
    const response = await fetch(thumUrl, {
      headers: { Accept: "image/*", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(13000),
      cache: "no-store",
    });
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.startsWith("image/")) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES) {
        inspectImage(bytes);
        return { bytes, provider: "thum.io" as const };
      }
      errors.push("thum.io: empty or oversized image");
    } else {
      errors.push("thum.io: " + (!response.ok ? "HTTP " + response.status : "non-image response (" + type + ")"));
      await response.body?.cancel().catch(() => {});
    }
  } catch (error) {
    errors.push("thum.io: " + (error instanceof Error ? error.message : "capture failed"));
  }

  throw new Error(
    "Automated screenshot capture failed. " +
    errors.join(" | ") +
    ". In Benchmarking, open this site's tab and upload a screenshot of the actual homepage; do not upload an access-verification page."
  );
}
