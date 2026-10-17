import sharp from "sharp";

type CaptureOptions = { url: string; width: number; height: number };

export async function captureWebsiteScreenshot({ url, width, height }: CaptureOptions) {
  const errors: string[] = [];
  const thumUrl = "https://image.thum.io/get/width/" + width + "/viewportWidth/" + width + "/crop/" + height + "/maxAge/0/noanimate/" + url;

  // Try the hosted screenshot service first, but keep its wait bounded so a slow capture
  // does not consume the entire serverless request budget.
  try {
    const response = await fetch(thumUrl, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(14000),
      cache: "no-store"
    });
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.startsWith("image/")) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 0 && bytes.length <= 15 * 1024 * 1024) {
        await sharp(bytes).metadata();
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

  // Browserless is the resilient fallback for sites that time out at the screenshot CDN.
  const token = process.env.BROWSERLESS_API_TOKEN;
  if (token) {
    try {
      const response = await fetch("https://production-sfo.browserless.io/screenshot?token=" + encodeURIComponent(token), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "image/*" },
        body: JSON.stringify({
          url,
          options: { type: "jpeg", quality: 82, fullPage: false },
          viewport: { width, height, deviceScaleFactor: 1 },
          gotoOptions: { waitUntil: "domcontentloaded", timeout: 18000 },
          bestAttempt: true
        }),
        signal: AbortSignal.timeout(23000),
        cache: "no-store"
      });
      const type = response.headers.get("content-type") || "";
      if (response.ok && type.startsWith("image/")) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 0 && bytes.length <= 15 * 1024 * 1024) {
          await sharp(bytes).metadata();
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

  throw new Error("Screenshot capture failed with all configured providers. " + errors.join(" | "));
}
