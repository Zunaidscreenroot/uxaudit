import { inspectImage } from "@/lib/image-utils";

type CaptureOptions = { url: string; width: number; height: number };

export async function captureWebsiteScreenshot({ url, width, height }: CaptureOptions) {
  const errors: string[] = [];
  const token = process.env.BROWSERLESS_API_TOKEN;

  // Prefer a real browser for full-page capture. Scroll the page first so lazy-loaded
  // images and below-the-fold sections have a chance to render before the screenshot.
  if (token) {
    try {
      const response = await fetch("https://production-sfo.browserless.io/screenshot?token=" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "image/*" },
        body: JSON.stringify({
          url,
          options: { type: "jpeg", quality: 82, fullPage: true, captureBeyondViewport: true, waitForImages: true },
          viewport: { width, height, deviceScaleFactor: 1 },
          gotoOptions: { waitUntil: "domcontentloaded", timeout: 18000 },
          waitForTimeout: 1800,
          scrollPage: true,
          bestAttempt: true
        }),
        signal: AbortSignal.timeout(30000),
        cache: "no-store"
      });
      const type = response.headers.get("content-type") || "";
      if (response.ok && type.startsWith("image/")) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 0 && bytes.length <= 15 * 1024 * 1024) {
          inspectImage(bytes);
          return { bytes, provider: "browserless" as const };
        }
        errors.push("Browserless returned an empty or oversized image");
      } else {
        const detail = !response.ok ? "HTTP " + response.status : "non-image response (" + type + ")";
        errors.push("Browserless: " + detail);
        await response.body?.cancel().catch(() => {});
      }
    } catch (error) {
      errors.push("Browserless: " + (error instanceof Error ? error.message : "capture failed"));
    }
  } else {
    errors.push("Browserless fallback is not configured");
  }

  // Secondary provider. Keep a small render delay here too, but prefer Browserless
  // because it explicitly scrolls the page to trigger lazy-loaded media.
  const thumUrl = "https://image.thum.io/get/fullpage/width/" + width + "/viewportWidth/" + width + "/wait/5/maxAge/0/noanimate/" + url;
  try {
    const response = await fetch(thumUrl, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(16000),
      cache: "no-store"
    });
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.startsWith("image/")) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 0 && bytes.length <= 15 * 1024 * 1024) {
        inspectImage(bytes);
        return { bytes, provider: "thum.io" as const };
      }
      errors.push("thum.io returned an empty or oversized image");
    } else {
      const detail = !response.ok ? "HTTP " + response.status : "non-image response (" + type + ")";
      errors.push("thum.io: " + detail);
      await response.body?.cancel().catch(() => {});
    }
  } catch (error) {
    errors.push("thum.io: " + (error instanceof Error ? error.message : "capture failed"));
  }

  throw new Error("Screenshot capture failed with all configured providers. " + errors.join(" | "));
}
