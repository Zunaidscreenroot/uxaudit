"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

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

type ConfiguredModel = { provider: "OpenRouter" | "Gemini"; model: string; configured: boolean; };
type ConfigResponse = { checkedAt: string; keys: { openRouter: boolean; gemini: boolean }; models: ConfiguredModel[]; note: string; };
type CostStatus = {
  checkedAt: string;
  dailyBudgetInr: number;
  dailySpendInr: number | null;
  dailyRemainingInr: number | null;
  dailySpendTracking: string;
  tokenTracking: string;
  provider: { connected: boolean; keyConfigured: boolean; managementKeyConfigured: boolean; usageUsd: number | null; limitUsd: number | null; remainingUsd: number | null; freeTier: boolean | null; error: string | null; label?: string | null };
  note: string;
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

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

async function prepareUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, Math.sqrt(MAX_UPLOAD_BYTES / file.size));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the screenshot for upload.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let quality = 0.82;
    let blob: Blob | null = null;
    while (quality >= 0.5) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_UPLOAD_BYTES) break;
      quality -= 0.08;
    }
    if (!blob || blob.size > MAX_UPLOAD_BYTES) {
      throw new Error("The screenshot could not be compressed below the upload limit. Please choose a smaller image.");
    }
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

async function readResponse(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(response.ok
      ? "The model health service returned an invalid response."
      : `Model health service returned HTTP ${response.status}: ${text.slice(0, 220)}`);
  }
}

export default function ModelHealth() {
  const [file, setFile] = useState<File | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);\n  const [cost, setCost] = useState<CostStatus | null>(null);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "ok" | "error">("all");

  useEffect(() => {
    fetch("/api/model-health").then(readResponse).then((payload) => setConfig(payload as ConfigResponse)).catch(() => setError("Could not load backend configuration status."));\n    fetch("/api/cost-status", { cache: "no-store" }).then(readResponse).then((payload) => setCost(payload as CostStatus)).catch(() => undefined);
  }, []);

  async function runCheck() {
    if (!file) { setError("Choose the same screenshot you use for the audit."); return; }
    setLoading(true); setError(""); setData(null);
    try {
      const upload = await prepareUpload(file);
      const body = new FormData();
      body.append("screenshot", upload);
      const response = await fetch("/api/model-health", { method: "POST", body });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error ?? "Model health check failed.");
      setData(payload as HealthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Model health check failed.");
    } finally { setLoading(false); }
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

      {cost && <section style={{ margin: "24px 0", background: "white", border: "1px solid #ddd", borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div><strong style={{ fontSize: 18 }}>AI spend & budget transparency</strong><p style={{ color: "#666", fontSize: 13, margin: "6px 0 0" }}>Updated {new Date(cost.checkedAt).toLocaleString()}</p></div>
          <strong style={{ color: cost.provider.connected ? "#167a3d" : "#b42318" }}>{cost.provider.connected ? "● OpenRouter connected" : cost.provider.keyConfigured ? "● OpenRouter configured · connection unavailable" : "● OpenRouter key missing"}</strong>
        </div>
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {[
            ["Daily budget", `₹${cost.dailyBudgetInr.toLocaleString("en-IN")}`],
            ["Today's spend", cost.dailySpendInr === null ? "Not tracked yet" : `₹${cost.dailySpendInr.toFixed(2)}`],
            ["Budget remaining", cost.dailyRemainingInr === null ? "Not available" : `₹${cost.dailyRemainingInr.toFixed(2)}`],
            ["OpenRouter key usage", cost.provider.usageUsd === null ? "Not available" : `${cost.provider.usageUsd.toFixed(4)}`],
            ["Key limit remaining", cost.provider.remainingUsd === null ? "Not provided" : `${cost.provider.remainingUsd.toFixed(2)}`],
            ["Token usage", "Not tracked yet"],
          ].map(([label, value]) => <div key={label} style={{ border: "1px solid #eee", borderRadius: 9, padding: 14 }}><div style={{ color: "#777", fontSize: 11, textTransform: "uppercase", letterSpacing: .7 }}>{label}</div><strong style={{ display: "block", marginTop: 8, fontSize: 21, overflowWrap: "anywhere" }}>{value}</strong></div>)}
        </div>
        <p style={{ color: "#777", fontSize: 12, lineHeight: 1.5, marginBottom: 0 }}>{cost.note}</p>
        {cost.provider.error && <p style={{ color: "#b42318", fontSize: 12 }}>Provider status: {cost.provider.error}</p>}
      </section>}

      {config && <section style={{ margin: "24px 0", background: "white", border: "1px solid #ddd", borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div><strong style={{ fontSize: 18 }}>Backend connection status</strong><p style={{ color: "#666", fontSize: 13, margin: "6px 0 0" }}>Configuration checked {new Date(config.checkedAt).toLocaleString()}</p></div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>OpenRouter {config.keys.openRouter ? "✓ Key configured" : "✕ Key missing"} · Gemini {config.keys.gemini ? "✓ Key configured" : "✕ Key missing"}</div>
        </div>
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {config.models.map((item) => <div key={item.provider + item.model} style={{ border: "1px solid #eee", borderRadius: 9, padding: 13 }}>
            <div style={{ color: "#777", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{item.provider}</div>
            <strong style={{ display: "block", marginTop: 6, overflowWrap: "anywhere" }}>{item.model}</strong>
            <div style={{ marginTop: 7, fontSize: 12, fontWeight: 700, color: item.configured ? "#167a3d" : "#b42318" }}>{item.configured ? "Key configured · live test not run" : "Not configured"}</div>
          </div>)}
        </div>
        <p style={{ color: "#777", fontSize: 12, lineHeight: 1.5, marginBottom: 0 }}>{config.note}</p>
      </section>}

      <section style={{ padding: "64px 0 34px" }}>
        <div style={{ display: "inline-block", background: "#f1d72e", padding: "7px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Internal diagnostic</div>
        <h1 style={{ fontSize: "clamp(42px, 7vw, 82px)", lineHeight: .95, maxWidth: 850, margin: "22px 0 18px", letterSpacing: -4 }}>Check every vision model.</h1>
        <p style={{ maxWidth: 720, fontSize: 17, lineHeight: 1.55, color: "#666" }}>This runs the uploaded screenshot through every integrated free OpenRouter vision model plus every configured Gemini vision model. OpenRouter model tests disable provider fallback, so a green result means that specific listed model returned a response. Large screenshots are compressed in the browser before the request.</p>
      </section>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 28 }}>
        <label style={{ border: "1px solid #bbb", background: "white", borderRadius: 10, padding: "13px 16px", cursor: "pointer", fontWeight: 700 }}>
          <input type="file" accept="image/*" onChange={choose} hidden />
          {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : "Choose screenshot"}
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
            <div style={{ minWidth: 0 }}><strong style={{ wordBreak: "break-word" }}>{item.model}</strong><div style={{ color: "#777", fontSize: 12, marginTop: 5 }}>{item.status === "ok" ? `Response: ${item.responseModel ?? item.model}${item.responsePreview ? ` · ${item.responsePreview}` : ""}` : item.error}</div></div>
            <div style={{ fontVariantNumeric: "tabular-nums", color: "#666" }}>{item.latencyMs} ms</div>
            <div style={{ fontWeight: 800, textAlign: "right", color: item.status === "ok" ? "#167a3d" : "#b42318" }}>{item.status === "ok" ? "✓ RESPONSE" : "✕ FAILED"}</div>
          </div>)}
        </div>
        <p style={{ color: "#777", fontSize: 12, marginTop: 14 }}>Checked {new Date(data.checkedAt).toLocaleString()} · Configured models: {configured} · Discovered free multimodal models: {discovered}</p>
      </>}
    </div>
  </main>;
}
