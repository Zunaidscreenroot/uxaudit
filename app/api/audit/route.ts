import { NextResponse } from "next/server";
import { createAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
    if (!rawUrl) return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let parsed: URL;
    try { parsed = new URL(normalizedUrl); } catch { return NextResponse.json({ error: "Enter a valid website URL, for example https://example.com" }, { status: 400 }); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return NextResponse.json({ error: "Use an HTTP or HTTPS website URL." }, { status: 400 });
    if (!parsed.hostname || !parsed.hostname.includes(".")) return NextResponse.json({ error: "Enter a valid website URL, for example https://example.com" }, { status: 400 });
    return NextResponse.json(await createAudit(parsed.toString()));
  } catch (error) {
    console.error("UX audit failed", error);
    const message = error instanceof Error ? error.message : "Unknown audit error.";
    return NextResponse.json({ error: `The audit could not be completed: ${message}` }, { status: 500 });
  }
}
