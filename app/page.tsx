"use client";
import { FormEvent, useMemo, useState } from "react";
import type { AuditPage, AuditResult } from "@/lib/audit";

function EvidenceMap({ page, evidence }: { page: AuditPage; evidence: Array<AuditPage["findings"][number]["evidence"][number] & { finding: AuditPage["findings"][number] }> }) {
  const [verified, setVerified] = useState(false);
  const width = page.screenshotWidth || 1440;
  const height = page.screenshotHeight || 900;
  return <div className="screenshotStage" data-evidence-verified={verified ? "true" : "false"}>
    <img className="fullPageScreenshot" src={page.screenshot} width={width} height={height} alt={`Full-page screenshot of ${page.url}`} onLoad={() => setVerified(true)} />
    <div className="evidenceOverlay" aria-hidden="true">
      {evidence.map((item, index) => <div key={`${item.finding.id}-${item.marker}-${index}`} className="evidenceRegion" style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.width}%`, height: `${item.height}%` }}>
        <span className="evidenceMarker">{item.marker}</span>
      </div>)}
    </div>
  </div>;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const page = result?.pages[0] as AuditPage | undefined;
  async function runAudit(event: FormEvent) { event.preventDefault(); setLoading(true); setError(""); setResult(null); try { const response = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Audit failed."); setResult(data); } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); } finally { setLoading(false); } }
  const evidence = useMemo(() => page?.findings.flatMap((finding) => finding.evidence.map((item) => ({ ...item, finding }))) ?? [], [page]);
  const high = page?.findings.filter((finding) => finding.severity === "high").length ?? 0;
  const medium = page?.findings.filter((finding) => finding.severity === "medium").length ?? 0;
  const low = page?.findings.filter((finding) => finding.severity === "low").length ?? 0;
  const score = page ? Math.max(0, 100 - high * 15 - medium * 8 - low * 3) : 0;
  const summary = page ? `${page.findings.length} visually evidenced UX finding${page.findings.length === 1 ? "" : "s"} identified across the landing page.` : "";
  return <main className="shell">
    <nav className="nav"><div className="brandLockup"><div className="brand">UX Audit</div><div className="brandByline">by ScreenRoot</div></div><div className="navMeta">AI-assisted UX review</div></nav>
    <section className="hero"><div className="eyebrow">Website experience intelligence</div><h1>Find the friction before your users do.</h1><p className="lede">Enter a website and get a visual landing-page audit with highlighted evidence, UX laws, explanations, and implementation tasks.</p><form className="auditForm" onSubmit={runAudit}><input className="urlInput" type="text" inputMode="url" placeholder="https://yourwebsite.com" value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Website URL" /><button className="auditButton" type="submit" disabled={loading}>{loading ? "Analysing…" : "Run audit"}</button></form>{error && <div className="error">{error}</div>}</section>
    {result && page && <section className="results" aria-live="polite">
      <div className="reportHeader"><div><div className="muted">LANDING PAGE AUDIT</div><h2>{page.title}</h2><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a></div><div className="reportScore"><span>UX score</span><strong>{score}</strong><small>/100</small></div></div><p className="reportSummary">{summary}</p>
      <div className="card screenshotCard"><div className="sectionHeader"><div><div className="muted">VISUAL EVIDENCE</div><h3>Landing page screenshot</h3></div><span className="pill">{evidence.length} highlighted region{evidence.length === 1 ? "" : "s"}</span></div><p className="screenshotHint">The full-page screenshot is shown at its original aspect ratio. Regions are verified against the captured page before they are displayed.</p><EvidenceMap page={page} evidence={evidence} /></div>
      <div className="summary"><div className="card scoreCard"><div className="muted">PAGE SUMMARY</div><div className="metric">{score}/100</div><p>{summary}</p></div><div className="card"><div className="muted">High priority</div><div className="metric">{high}</div></div><div className="card"><div className="muted">Medium priority</div><div className="metric">{medium}</div></div><div className="card"><div className="muted">Low priority</div><div className="metric">{low}</div></div></div>
      <div className="regionExplanations"><div className="sectionHeader"><div><div className="muted">REGION-BY-REGION ANALYSIS</div><h3>What each highlighted region is saying</h3></div></div>{page.findings.map((finding) => <article className="card regionFinding" key={finding.id}><div className={`severity ${finding.severity}`}>{finding.severity}</div><div className="findingBody"><div className="findingTop"><div><div className="category">Category: {finding.category}</div><h3>{finding.title}</h3></div><div className="pill">{finding.uxPerspective.law}</div></div><p>{finding.description}</p><div className="regionList">{finding.evidence.map((item, index) => <div className="regionRow" key={`${item.marker}-${index}`}><span className="marker">{item.marker}</span><div><strong>Region {item.marker}: {item.label}</strong><p>{item.detail}</p></div></div>)}</div><div className="detailGrid"><section className="detailBlock"><h4>ScreenRoot / UX tasks</h4><ul>{finding.screenrootTasks.map((task) => <li key={task}>{task}</li>)}</ul></section><section className="detailBlock"><h4>Development tasks</h4><ul>{finding.devTasks.map((task) => <li key={task}>{task}</li>)}</ul></section><section className="detailBlock lawBlock"><h4>UX law / principle</h4><div className="lawName">{finding.uxPerspective.law}</div><p><strong>Definition:</strong> {finding.uxPerspective.definition}</p><p><strong>Assessment:</strong> {finding.uxPerspective.assessment}</p></section></div><p className="recommendation"><strong>Recommended change:</strong> {finding.recommendation}</p></div></article>)}</div>
    </section>}
  </main>;
}
