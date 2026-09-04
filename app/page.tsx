"use client";
import { FormEvent, useMemo, useState } from "react";
import type { AuditPage, AuditResult, AuditStage } from "@/lib/audit";

const PIPELINE = [
  { id: "capture", label: "Taking page snapshot" },
  { id: "analyse", label: "Analysing screenshot" },
  { id: "highlight", label: "Highlighting evidence regions" },
  { id: "verify", label: "Analysing highlighted regions" },
  { id: "complete", label: "Finalising verified audit" },
];

function EvidenceMap({ page }: { page: AuditPage }) {
  const width = page.screenshotWidth || 1440;
  const height = page.screenshotHeight || 900;
  return <div className="screenshotStage"><img className="fullPageScreenshot" src={page.screenshot} width={width} height={height} alt={`Full-page screenshot of ${page.url} with verified evidence regions`} /></div>;
}

function ProgressPanel({ stages }: { stages: Record<string, AuditStage> }) {
  const active = Object.values(stages).find((stage) => stage.status === "active");
  const activeIndex = Math.max(0, PIPELINE.findIndex((item) => item.id === active?.id));
  const verification = stages.verify;
  const correction = stages.correct;
  const headline = correction?.status === "active" ? correction.label : active?.label ?? "Preparing audit";
  const detail = correction?.status === "active" ? correction.detail : active?.detail ?? "Starting the audit pipeline…";
  return <div className="progressCard" role="status" aria-live="polite">
    <div className="progressTop"><div><div className="muted">LIVE AUDIT PIPELINE</div><h2>{headline}</h2><p>{detail}</p></div><div className="progressSpinner" aria-hidden="true" /></div>
    <div className="pipeline">
      {PIPELINE.map((item, index) => {
        const state = stages[item.id];
        const done = index < activeIndex || state?.status === "complete" || (item.id === "verify" && verification?.status === "complete");
        const current = item.id === active?.id || (item.id === "verify" && correction?.status === "active");
        return <div className={`pipelineStep ${done ? "done" : ""} ${current ? "current" : ""}`} key={item.id}><span className="pipelineIcon">{done ? "✓" : index + 1}</span><div><strong>{item.label}</strong><small>{done ? "Complete" : current ? "In progress" : "Waiting"}</small></div></div>;
      })}
    </div>
    <div className="pipelineNote">The untouched screenshot is kept separate. Every new highlighted image is generated from that original, and the final image is shown only after region verification.</div>
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
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const eventData = JSON.parse(line) as { type: string; stage?: AuditStage; result?: AuditResult; error?: string };
          if (eventData.type === "stage" && eventData.stage) setStages((previous) => ({ ...previous, [eventData.stage!.id]: eventData.stage! }));
          if (eventData.type === "result" && eventData.result) setResult(eventData.result);
          if (eventData.type === "error") throw new Error(eventData.error ?? "Audit failed.");
        }
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setLoading(false); }
  }

  const evidence = useMemo(() => page?.findings.flatMap((finding) => finding.evidence) ?? [], [page]);
  const high = page?.findings.filter((finding) => finding.severity === "high").length ?? 0;
  const medium = page?.findings.filter((finding) => finding.severity === "medium").length ?? 0;
  const low = page?.findings.filter((finding) => finding.severity === "low").length ?? 0;
  const score = page ? Math.max(0, 100 - high * 15 - medium * 8 - low * 3) : 0;
  const summary = page ? `${page.findings.length} verified visually evidenced UX finding${page.findings.length === 1 ? "" : "s"} identified across the landing page.` : "";
  return <main className="shell">
    <nav className="nav"><div className="brandLockup"><div className="brand">UX Audit</div><div className="brandByline">by ScreenRoot</div></div><div className="navMeta">AI-assisted UX review</div></nav>
    <section className="hero"><div className="eyebrow">Website experience intelligence</div><h1>Find the friction before your users do.</h1><p className="lede">Enter a website and get a visual landing-page audit with highlighted evidence, UX laws, explanations, and implementation tasks.</p><form className="auditForm" onSubmit={runAudit}><input className="urlInput" type="text" inputMode="url" placeholder="https://yourwebsite.com" value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Website URL" /><button className="auditButton" type="submit" disabled={loading}>{loading ? "Running audit…" : "Run audit"}</button></form>{error && <div className="error">{error}</div>}</section>
    {loading && <section className="results progressResults"><ProgressPanel stages={stages} /></section>}
    {result && page && <section className="results" aria-live="polite">
      <div className="reportHeader"><div><div className="muted">LANDING PAGE AUDIT</div><h2>{page.title}</h2><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a></div><div className="reportScore"><span>UX score</span><strong>{score}</strong><small>/100</small></div></div><p className="reportSummary">{summary}</p>
      <div className="card screenshotCard"><div className="sectionHeader"><div><div className="muted">VISUAL EVIDENCE</div><h3>Verified landing page screenshot</h3></div><span className="pill">{evidence.length} verified highlighted region{evidence.length === 1 ? "" : "s"}</span></div><p className="screenshotHint">The final screenshot preserves the captured page at its native aspect ratio. Yellow regions are generated from the untouched main screenshot and returned only after AI verification.</p><EvidenceMap page={page} /></div>
      <div className="summary"><div className="card scoreCard"><div className="muted">PAGE SUMMARY</div><div className="metric">{score}/100</div><p>{summary}</p></div><div className="card"><div className="muted">High priority</div><div className="metric">{high}</div></div><div className="card"><div className="muted">Medium priority</div><div className="metric">{medium}</div></div><div className="card"><div className="muted">Low priority</div><div className="metric">{low}</div></div></div>
      <div className="regionExplanations"><div className="sectionHeader"><div><div className="muted">REGION-BY-REGION ANALYSIS</div><h3>What each highlighted region is saying</h3></div></div>{page.findings.map((finding) => <article className="card regionFinding" key={finding.id}><div className={`severity ${finding.severity}`}>{finding.severity}</div><div className="findingBody"><div className="findingTop"><div><div className="category">Category: {finding.category}</div><h3>{finding.title}</h3></div><div className="pill">{finding.uxPerspective.law}</div></div><p>{finding.description}</p><div className="regionList">{finding.evidence.map((item, index) => <div className="regionRow" key={`${item.marker}-${index}`}><span className="marker">{item.marker}</span><div><strong>Region {item.marker}: {item.label}</strong><p>{item.detail}</p></div></div>)}</div><div className="detailGrid"><section className="detailBlock"><h4>ScreenRoot / UX tasks</h4><ul>{finding.screenrootTasks.map((task) => <li key={task}>{task}</li>)}</ul></section><section className="detailBlock"><h4>Development tasks</h4><ul>{finding.devTasks.map((task) => <li key={task}>{task}</li>)}</ul></section><section className="detailBlock lawBlock"><h4>UX law / principle</h4><div className="lawName">{finding.uxPerspective.law}</div><p><strong>Definition:</strong> {finding.uxPerspective.definition}</p><p><strong>Assessment:</strong> {finding.uxPerspective.assessment}</p></section></div><p className="recommendation"><strong>Recommended change:</strong> {finding.recommendation}</p></div></article>)}</div>
    </section>}
  </main>;
}
