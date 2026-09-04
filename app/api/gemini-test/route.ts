import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GEMINI_MODEL = "gemini-3.8-flash";

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, configured: false, model: GEMINI_MODEL, error: "GEMINI_API_KEY is not configured on this deployment." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: "Reply with exactly: GEMINI_OK" }],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 10 },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    const detail = await response.text();

    if (!response.ok) {
      let message = `Gemini returned HTTP ${response.status}.`;
      try {
        const parsed = JSON.parse(detail);
        message = parsed?.error?.message || message;
      } catch {}

      return NextResponse.json(
        { ok: false, configured: true, model: GEMINI_MODEL, status: response.status, error: message },
        { status: 502 },
      );
    }

    let text = "";
    try {
      const parsed = JSON.parse(detail);
      text = parsed?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || "";
    } catch {}

    return NextResponse.json({ ok: true, configured: true, model: GEMINI_MODEL, response: text });
  } catch (error) {
    return NextResponse.json(
      { ok: false, configured: true, model: GEMINI_MODEL, error: error instanceof Error ? error.message : "Gemini connection failed." },
      { status: 502 },
    );
  }
}
