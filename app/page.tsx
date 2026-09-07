"use client";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import type { AuditPage, AuditResult, AuditStage } from "@/lib/audit";

const PIPELINE = [
  { id: "capture", label: "Prepare screenshot" },
  { id: "analyse", label: "Image → text" },
  { id: "quality", label: "Text → UX research" },
  { id: "markers", label: "Place evidence markers" },
  { id: "enrich", label: "Business context" },
  { id: "complete", label: "Finalise report" },
];
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MARKER_COLORS = ["pink", "purple", "orange", "blue", "green", "yellow", "violet", "teal", "rose", "cyan"];
type ReportTab = "findings" | "business" | "summary";
function markerColor(index: number) { return MARKER_COLORS[index % MARKER_COLORS.length]; }
function viewLabel(value?: string) { return value === "mobile" ? "Mobile responsive view" : value === "tablet" ? "Tablet view" : value === "desktop" ? "Desktop web view" : "View mode unknown"; }

function ProgressPanel({ stages }: { stages: Record<string, AuditStage> }) {
  const active = Object.values(stages).find((stage) => stage.status === "active");
  const activeIndex = Math.max(0, PIPELINE.findIndex((item) => item.id === active?.id));
  return <div className="progressCard" role="status" aria-live="polite">
    <div className="progressTop"><div><div className="eyebrow smallEyebrow">Live audit pipeline</div><h2>{active?.label ?? "Preparing audit"}</h2><p>{active?.detail ?? "Starting the screenshot review…"}</p></div><div className="progressSpinner" aria-hidden="true" /></div>
    <div className="pipeline">{PIPELINE.map((item, index) => { const state = stages[item.id]; const done = index < activeIndex || state?.status === "complete"; const current = item.id === active?.id; return <div className={`pipelineStep ${done ? "done" : ""} ${current ? "current" : ""}`} key={item.id}><span className="pipelineIcon">{done ? "✓" : index + 1}</span><div><strong>{item.label}</strong><small>{done ? "Complete" : current ? "In progress" : "Waiting"}</small></div></div>; })}</div>
    <div className="architecture"><div><span className="archNumber">01</span><strong>Image → text</strong><p>The vision model reads the screenshot, identifies the client and determines whether the visible experience is desktop, mobile responsive or tablet.</p></div><div className="archArrow">→</div><div><span className="archNumber">02</span><strong>Text → UX research</strong><p>A separate text model reviews those observations and adds UX laws, research context, funnel impact and KPI suggestions.</p></div></div>
  </div>;
}
function loadImage(file: File): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The screenshot could not be read in the browser.")); }; image.src = url; }); }
async function prepareAuditUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const image = await loadImage(file); const scale = Math.min(1, 1600 / image.naturalWidth, 10000 / image.naturalHeight);
  let width = Math.max(1, Math.round(image.naturalWidth * scale)); let height = Math.max(1, Math.round(image.naturalHeight * scale));
  for (let attempt = 0; attempt < 8; attempt++) { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d"); if (!context) throw new Error("Your browser could not prepare the screenshot for upload."); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(image, 0, 0, width, height); const quality = Math.max(0.5, 0.82 - attempt * 0.05); const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality)); if (blob && blob.size <= MAX_UPLOAD_BYTES) return new File([blob], file.name.replace(/\.(png|jpe?g|webp)$/i, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() }); width = Math.max(900, Math.round(width * 0.85)); height = Math.max(560, Math.round(height * 0.85)); }
  throw new Error("This screenshot is too large to upload safely. Please use a slightly smaller screenshot.");
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState(""); const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [stages, setStages] = useState<Record<string, AuditStage>>({});
  const [activeTab, setActiveTab] = useState<ReportTab>("findings"); const [activeFinding, setActiveFinding] = useState(0); const [reportGenerating, setReportGenerating] = useState(false); const [reportReady, setReportReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null); const findingRefs = useRef<Record<string, HTMLElement | null>>({}); const page = result?.pages[0] as AuditPage | undefined;
  function selectFile(event: ChangeEvent<HTMLInputElement>) { const selected = event.target.files?.[0]; if (!selected) return; if (previewUrl) URL.revokeObjectURL(previewUrl); const url = URL.createObjectURL(selected); setError(""); setResult(null); setReportReady(false); setActiveTab("findings"); setActiveFinding(0); setFile(selected); setPreview(url); setPreviewUrl(url); }
  function clearFile() { if (previewUrl) URL.revokeObjectURL(previewUrl); setFile(null); setPreview(""); setPreviewUrl(""); setReportReady(false); if (inputRef.current) inputRef.current.value = ""; }
  async function runAudit(event: FormEvent) {
    event.preventDefault(); if (!file) { setError("Upload a screenshot first."); return; }
    setLoading(true); setError(""); setResult(null); setReportReady(false); setStages({});
    try {
      const upload = await prepareAuditUpload(file); const body = new FormData(); body.append("screenshot", upload); const response = await fetch("/api/audit", { method: "POST", body });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "Audit failed."); }
      if (!response.body) throw new Error("The audit server did not return a progress stream.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { if (!line.trim()) continue; const eventData = JSON.parse(line) as { type: string; stage?: AuditStage; result?: AuditResult; error?: string }; if (eventData.type === "stage" && eventData.stage) setStages((previous) => ({ ...previous, [eventData.stage!.id]: eventData.stage! })); if (eventData.type === "result" && eventData.result) setResult(eventData.result); if (eventData.type === "error") throw new Error(eventData.error ?? "Audit failed."); } }
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); } finally { setLoading(false); }
  }
  async function generateReport() {
    if (!page?.id) { setError("This audit does not have a stored audit ID yet."); return; }
    setReportGenerating(true); setError("");
    try { const response = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId: page.id }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Could not generate the client report."); setReportReady(true); window.open(data.reportUrl, "_blank", "noopener,noreferrer"); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not generate the client report."); }
    finally { setReportGenerating(false); }
  }
  const findings = page?.findings ?? []; const high = findings.filter((f) => f.severity === "high").length; const medium = findings.filter((f) => f.severity === "medium").length; const low = findings.filter((f) => f.severity === "low").length;
  function focusFinding(index: number) { setActiveFinding(index); setActiveTab("findings"); const finding = findings[index]; if (finding) findingRefs.current[finding.id]?.scrollIntoView({ behavior: "smooth", block: "center" }); }

  return <main className="shell">
    <nav className="nav"><div className="brandLockup"><div className="brand">UX Audit</div><div className="brandByline">by ScreenRoot</div></div><div className="navMeta">Evidence-first UX review</div></nav>
    <section className="hero"><div className="eyebrow">Screenshot → UX evidence</div><h1>Show clients exactly where the experience breaks.</h1><p className="lede">Upload a full-page website screenshot and get evidence-backed UX findings, research context and business funnel recommendations. The report keeps the original screenshot intact and places a numbered marker on every analysed region.</p>
      <form className="auditForm" onSubmit={runAudit}><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectFile} hidden /><button className="uploadButton" type="button" onClick={() => inputRef.current?.click()} disabled={loading}>{file ? "Change screenshot" : "Upload screenshot"}</button><button className="auditButton" type="submit" disabled={loading || !file}>{loading ? "Running two-stage audit…" : "Run UX audit"}</button></form>
      {file && <div className="uploadInfo"><span><strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(1)} MB{file.size > MAX_UPLOAD_BYTES ? " · will be optimized before upload" : ""}</span><button type="button" onClick={clearFile} disabled={loading}>Remove</button></div>}
      {preview && !loading && !result && <div className="uploadPreview"><img src={preview} alt="Uploaded website screenshot preview" /></div>}
      {!file && <p className="uploadHint">PNG, JPG, JPEG or WebP · full-page desktop or mobile responsive screenshots work best.</p>}
      {error && <div className="error">{error}</div>}
    </section>
    {loading && <section className="results progressResults"><ProgressPanel stages={stages} /></section>}
    {result && page && <section className="results reportResults" aria-live="polite">
      <div className="reportHeader"><div><div className="reportKicker">Screenshot UX audit</div><h2>{page.title}</h2><span className="sourceLabel">Source: original uploaded screenshot · {page.screenshotWidth} × {page.screenshotHeight}px · <strong>{viewLabel(page.viewMode)}</strong></span></div><div className="reportOutcome"><span>Client-ready findings</span><strong>{findings.length}</strong><small>Every finding maps to a visible marker</small></div></div>
      <div className="reportActionBar"><div><strong>Turn this audit into a client-facing report</strong><span>Generate a branded presentation page with all insights, then export that exact page as a multi-page PDF.</span></div><button type="button" onClick={() => reportReady ? window.open(`/report/${encodeURIComponent(page.id || "")}`, "_blank", "noopener,noreferrer") : void generateReport()} disabled={reportGenerating || !page.id}>{reportGenerating ? "Generating report…" : reportReady ? "View report ↗" : "Generate report →"}</button></div>
      <div className="reportTabs" role="tablist" aria-label="Audit report sections"><button className={activeTab === "findings" ? "active" : ""} onClick={() => setActiveTab("findings")} role="tab" aria-selected={activeTab === "findings"}>UX Findings</button><button className={activeTab === "business" ? "active" : ""} onClick={() => setActiveTab("business")} role="tab" aria-selected={activeTab === "business"}>Business Analysis</button><button className={activeTab === "summary" ? "active" : ""} onClick={() => setActiveTab("summary")} role="tab" aria-selected={activeTab === "summary"}>Summary</button></div>
      {activeTab === "findings" && <div className="auditWorkspace">
        <div className="screenshotPanel card"><div className="panelHeader"><div><div className="reportKicker">Analysed screenshot</div><h3>Original screenshot</h3><p>Each colored dot marks the exact region used for its finding. Click a finding to highlight its dot.</p></div><span className="pill">{findings.length} markers</span></div>
          <div className="screenshotViewport"><div className="screenshotCanvas"><img src={page.screenshot} alt="Original analysed website screenshot" />{findings.map((finding, index) => { const marker = finding.evidence[0]?.marker; if (!marker) return null; return <button key={finding.id} className={`markerDot ${markerColor(index)} ${activeFinding === index ? "selected" : ""}`} style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} onClick={() => focusFinding(index)} aria-label={`Finding ${index + 1}: ${finding.title}`}>{index + 1}</button>; })}</div></div>
          <div className="markerLegend"><span>Markers</span>{findings.slice(0, 8).map((finding, index) => <button key={finding.id} onClick={() => focusFinding(index)} className={activeFinding === index ? "active" : ""}><i className={`legendDot ${markerColor(index)}`}>{index + 1}</i>{finding.title}</button>)}</div>
        </div>
        <div className="findingList"><div className="findingListHeader"><div><div className="reportKicker">UX findings</div><h3>What is wrong, why it matters, and what to change</h3></div><span className="pill">{high} high · {medium} medium · {low} low</span></div>
          {findings.map((finding, findingIndex) => <article className={`findingCard card ${activeFinding === findingIndex ? "selectedFinding" : ""}`} key={finding.id} ref={(node) => { findingRefs.current[finding.id] = node; }} onClick={() => setActiveFinding(findingIndex)}>
            <div className="findingCardMain"><div className={`findingNumber ${markerColor(findingIndex)}`}>{findingIndex + 1}</div><div className="findingBody"><div className="findingTitleRow"><div><h3>{finding.title}</h3><span className="findingSection">{finding.category} · {finding.evidence[0]?.section ?? "Page section"}</span></div><span className={`severity ${finding.severity}`}>{finding.severity}</span></div><p className="findingDescription">{finding.description}</p><div className="findingEvidence"><span className={`evidenceDot ${markerColor(findingIndex)}`}>{findingIndex + 1}</span><div><strong>{finding.evidence[0]?.element ?? "Analysed region"}</strong><span>{finding.evidence[0]?.detail ?? "Visible evidence on the original screenshot."}</span></div></div></div></div>
            <div className="businessMini"><div><span>Business impact</span><p>{finding.businessAnalysis.impact}</p><em>Affects: {finding.businessAnalysis.kpi}</em></div><span className="chevron">⌄</span></div>
            <div className="findingDetails"><section className="insightBlock"><div className="blockLabel">UX core + research</div><div className="lawName">{finding.uxPerspective.law}</div><p><strong>Definition:</strong> {finding.uxPerspective.definition}</p><p><strong>Why it applies:</strong> {finding.uxPerspective.assessment}</p><p><strong>Research context:</strong> {finding.uxPerspective.researchContext}</p></section><section className="insightBlock businessBlock"><div className="blockLabel">Business analysis</div><div className="businessStage">{finding.businessAnalysis.funnelStage}</div><p><strong>Impact:</strong> {finding.businessAnalysis.impact}</p><p><strong>KPI at risk:</strong> {finding.businessAnalysis.kpi}</p><p><strong>Mechanism:</strong> {finding.businessAnalysis.mechanism}</p><div className="suggestions"><strong>Suggestions to improve the KPI</strong><ul>{finding.businessAnalysis.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul></div></section></div>
            <div className="recommendation"><strong>Recommended redesign:</strong> {finding.recommendation}</div>
          </article>)}
          {!findings.length && <div className="card emptyState"><h3>No defensible evidence found</h3><p>The visual audit did not find a sufficiently clear UX issue to present as client-facing evidence.</p></div>}
        </div>
      </div>}
      {activeTab === "business" && <div className="tabPanel"><div className="sectionHeader"><div><div className="reportKicker">Business analysis</div><h3>How design friction can influence the funnel</h3><p>Directional hypotheses only — these are opportunities to validate with analytics, experiments or research.</p></div></div><div className="businessGrid">{findings.map((finding, index) => <article className="businessCard card" key={finding.id} onClick={() => focusFinding(index)}><div className="businessCardTop"><span className={`findingNumber small ${markerColor(index)}`}>{index + 1}</span><span className={`severity ${finding.severity}`}>{finding.severity}</span></div><h3>{finding.title}</h3><div className="businessStage">{finding.businessAnalysis.funnelStage}</div><p><strong>Impact:</strong> {finding.businessAnalysis.impact}</p><p><strong>KPI:</strong> {finding.businessAnalysis.kpi}</p><p><strong>Mechanism:</strong> {finding.businessAnalysis.mechanism}</p><div className="suggestions"><strong>Improve the KPI</strong><ul>{finding.businessAnalysis.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul></div></article>)}</div></div>}
      {activeTab === "summary" && <div className="tabPanel summaryPanel"><div className="summaryHero card"><div><div className="reportKicker">Audit summary</div><h3>Design opportunities worth discussing with the client</h3><p>{findings.length ? "The audit found visible experience patterns that can affect clarity, trust, usability and progression through the funnel." : "No sufficiently defensible issues were found in the supplied screenshot."}</p></div><div className="summaryMetric"><strong>{findings.length}</strong><span>findings</span></div></div><div className="summary"><div className="card scoreCard"><div className="muted">AUDIT FINDINGS</div><div className="metric">{findings.length}</div><p>Evidence-backed opportunities ready for client discussion.</p></div><div className="card"><div className="muted">High priority</div><div className="metric">{high}</div><p>Material friction</p></div><div className="card"><div className="muted">Medium priority</div><div className="metric">{medium}</div><p>Meaningful friction</p></div><div className="card"><div className="muted">Low priority</div><div className="metric">{low}</div><p>Secondary opportunities</p></div></div><div className="architecture"><div><span className="archNumber">01</span><strong>Image → text</strong><p>The vision model identifies what is visibly happening and places markers on the original screenshot.</p></div><div className="archArrow">→</div><div><span className="archNumber">02</span><strong>Text → UX research</strong><p>The separate text model adds UX laws, research context and business-funnel implications without inventing analytics.</p></div></div></div>}
    </section>}
  </main>;
}
