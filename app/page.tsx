"use client";

import { FormEvent, useState } from "react";
import type { AuditResult, Finding } from "@/lib/audit";

function EvidenceView({ finding }: { finding: Finding }) {
  return (
    <div className="evidencePanel">
      <div className="evidenceImageWrap">
        <img className="evidenceImage" src={"" + finding.evidence.length ? "" : ""} alt="" />
        <div className="evidenceFallback">Screenshot evidence is shown above the finding report.</div>
      </div>
      <div className="evidenceList">
        {finding.evidence.map((item) => (
          <div className="evidenceItem" key={item.marker}>
            <span className="marker">{item.marker}</span>
            <div><strong>{item.label}</strong><p>{item.detail}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAudit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Audit failed.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setLoading(false); }
  }

  return (
    <main className="shell">
      <nav className="nav"><div className="brandLockup"><div className="brand">UX Audit</div><div className="brandByline">by ScreenRoot</div></div><div className="navMeta">AI-assisted UX review</div></nav>
      <section className="hero">
        <div className="eyebrow">Website experience intelligence</div>
        <h1>Find the friction before your users do.</h1>
        <p className="lede">Enter a website and get evidence-backed UX findings, relevant UX laws, definitions, and implementation tasks.</p>
        <form className="auditForm" onSubmit={runAudit}>
          <input className="urlInput" type="text" inputMode="url" placeholder="https://yourwebsite.com" value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Website URL" />
          <button className="auditButton" type="submit" disabled={loading}>{loading ? "Analysing…" : "Run audit"}</button>
        </form>
        {error && <div className="error">{error}</div>}
      </section>

      {result && (
        <section className="results" aria-live="polite">
          <div className="reportHeader"><div><div className="muted">AUDIT REPORT</div><h2>{result.pageTitle}</h2><a href={result.url} target="_blank" rel="noreferrer">{result.url}</a></div><div className="reportScore"><span>UX score</span><strong>{result.score}</strong><small>/100</small></div></div>
          <p className="reportSummary">{result.summary}</p>

          <div className="screenshotCard card">
            <div className="sectionHeader"><div><div className="muted">VISUAL EVIDENCE</div><h3>Page screenshot & issue markers</h3></div><span className="pill">Annotated evidence</span></div>
            <div className="screenshotStage">
              <img src={result.screenshotUrl} alt={`Screenshot of ${result.url}`} />
              {result.findings.flatMap((f) => f.evidence).map((item) => (
                <div key={item.marker} className="annotation" style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` }}>
                  <span>{item.marker}</span>
                </div>
              ))}
              <svg className="annotationLines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {result.findings.flatMap((f) => f.evidence).map((item) => <line key={item.marker} x1={item.x + item.width} y1={item.y + item.height / 2} x2="98" y2={12 + (item.marker - 1) * 16} />)}
              </svg>
            </div>
            <div className="evidenceLegend">Markers correspond to the evidence references inside each finding. Screenshot coordinates are indicative until DOM-level visual capture is added.</div>
          </div>

          <div className="summary"><div className="card scoreCard"><div className="muted">UX score</div><div className="metric">{result.score}/100</div><p>{result.summary}</p></div><div className="card"><div className="muted">High priority</div><div className="metric">{result.findings.filter((f) => f.severity === "high").length}</div></div><div className="card"><div className="muted">Medium priority</div><div className="metric">{result.findings.filter((f) => f.severity === "medium").length}</div></div><div className="card"><div className="muted">Findings</div><div className="metric">{result.findings.length}</div></div></div>

          <div className="findings">
            {result.findings.map((finding) => (
              <article className="card finding" key={finding.id}>
                <div className={`severity ${finding.severity}`}>{finding.severity}</div>
                <div className="findingBody">
                  <div className="findingTop"><div><div className="category">Category: {finding.category}</div><h3>{finding.title}</h3></div><div className="pill">{finding.uxPerspective.law}</div></div>
                  <p>{finding.description}</p>
                  <div className="detailGrid">
                    <section className="detailBlock"><h4>ScreenRoot team / dev team tasks</h4><ul>{finding.screenrootTasks.map((task) => <li key={task}>{task}</li>)}</ul></section>
                    <section className="detailBlock lawBlock"><h4>UX perspective</h4><div className="lawName">{finding.uxPerspective.law}</div><p><strong>Definition:</strong> {finding.uxPerspective.definition}</p><p><strong>Assessment:</strong> {finding.uxPerspective.assessment}</p></section>
                  </div>
                  <p className="recommendation"><strong>Recommended change:</strong> {finding.recommendation}</p>
                  <div className="findingEvidence"><h4>Evidence</h4>{finding.evidence.map((item) => <div className="evidenceItem" key={item.marker}><span className="marker">{item.marker}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div></div>)}</div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
