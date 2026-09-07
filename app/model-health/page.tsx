"use client";

import { ChangeEvent, useMemo, useState } from "react";

type ModelResult = {
  model: string;
  provider: "OpenRouter" | "Gemini";
  configured: boolean;
  status: "ok" | "error";
  latencyMs: number;
  responseModel?: string;
  responsePreview?: string;
  error?: string;
};

type HealthResponse = {
  checkedAt: string;
  total: number;
  ok: number;
  failed: number;
  keys: { openRouter: boolean; gemini: boolean };
  note: string;
  results: ModelResult[];
};

export default function ModelHealth() {
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "ok" | "error">("all");

  async function runCheck() {
    if (!file) { setError("Choose the same screenshot you use for the audit."); return; }
    setLoading(true); setError(""); setData(null);
    try {
      const body = new FormData(); body.append("screenshot", file);
      const response = await fetch("/api/model-health", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Model health check failed.");
      setData(payload);
    } catch (err) { setError(err instanceof Error ? err.message : "Model health check failed."); }
    finally { setLoading(false); }
  }

  const results = useMemo(() => data?.results.filter((item) => filter === "all" || item.status === filter) ?? [], [data, filter]);
  const configured = data?.results.filter((item) => item.configured).length ?? 0;
  const discovered = data?.results.filter((item) => !item.configured).length ?? 0;

  function choose(event: ChangeEvent<HTMLInputElement>) { setFile(event.target.files?.[0] ?? null); setData(null); setError(""); }

  return <main style={{ minHeight: "100vh", background: "#f6f5f1", color: "#111", padding: "48px 6vw", fontFamily: "Arial, sans-serif" }}>
    <div style={{ maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 20, borderBottom: "1px solid #ddd", paddingBottom: 20 }}>
        <div><strong style={{ fontSize: 22 }}>UX Audit</strong><span style={{ marginLeft: 8, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Model Health</span></div>
        <a href="/" style={{ color: "#111" }}>Back to audit</a>
      </div>

      <section style={{ padding: "64px 0 34px" }}>
        <div style={{ display: "inline-block", background: "#f1d72e", padding: "7px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Internal diagnostic</div>
        <h1 style={{ fontSize: "clamp(42px, 7vw, 82px)", lineHeight: .95, maxWidth: 850, margin: "22px 0 18px", letterSpacing: -4 }}>Check every vision model.</h1>
        <p style={{ maxWidth: 720, fontSize: 17, lineHeight: 1.55, color: "#666" }}>This runs the uploaded screenshot through every integrated free OpenRouter vision model plus every configured Gemini vision model. OpenRouter model tests disable provider fallback so a green result means that specific listed model returned a response.</p>
      </section>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 28 }}>
        <label style={{ border: "1px solid #bbb", background: "white", borderRadius: 10, padding: "13px 16px", cursor: "pointer", fontWeight: 700 }}>
          <input type="file" accept="image/*" onChange={choose} hidden />
          {file ? file.name : "Choose screenshot"}
        </label>
        <button onClick={runCheck} disabled={loading || !file} style={{ border: 0, borderRadius: 10, padding: "14px 20px", background: "#111", color: "white", fontWeight: 700, cursor: loading || !file ? "default" : "pointer", opacity: loading || !file ? .5 : 1 }}>{loading ? "Testing all models…" : "Check all models"}</button>
      </div>
      {error && <div style={{ background: "#fff0f0", border: "1px solid #e5bcbc", borderRadius: 10, padding: 16, marginBottom: 20 }}>{error}</div>}

      {data && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 24 }}>
          {[["Total checked", data.total], ["Responding", data.ok], ["Failed", data.failed], ["Discovered", discovered]].map(([label, value]) => <div key={String(label)} style={{ background: "white", border: "1px solid #ddd", borderRadius: 12, padding: 20 }}><div style={{ color: "#777", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div><div style={{ fontSize: 38, fontWeight: 700, marginTop: 8 }}>{value}</div></div>)}
        </div>

        <div style={{ background: "#111", color: "white", borderRadius: 12, padding: 18, marginBottom: 24, lineHeight: 1.5 }}>
          <strong>Keys:</strong> OpenRouter {data.keys.openRouter ? "✓ configured" : "✕ missing"} · Gemini {data.keys.gemini ? "✓ configured" : "✕ missing"}<br />
          <span style={{ color: "#bbb", fontSize: 13 }}>{data.note}</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(["all", "ok", "error"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} style={{ border: "1px solid #ccc", borderRadius: 20, padding: "8px 13px", background: filter === value ? "#111" : "white", color: filter === value ? "white" : "#111" }}>{value === "all" ? `All (${data.total})` : value === "ok" ? `Responding (${data.ok})` : `Failed (${data.failed})`}</button>)}
        </div>

        <div style={{ background: "white", border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
          {results.map((item) => <div key={`${item.provider}-${item.model}`} style={{ display: "grid", gridTemplateColumns: "90px minmax(0, 1fr) 110px 100px", gap: 16, alignItems: "center", padding: "17px 20px", borderBottom: "1px solid #eee" }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#777" }}>{item.provider}</div>
            <div style={{ minWidth: 0 }}><strong style={{ wordBreak: "break-word" }}>{item.model}</strong><div style={{ color: "#777", fontSize: 12, marginTop: 5 }}>{item.status === "ok" ? `Response: ${item.responseModel ?? item.model}` : item.error}</div></div>
            <div style={{ fontVariantNumeric: "tabular-nums", color: "#666" }}>{item.latencyMs} ms</div>
            <div style={{ fontWeight: 800, textAlign: "right", color: item.status === "ok" ? "#167a3d" : "#b42318" }}>{item.status === "ok" ? "✓ RESPONSE" : "✕ FAILED"}</div>
          </div>)}
        </div>
        <p style={{ color: "#777", fontSize: 12, marginTop: 14 }}>Checked {new Date(data.checkedAt).toLocaleString()} · Configured models: {configured} · Discovered free multimodal models: {discovered}</p>
      </>}
    </div>
  </main>;
}
