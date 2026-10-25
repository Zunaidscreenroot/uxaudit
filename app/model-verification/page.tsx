"use client";
import { useEffect, useState } from "react";
import { PageHeading } from "../ui";

type ModelCheck = {
  model: string;
  label: string;
  ok: boolean;
  status: string;
  latencyMs: number;
  totalTokens: number | null;
  costUsd: number | null;
  responsePreview?: string;
  error?: string;
};
type Verification = {
  checkedAt: string;
  models: ModelCheck[];
  selectedModel: ModelCheck | null;
  verificationRunCostUsd: number | null;
  verificationRunTokens: number | null;
  selectionReason: string;
  note?: string;
  cacheHit?: boolean;
};

const money = (usd: number | null | undefined) =>
  usd == null ? "Unavailable" : "₹" + (usd * 97).toLocaleString("en-IN", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export default function ModelVerification() {
  const [data, setData] = useState<Verification | null>(null);
  const [budget, setBudget] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [showBudget, setShowBudget] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [verificationResponse, budgetResponse] = await Promise.all([
        fetch("/api/model-verification", { cache: "no-store" }),
        fetch("/api/cost-status", { cache: "no-store" }),
      ]);
      const verification = await verificationResponse.json();
      const costs = await budgetResponse.json();
      if (!verificationResponse.ok) throw new Error(verification.error || "Could not load FreeLLMAPI status.");
      setData(verification);
      if (budgetResponse.ok) setBudget(costs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load verification details.");
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setError("");
    try {
      const response = await fetch("/api/model-verification", { method: "POST", cache: "no-store" });
      const result = await response.json();
      setData(result);
      if (!response.ok) setError(result.error || result.models?.[0]?.error || "FreeLLMAPI test failed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "FreeLLMAPI test failed.");
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const model = data?.models?.[0];

  return <main style={{ minHeight: "100vh", background: "#f4f5f7", padding: "28px clamp(16px,4vw,56px)", fontFamily: "Inter,Arial,sans-serif", color: "#172033" }}>
    <div style={{ maxWidth: 1100, margin: "auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #dfe3e8", paddingBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div><a href="/" style={{ fontSize: 22, fontWeight: 850, color: "#172033", textDecoration: "none" }}>UX AUDIT</a><p style={{ color: "#64748b", margin: "7px 0 0" }}>FreeLLMAPI connection and inference verification</p></div>
        <a href="/" style={{ color: "#334155" }}>Back to audit</a>
      </header>
      <PageHeading eyebrow="MODEL & COSTS" title="FreeLLMAPI verification" description="Check the configured gateway without automatically spending inference tokens. A small text-only inference test runs only when you click Verify now." className="modelVerificationSharedHeading" />
      <section style={{ background: "#fff", padding: 22, borderRadius: 14, border: "1px solid #dfe3e8", marginTop: 22 }}>
        <h2 style={{ marginTop: 0 }}>Configured route</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <div style={{ padding: 15, border: "1px solid #e5e9ef", borderRadius: 10 }}><div style={{ fontSize: 11, color: "#718096" }}>PROVIDER</div><strong style={{ display: "block", marginTop: 8 }}>FreeLLMAPI</strong></div>
          <div style={{ padding: 15, border: "1px solid #e5e9ef", borderRadius: 10 }}><div style={{ fontSize: 11, color: "#718096" }}>MODEL ROUTE</div><strong style={{ display: "block", marginTop: 8, overflowWrap: "anywhere" }}>{model?.model || "auto"}</strong></div>
          <div style={{ padding: 15, border: "1px solid #e5e9ef", borderRadius: 10 }}><div style={{ fontSize: 11, color: "#718096" }}>LAST TEST</div><strong style={{ display: "block", marginTop: 8 }}>{model?.status === "verified" ? "Passed" : model?.status === "failed" || model?.status === "no_response" ? "Failed" : "Not tested"}</strong></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 18 }}>
          <button onClick={() => void verify()} disabled={verifying} style={{ border: 0, borderRadius: 9, padding: "12px 18px", color: "#fff", background: verifying ? "#718096" : "#1d4ed8", fontWeight: 750, cursor: verifying ? "wait" : "pointer" }}>{verifying ? "Verifying…" : "Verify now"}</button>
          <button onClick={() => void load()} disabled={loading} style={{ border: "1px solid #cbd5e1", borderRadius: 9, padding: "12px 18px", color: "#334155", background: "#fff", fontWeight: 650 }}>{loading ? "Refreshing…" : "Refresh status"}</button>
          {data?.checkedAt && <span style={{ fontSize: 12, color: "#64748b" }}>Checked {new Date(data.checkedAt).toLocaleString("en-IN")}</span>}
        </div>
        {error && <p role="alert" style={{ padding: 12, background: "#fff1f1", color: "#9f2828", borderRadius: 8, marginTop: 14 }}>{error}</p>}
        {model?.error && <p style={{ padding: 12, background: "#fff1f1", color: "#9f2828", borderRadius: 8 }}>{model.error}</p>}
        {model?.responsePreview && <p style={{ padding: 12, background: "#eefbf3", color: "#17633b", borderRadius: 8 }}>Response preview: <strong>{model.responsePreview}</strong></p>}
        <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.65 }}>{data?.selectionReason || "The model catalog check does not send an inference request."} {data?.note || ""}</p>
      </section>
      <section style={{ background: "#fff", padding: 22, borderRadius: 14, border: "1px solid #dfe3e8", marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>Usage and cost transparency</h2>
        <p style={{ color: "#64748b", lineHeight: 1.65 }}>The configured daily budget is a limit setting, not a spend meter. FreeLLMAPI usage and upstream credits are unavailable unless the gateway returns auditable usage and cost metadata.</p>
        <button onClick={() => setShowBudget(!showBudget)} style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "10px 14px", background: "#fff" }}>{showBudget ? "Hide details" : "Show budget details"}</button>
        {showBudget && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 14 }}>
          <div style={{ padding: 15, border: "1px solid #e5e9ef", borderRadius: 10 }}><div style={{ fontSize: 11, color: "#718096" }}>DAILY BUDGET SETTING</div><strong style={{ display: "block", marginTop: 8 }}>{budget ? "₹" + budget.dailyBudgetInr : "Unavailable"}</strong></div>
          <div style={{ padding: 15, border: "1px solid #e5e9ef", borderRadius: 10 }}><div style={{ fontSize: 11, color: "#718096" }}>UPSTREAM SPEND</div><strong style={{ display: "block", marginTop: 8 }}>{money(budget?.provider?.usageDailyUsd)}</strong></div>
          <div style={{ padding: 15, border: "1px solid #e5e9ef", borderRadius: 10 }}><div style={{ fontSize: 11, color: "#718096" }}>CREDITS BALANCE</div><strong style={{ display: "block", marginTop: 8 }}>{money(budget?.provider?.creditsUsd)}</strong></div>
        </div>}
      </section>
    </div>
  </main>;
}
