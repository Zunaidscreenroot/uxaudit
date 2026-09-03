import { NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";

export const runtime = "nodejs";

function isPrivateOrReservedIp(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && address === "192.0.0.1") ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }

  return true;
}

async function validateTarget(rawUrl: string) {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid website URL.");
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  if (target.username || target.password) {
    throw new Error("URLs with embedded credentials are not supported.");
  }

  const hostname = target.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local network URLs are not supported.");
  }

  const literalIp = net.isIP(hostname) ? hostname : null;
  const addresses = literalIp
    ? [literalIp]
    : (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateOrReservedIp)) {
    throw new Error("Private or reserved network addresses are not supported.");
  }

  return target.toString();
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const encodedTarget = requestUrl.searchParams.get("u")?.trim() ?? "";
    const rawUrl = encodedTarget
      ? decodeBase64Url(encodedTarget)
      : requestUrl.searchParams.get("url")?.trim() ?? "";

    if (!rawUrl) return NextResponse.json({ error: "Missing website URL." }, { status: 400 });

    const target = await validateTarget(rawUrl);
    const token = process.env.BROWSERLESS_API_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "BROWSERLESS_API_TOKEN is not configured." }, { status: 503 });
    }

    const endpoint = new URL("https://production-sfo.browserless.io/screenshot");
    endpoint.searchParams.set("token", token);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: target,
        options: {
          fullPage: true,
          type: "png",
          viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
          waitForImages: true,
          timeout: 30000,
        },
        scrollPage: true,
        bestAttempt: true,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Browserless screenshot failed", response.status, detail.slice(0, 1000));
      return NextResponse.json(
        { error: `Screenshot service returned HTTP ${response.status}.` },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      const detail = await response.text().catch(() => "");
      console.error("Browserless returned unexpected content type", contentType, detail.slice(0, 500));
      return NextResponse.json({ error: "Screenshot service returned an invalid image." }, { status: 502 });
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (error) {
    console.error("Screenshot proxy failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Screenshot could not be generated." },
      { status: 400 },
    );
  }
}
