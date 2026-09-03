import { NextResponse } from "next/server";
import { createAudit } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";

    if (!rawUrl) {
      return NextResponse.json({ error: "Enter a website URL." }, { status: 400 });
    }

    const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    new URL(normalizedUrl);

    const result = await createAudit(normalizedUrl);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Please enter a valid website URL." }, { status: 400 });
  }
}
