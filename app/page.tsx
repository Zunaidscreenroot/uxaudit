"use client";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import type { AuditPage, AuditResult, AuditStage } from "@/lib/audit";

const PIPELINE = [
  { id: "capture", label: "Preparing screenshot" },
  { id: "analyse", label: "Finding UX evidence" },
  { id: "enrich", label: "Applying UX standards" },
  { id: "complete", label: "Finalising evidence report" },
];

function ProgressPanel({ stages }: { stages: Record<string, AuditStage> }) {
  const active = Object.values(stages).find((stage) => stage.status === "active");
  const activeIndex = Math.max(0, PIPELINE.findIndex((item) => item.id === active?.id));
  return <div className="progressCard" role="status" aria-live="polite">
    <div className="progressTop"><div><div className="muted">LIVE AUDIT PIPELINE</div><h2>{active?.label ?? "Preparing audit"}</h2><p>{active?.detail ?? "Starting the screenshot review…"}</p></div><div className="progressSpinner" aria-hidden="true" /></div>
    <div className="pipeline">{PIPELINE.map((item, index) => { const state = stages[item.id]; const done = index < activeIndex || state?.status === "complete"; const current = item.id === active?.id; return <div className={`pipelineStep ${done ? "done" : ""} ${current ? "current" : ""}`} key={item.id}><span className="pipelineIcon">{done ? "✓" : index + 1}</span><div><strong>{item.label}</strong><small>{done ? "Complete" : current ? "In progress" : "Waiting"}</small></div></div>; })}</div>
    <div className="pipelineNote">The uploaded screenshot is the source of truth. The audit focuses on concrete, client-ready UX evidence and tells you exactly which page section and visible element each finding refers to.</div>
  </div>;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stages, setStages] = useState<Record<string, AuditStage>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const page = result?.pages[0] as AuditPage | undefined;

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setError(""); setResult(null); setFile(selected);
    setPreview(URL.createObjectURL(selected));
  }

  function clearFile() {
    setFile(null); setPreview("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function runAudit(event: FormEvent) {
    event.preventDefault();
    if (!file) { setError("Upload a screenshot first."); return; }
    setLoading(true); setError(""); setResult(null); setStages({});
    try {
      const body = new FormData();
      body.append("screenshot", file);
      const response = await fetch("/api/audit", { method: "POST", body });
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
    <nav className="nav"><div className="brandLockup"><div className="brand">UX Audit</div><div className="brandByline">by ScreenRoot</div></div><div className="navMeta">Evidence-first UX review</div></nav>
    <section className="hero"><div className="eyebrow">Screenshot → UX evidence</div><h1>Show clients exactly where the experience breaks.</h1><p className="lede">Upload a full-page website screenshot and get evidence-backed UX findings that a client can locate, understand, and act on.</p>
      <form className="auditForm" onSubmit={runAudit}>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectFile} hidden />
        <button className="uploadButton" type="button" onClick={() => inputRef.current?.click()} disabled={loading}>{file ? "Change screenshot" : "Upload screenshot"}</button>
        <button className="auditButton" type="submit" disabled={loading || !file}>{loading ? "Reviewing screenshot…" : "Run UX audit"}</button>
      </form>
      {file && <div className="uploadInfo"><span><strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" onClick={clearFile} disabled={loading}>Remove</button></div>}
      {preview && !loading && !result && <div className="uploadPreview"><img src={preview} alt="Uploaded website screenshot preview" /></div>}
      {!file && <p className="uploadHint">PNG, JPG, JPEG or WebP · maximum 15 MB · full-page desktop screenshots work best.</p>}
      {error && <div className="error">{error}</div>}
    </section>
    {loading && <section className="results progressResults"><ProgressPanel stages={stages} /></section>}
    {result && page && <section className="results" aria-live="polite">
      <div className="reportHeader"><div><div className="muted">SCREENSHOT UX AUDIT</div><h2>{page.title}</h2><span className="sourceLabel">Source: uploaded screenshot</span></div><div className="reportOutcome"><span>Evidence-backed findings</span><strong>{findings.length}</strong><small>{evidenceCount} visible evidence items</small></div></div>
      <p className="reportSummary">This report is intentionally evidence-first. There is no composite UX score: each finding points to a specific page section and visible interface element so a prospective client can verify the problem themselves.</p>

      <div className="summary"><div className="card scoreCard"><div className="muted">AUDIT EVIDENCE</div><div className="metric">{evidenceCount}</div><p>Specific visible evidence items from the supplied screenshot.</p></div><div className="card"><div className="muted">High priority</div><div className="metric">{high}</div><p>Material UX problems</p></div><div className="card"><div className="muted">Medium priority</div><div className="metric">{medium}</div><p>Meaningful friction</p></div><div className="card"><div className="muted">Low priority</div><div className="metric">{low}</div><p>Secondary opportunities</p></div></div>

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
