import { NextResponse } from "next/server";
import { createAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";

    if (!rawUrl) {
      return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
    }

    const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Use an HTTP or HTTPS website URL." }, { status: 400 });
    }

    const result = await createAudit(parsed.toString());
    return NextResponse.json(result);
  } catch (error) {
    console.error("UX audit failed", error);
    return NextResponse.json(
      { error: "The audit could not be completed. Check the URL and try again." },
      { status: 500 },
    );
  }
}
