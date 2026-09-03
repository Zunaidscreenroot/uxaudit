"use client";

import { FormEvent, useState } from "react";
import type { AuditResult } from "@/lib/audit";

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAudit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Audit failed.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <nav className="nav">
        <div className="brandLockup">
          <div className="brand">UX Audit</div>
          <div className="brandByline">by ScreenRoot</div>
        </div>
        <div className="navMeta">AI-assisted UX review</div>
      </nav>

      <section className="hero">
        <div className="eyebrow">Website experience intelligence</div>
        <h1>Find the friction before your users do.</h1>
        <p className="lede">
          Enter a website and turn UX best practices into a prioritized set of actionable findings.
        </p>

        <form className="auditForm" onSubmit={runAudit}>
          <input
            className="urlInput"
            type="text"
            inputMode="url"
            placeholder="https://yourwebsite.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-label="Website URL"
          />
          <button className="auditButton" type="submit" disabled={loading}>
            {loading ? "Auditing…" : "Run audit"}
          </button>
        </form>
        {error && <div className="error">{error}</div>}
      </section>

      {result && (
        <section className="results" aria-live="polite">
          <div className="summary">
            <div className="card scoreCard">
              <div className="muted">UX score</div>
              <div className="metric">{result.score}/100</div>
              <p>{result.summary}</p>
            </div>
            <div className="card"><div className="muted">High priority</div><div className="metric">{result.findings.filter((f) => f.severity === "high").length}</div></div>
            <div className="card"><div className="muted">Medium priority</div><div className="metric">{result.findings.filter((f) => f.severity === "medium").length}</div></div>
            <div className="card"><div className="muted">Findings</div><div className="metric">{result.findings.length}</div></div>
          </div>

          <div className="findings">
            {result.findings.map((finding) => (
              <article className="card finding" key={finding.id}>
                <div className={`severity ${finding.severity}`}>{finding.severity}</div>
                <div>
                  <h3>{finding.title}</h3>
                  <p>{finding.description}</p>
                  <p className="recommendation"><strong>Recommendation:</strong> {finding.recommendation}</p>
                </div>
                <div className="pill">{finding.category}</div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
