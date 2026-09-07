"use client";
import { FormEvent, useState } from "react";
import type { AuditPage, AuditResult, AuditStage } from "@/lib/audit";

const PIPELINE = [
  { id: "capture", label: "Taking page snapshot" },
  { id: "analyse", label: "Finding UX evidence" },
  { id: "enrich", label: "Applying UX standards" },
  { id: "complete", label: "Finalising evidence report" },
];

function ProgressPanel({ stages }: { stages: Record<string, AuditStage> }) {
  const active = Object.values(stages).find((stage) => stage.status === "active");
  const activeIndex = Math.max(0, PIPELINE.findIndex((item) => item.id === active?.id));
  return <div className="progressCard" role="status" aria-live="polite">
    <div className="progressTop"><div><div className="muted">LIVE AUDIT PIPELINE</div><h2>{active?.label ?? "Preparing audit"}</h2><p>{active?.detail ?? "Starting the audit pipeline…"}</p></div><div className="progressSpinner" aria-hidden="true" /></div>
    <div className="pipeline">{PIPELINE.map((item, index) => { const state = stages[item.id]; const done = index < activeIndex || state?.status === "complete"; const current = item.id === active?.id; return <div className={`pipelineStep ${done ? "done" : ""} ${current ? "current" : ""}`} key={item.id}><span className="pipelineIcon">{done ? "✓" : index + 1}</span><div><strong>{item.label}</strong><small>{done ? "Complete" : current ? "In progress" : "Waiting"}</small></div></div>; })}</div>
    <div className="pipelineNote">The screenshot is used internally as the visual source of truth. The client-facing MVP focuses on concrete evidence and the exact page section where each issue appears. Region highlighting is intentionally disabled for now.</div>
  </div>;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stages, setStages] = useState<Record<string, AuditStage>>({});
  const page = result?.pages[0] as AuditPage | undefined;

  async function runAudit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setResult(null); setStages({});
    try {
      const response = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "Audit failed."); }
      if (!response.body) throw new Error("The audit server did not return a progress stream.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) { if (!line.trim()) continue; const eventData = JSON.parse(line) as { type: string; stage?: AuditStage; result?: AuditResult; error?: string }; if (eventData.type === "stage" && eventData.stage) setStages((previous) => ({ ...previous, [eventData.stage!.id]: eventData.stage! })); if (eventData.type === "result" && eventData.result) setResult(eventData.result); if (eventData.type === "error") throw new Error(eventData.error ?? "Audit failed."); }
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setLoading(false); }
  }

  const findings = page?.findings ?? [];
  const evidenceCount = findings.reduce((count, finding) => count + finding.evidence.length, 0);
  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter((finding) => finding.severity === "medium").length;
  const low = findings.filter((finding) => finding.severity === "low").length;

  return <main className="shell">
    <nav className="nav"><div className="brandLockup"><div className="brand">UX Audit</div><div className="brandByline">by ScreenRoot</div></div><div className="navMeta">AI-assisted UX review</div></nav>
    <section className="hero"><div className="eyebrow">Website experience intelligence</div><h1>Find the friction before your users do.</h1><p className="lede">Enter a website and get a visual landing-page audit with client-ready evidence, UX laws, explanations, and redesign tasks.</p><form className="auditForm" onSubmit={runAudit}><input className="urlInput" type="text" inputMode="url" placeholder="https://yourwebsite.com" value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Website URL" /><button className="auditButton" type="submit" disabled={loading}>{loading ? "Running audit…" : "Run audit"}</button></form>{error && <div className="error">{error}</div>}</section>
    {loading && <section className="results progressResults"><ProgressPanel stages={stages} /></section>}
    {result && page && <section className="results" aria-live="polite">
      <div className="reportHeader"><div><div className="muted">LANDING PAGE AUDIT</div><h2>{page.title}</h2><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a></div><div className="reportOutcome"><span>Evidence-backed findings</span><strong>{findings.length}</strong><small>{evidenceCount} visible evidence items</small></div></div>
      <p className="reportSummary">This audit identified {findings.length} evidence-backed UX finding{findings.length === 1 ? "" : "s"} that can be located directly on the landing page. No composite UX score is shown because this MVP is designed to demonstrate evidence, not declare a pass/fail grade.</p>

      <div className="summary"><div className="card scoreCard"><div className="muted">AUDIT EVIDENCE</div><div className="metric">{evidenceCount}</div><p>Specific visible evidence items linked to page sections.</p></div><div className="card"><div className="muted">High priority</div><div className="metric">{high}</div><p>Material UX problems</p></div><div className="card"><div className="muted">Medium priority</div><div className="metric">{medium}</div><p>Meaningful friction</p></div><div className="card"><div className="muted">Low priority</div><div className="metric">{low}</div><p>Secondary opportunities</p></div></div>

      <div className="evidenceSection"><div className="sectionHeader"><div><div className="muted">CLIENT-READY UX EVIDENCE</div><h3>What is wrong, where it happens, and why it matters</h3></div><span className="pill">{findings.length} findings · {evidenceCount} evidence items</span></div>
        {findings.map((finding, findingIndex) => <article className="card regionFinding" key={finding.id}>
          <div className="findingBody">
            <div className="findingTop"><div><div className="category">Finding {findingIndex + 1} · {finding.category}</div><h3>{finding.title}</h3></div><div className={`severity ${finding.severity}`}>{finding.severity}</div></div>
            <p className="findingDescription">{finding.description}</p>
            <div className="evidenceList">{finding.evidence.map((item, index) => <div className="evidenceItem" key={`${finding.id}-${index}`}><div className="evidenceMeta"><span className="evidenceNumber">Evidence {index + 1}</span><span className="evidenceSection">{item.section}</span></div><h4>{item.element}</h4><p>{item.detail}</p></div>)}</div>
            <div className="clientImpact"><strong>Why this matters</strong><p>{finding.uxPerspective.assessment}</p></div>
            <p className="recommendation"><strong>Recommended redesign:</strong> {finding.recommendation}</p>
            <div className="detailGrid"><section className="detailBlock"><h4>UX law / principle</h4><div className="lawName">{finding.uxPerspective.law}</div><p><strong>Definition:</strong> {finding.uxPerspective.definition}</p></section><section className="detailBlock"><h4>ScreenRoot design tasks</h4><ul>{finding.screenrootTasks.map((task) => <li key={task}>{task}</li>)}</ul></section><section className="detailBlock"><h4>Development tasks</h4><ul>{finding.devTasks.map((task) => <li key={task}>{task}</li>)}</ul></section></div>
          </div>
        </article>)}
        {!findings.length && <div className="card emptyState"><h3>No defensible evidence found</h3><p>The visual audit did not find a sufficiently clear UX issue to present as client-facing evidence. This is preferable to inventing findings.</p></div>}
      </div>
    </section>}
  </main>;
}
