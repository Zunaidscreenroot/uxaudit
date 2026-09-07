"use client";

import { useEffect, useState } from "react";

export default function ClientReportPage({ params }: { params: { auditId: string } }) {
  const [html, setHtml] = useState("");
  const [clientName, setClientName] = useState("Client report");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/knowledge-base?auditId=${encodeURIComponent(params.auditId)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.audit) throw new Error(data.error || "Could not load this report.");
        if (cancelled) return;
        setClientName(data.audit.client_name || "Client report");
        if (!data.audit.report_html) throw new Error("This audit does not have a generated report yet.");
        const base = `<base href="${window.location.origin}/">`;
        setHtml(data.audit.report_html.replace(/<head>/i, `<head>${base}`));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [params.auditId]);

  async function exportPdf() {
    setExporting(true); setError("");
    try {
      const response = await fetch(`/api/report?auditId=${encodeURIComponent(params.auditId)}&format=pdf`, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not export the report as PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${clientName.replace(/[^a-z0-9]+/gi, "-") || "client"}-UX-Audit.pdf`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export the report as PDF.");
    } finally { setExporting(false); }
  }

  return <main className="reportShell">
    <header className="reportToolbar"><a href="/knowledge-base" className="back">← Knowledge base</a><div className="toolbarCenter"><strong>{clientName}</strong><span>Client report</span></div><button onClick={() => void exportPdf()} disabled={loading || exporting || !html}>{exporting ? "Preparing PDF…" : "Export PDF ↓"}</button></header>
    {error && <div className="reportError">{error}</div>}
    {loading && <div className="reportLoading">Loading client report…</div>}
    {!loading && html && <iframe className="reportFrame" title={`${clientName} client report`} srcDoc={html} />}
    <style jsx>{` .reportShell{min-height:100vh;background:#ecebe6;padding-top:64px}.reportToolbar{position:fixed;z-index:20;left:0;right:0;top:0;height:64px;background:rgba(22,22,22,.94);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:space-between;padding:0 22px;color:#fff;border-bottom:1px solid rgba(255,255,255,.1)}.back{color:#c9c9c9;text-decoration:none;font-size:12px;font-weight:700}.toolbarCenter{text-align:center;display:flex;flex-direction:column;gap:2px}.toolbarCenter strong{font-size:13px}.toolbarCenter span{font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#8e8e8e}.reportToolbar button{border:0;border-radius:999px;background:#fff;color:#111;padding:10px 16px;font-size:11px;font-weight:850;cursor:pointer}.reportToolbar button:disabled{opacity:.5;cursor:wait}.reportFrame{display:block;width:min(1120px,100%);height:calc(100vh - 88px);min-height:720px;border:0;margin:24px auto;background:#fff;box-shadow:0 10px 45px rgba(0,0,0,.14)}.reportLoading,.reportError{margin:46px auto 0;max-width:700px;padding:24px;border:1px solid #ccc;border-radius:14px;color:#333;background:#fff}.reportError{border-color:#c58b82;color:#7b3027}@media(max-width:700px){.reportToolbar{padding:0 12px}.back{font-size:11px}.toolbarCenter{display:none}.reportFrame{width:100%;margin:0;height:calc(100vh - 64px);min-height:700px;box-shadow:none}} `}</style>
  </main>;
}
