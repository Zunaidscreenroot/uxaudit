"use client";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import type { AuditPage, AuditResult, AuditStage } from "@/lib/audit";

const PIPELINE = [
  { id: "capture", label: "Prepare screenshots" },
  { id: "analyse", label: "Image → text" },
  { id: "quality", label: "Text → UX research" },
  { id: "markers", label: "Place evidence markers" },
  { id: "enrich", label: "Business context" },
  { id: "complete", label: "Finalise report" },
];
const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;
const MAX_FILES = 4;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MARKER_COLORS = ["pink", "purple", "orange", "blue", "green", "yellow", "violet", "teal", "rose", "cyan"];
type ReportTab = "findings" | "business" | "summary";
function markerColor(index: number) { return MARKER_COLORS[index % MARKER_COLORS.length]; }
function viewLabel(value?: string) { return value === "mobile" ? "Mobile responsive view" : value === "tablet" ? "Tablet view" : value === "desktop" ? "Desktop web view" : "View mode unknown"; }
function pageNameFromFilename(filename: string) { const stem = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); return stem.replace(/\b\w/g, (char) => char.toUpperCase()) || "Page"; }

function ProgressPanel({ stages }: { stages: Record<string, AuditStage> }) {
  const active = Object.values(stages).find((stage) => stage.status === "active");
  const activeIndex = Math.max(0, PIPELINE.findIndex((item) => item.id === active?.id));
  return <div className="progressCard" role="status" aria-live="polite">
    <div className="progressTop"><div><div className="eyebrow smallEyebrow">Live multi-page audit</div><h2>{active?.label ?? "Preparing audit"}</h2><p>{active?.detail ?? "Starting the screenshot review…"}</p></div><div className="progressSpinner" aria-hidden="true" /></div>
    <div className="pipeline">{PIPELINE.map((item, index) => { const state = stages[item.id]; const done = index < activeIndex || state?.status === "complete"; const current = item.id === active?.id; return <div className={`pipelineStep ${done ? "done" : ""} ${current ? "current" : ""}`} key={item.id}><span className="pipelineIcon">{done ? "✓" : index + 1}</span><div><strong>{item.label}</strong><small>{done ? "Complete" : current ? "In progress" : "Waiting"}</small></div></div>; })}</div>
    <div className="architecture"><div><span className="archNumber">01</span><strong>Each file becomes a page</strong><p>landing_page.png becomes Landing Page, about_us.png becomes About Us, and every page stays inside the same audit run.</p></div><div className="archArrow">→</div><div><span className="archNumber">02</span><strong>One audit, one timestamp</strong><p>All uploaded pages are analysed, stored together and later shown as page tabs and separate report sections.</p></div></div>
  </div>;
}
function loadImage(file: File): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The screenshot could not be read in the browser.")); }; image.src = url; }); }
async function prepareAuditUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const image = await loadImage(file); const scale = Math.min(1, 1600 / image.naturalWidth, 10000 / image.naturalHeight);
  let width = Math.max(1, Math.round(image.naturalWidth * scale)); let height = Math.max(1, Math.round(image.naturalHeight * scale));
  for (let attempt = 0; attempt < 10; attempt++) { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d"); if (!context) throw new Error("Your browser could not prepare the screenshot for upload."); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(image, 0, 0, width, height); const quality = Math.max(0.48, 0.82 - attempt * 0.04); const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality)); if (blob && blob.size <= MAX_UPLOAD_BYTES) return new File([blob], file.name.replace(/\.(png|jpe?g|webp)$/i, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() }); width = Math.max(900, Math.round(width * 0.86)); height = Math.max(560, Math.round(height * 0.86)); }
  throw new Error(`Could not reduce ${file.name} to a safe upload size.`);
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stages, setStages] = useState<Record<string, AuditStage>>({});
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<ReportTab>("findings");
  const [activeFinding, setActiveFinding] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const findingRefs = useRef<Record<string, HTMLElement | null>>({});

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    if (selected.length > MAX_FILES) { setError(`Please select no more than ${MAX_FILES} screenshots.`); return; }
    setError(""); setResult(null); setActivePageIndex(0); setActiveFinding(0); setActiveTab("findings"); setFiles(selected);
  }
  function clearFiles() { setFiles([]); setResult(null); setError(""); if (inputRef.current) inputRef.current.value = ""; }
  function removeFile(index: number) { setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index)); if (inputRef.current) inputRef.current.value = ""; }

  async function runAudit(event: FormEvent) {
    event.preventDefault();
    if (!files.length) { setError("Upload at least one screenshot first."); return; }
    if (files.length > MAX_FILES) { setError(`Please upload no more than ${MAX_FILES} screenshots.`); return; }
    setLoading(true); setError(""); setResult(null); setStages({}); setActivePageIndex(0); setActiveFinding(0);
    try {
      const uploads = await Promise.all(files.map(prepareAuditUpload));
      const total = uploads.reduce((sum, file) => sum + file.size, 0);
      if (total > MAX_TOTAL_BYTES) throw new Error("The combined upload is still above 4 MB. Please use smaller screenshots or fewer pages.");
      const body = new FormData(); uploads.forEach((file) => body.append("screenshots", file));
      const response = await fetch("/api/audit", { method: "POST", body });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "Audit failed."); }
      if (!response.body) throw new Error("The audit server did not return a progress stream.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const eventData = JSON.parse(line) as { type: string; stage?: AuditStage; result?: AuditResult; error?: string };
          if (eventData.type === "stage" && eventData.stage) setStages((previous) => ({ ...previous, [eventData.stage!.id]: eventData.stage! }));
          if (eventData.type === "result" && eventData.result) setResult(eventData.result);
          if (eventData.type === "error") throw new Error(eventData.error ?? "Audit failed.");
        }
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); } finally { setLoading(false); }
  }

  const page = result?.pages[activePageIndex] as AuditPage | undefined;
  const findings = page?.findings ?? [];
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  const low = findings.filter((f) => f.severity === "low").length;
  function focusFinding(index: number) { setActiveFinding(index); setActiveTab("findings"); const finding = findings[index]; if (finding) findingRefs.current[finding.id]?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function selectPage(index: number) { setActivePageIndex(index); setActiveFinding(0); setActiveTab("findings"); }

  return <main className="shell">
    <nav className="nav"><div className="brandLockup"><div className="brand">UX Audit</div><div className="brandByline">by ScreenRoot</div></div><div className="navMeta">Evidence-first UX review</div></nav>
    <section className="hero"><div className="eyebrow">Screenshot → UX evidence</div><h1>Audit an entire website run, page by page.</h1><p className="lede">Upload up to four full-page screenshots at once. The filename becomes the page name, every page is analysed separately, and the whole set is stored under one timestamped audit run.</p>
      <form className="auditForm" onSubmit={runAudit}><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectFiles} hidden multiple /><button className="uploadButton" type="button" onClick={() => inputRef.current?.click()} disabled={loading}>{files.length ? "Add / change screenshots" : "Upload screenshots"}</button><button className="auditButton" type="submit" disabled={loading || !files.length}>{loading ? "Running multi-page audit…" : `Run audit${files.length ? ` · ${files.length} page${files.length === 1 ? "" : "s"}` : ""}`}</button></form>
      {files.length > 0 && <div className="uploadInfo" style={{ display: "block" }}><div style={{ display: "grid", gap: 8 }}>{files.map((file, index) => <div key={`${file.name}-${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><span><strong>{pageNameFromFilename(file.name)}</strong> <span style={{ color: "#777" }}>· {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span></span><button type="button" onClick={() => removeFile(index)} disabled={loading}>Remove</button></div>)}</div><div style={{ marginTop: 9, color: "#777", fontSize: 11 }}>Page names come from filenames. Example: <strong>landing_page.png</strong> → <strong>Landing Page</strong>.</div></div>}
      {!files.length && <p className="uploadHint">PNG, JPG, JPEG or WebP · up to {MAX_FILES} pages · keep the combined upload under 4 MB for reliable Netlify processing.</p>}
      {error && <div className="error">{error}</div>}
    </section>
    {loading && <section className="results progressResults"><ProgressPanel stages={stages} /></section>}
    {result && page && <section className="results reportResults" aria-live="polite">
      <div className="reportHeader"><div><div className="reportKicker">Screenshot UX audit · {result.pages.length} pages</div><h2>{page.title}</h2><span className="sourceLabel">{page.clientName} · {page.screenshotWidth} × {page.screenshotHeight}px · <strong>{viewLabel(page.viewMode)}</strong></span></div><div className="reportOutcome"><span>Client-ready findings</span><strong>{findings.length}</strong><small>{high} high priority on this page</small></div></div>
      <div className="reportTabs" role="tablist" aria-label="Audit pages">{result.pages.map((item, index) => { const itemHigh = item.findings.filter((finding) => finding.severity === "high").length; return <button key={`${item.title}-${index}`} className={activePageIndex === index ? "active" : ""} onClick={() => selectPage(index)} role="tab" aria-selected={activePageIndex === index}><span>{item.title}</span><small>{itemHigh} high · {item.findings.length} total</small></button>; })}</div>
      <div className="reportTabs" role="tablist" aria-label="Audit report sections"><button className={activeTab === "findings" ? "active" : ""} onClick={() => setActiveTab("findings")} role="tab" aria-selected={activeTab === "findings"}>UX Findings</button><button className={activeTab === "business" ? "active" : ""} onClick={() => setActiveTab("business")} role="tab" aria-selected={activeTab === "business"}>Business Analysis</button><button className={activeTab === "summary" ? "active" : ""} onClick={() => setActiveTab("summary")} role="tab" aria-selected={activeTab === "summary"}>Page Summary</button></div>
      {activeTab === "findings" && <div className="auditWorkspace">
        <div className="screenshotPanel card"><div className="panelHeader"><div><div className="reportKicker">{page.title}</div><h3>Original screenshot</h3><p>Each colored dot maps to the exact evidence region for a finding on this page.</p></div><span className="pill">{findings.length} markers</span></div>
          <div className="screenshotViewport"><div className="screenshotCanvas"><img src={page.screenshot} alt={`Original ${page.title} screenshot`} />{findings.map((finding, index) => { const marker = finding.evidence[0]?.marker; if (!marker) return null; return <button key={finding.id} className={`markerDot ${markerColor(index)} ${activeFinding === index ? "selected" : ""}`} style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} onClick={() => focusFinding(index)} aria-label={`Finding ${index + 1}: ${finding.title}`}>{index + 1}</button>; })}</div></div>
          <div className="markerLegend"><span>Markers</span>{findings.slice(0, 10).map((finding, index) => <button key={finding.id} onClick={() => focusFinding(index)} className={activeFinding === index ? "active" : ""}><i className={`legendDot ${markerColor(index)}`}>{index + 1}</i>{finding.title}</button>)}</div>
        </div>
        <div className="findingList"><div className="findingListHeader"><div><div className="reportKicker">{page.title} · UX findings</div><h3>What is wrong, why it matters, and what to change</h3></div><span className="pill">{high} high · {medium} medium · {low} low</span></div>
          {findings.map((finding, findingIndex) => <article className={`findingCard card ${activeFinding === findingIndex ? "selectedFinding" : ""}`} key={finding.id} ref={(node) => { findingRefs.current[finding.id] = node; }} onClick={() => setActiveFinding(findingIndex)}>
            <div className="findingCardMain"><div className={`findingNumber ${markerColor(findingIndex)}`}>{findingIndex + 1}</div><div className="findingBody"><div className="findingTitleRow"><div><h3>{finding.title}</h3><span className="findingSection">{finding.category} · {finding.evidence[0]?.section ?? "Page section"}</span></div><span className={`severity ${finding.severity}`}>{finding.severity}</span></div><p className="findingDescription">{finding.description}</p><div className="findingEvidence"><span className={`evidenceDot ${markerColor(findingIndex)}`}>{findingIndex + 1}</span><div><strong>{finding.evidence[0]?.element ?? "Analysed region"}</strong><span>{finding.evidence[0]?.detail ?? "Visible evidence on the original screenshot."}</span></div></div></div></div>
            <div className="businessMini"><div><span>Business impact</span><p>{finding.businessAnalysis.impact}</p><em>Affects: {finding.businessAnalysis.kpi}</em></div><span className="chevron">⌄</span></div>
            <div className="findingDetails"><section className="insightBlock"><div className="blockLabel">UX core + research</div><div className="lawName">{finding.uxPerspective.law}</div><p><strong>Definition:</strong> {finding.uxPerspective.definition}</p><p><strong>Why it applies:</strong> {finding.uxPerspective.assessment}</p><p><strong>Research context:</strong> {finding.uxPerspective.researchContext}</p></section><section className="insightBlock businessBlock"><div className="blockLabel">Business analysis</div><div className="businessStage">{finding.businessAnalysis.funnelStage}</div><p><strong>Impact:</strong> {finding.businessAnalysis.impact}</p><p><strong>KPI at risk:</strong> {finding.businessAnalysis.kpi}</p><p><strong>Mechanism:</strong> {finding.businessAnalysis.mechanism}</p><div className="suggestions"><strong>Suggestions to improve the KPI</strong><ul>{finding.businessAnalysis.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul></div></section></div>
            <div className="recommendation"><strong>Recommended redesign:</strong> {finding.recommendation}</div>
          </article>)}
          {!findings.length && <div className="card emptyState"><h3>No defensible evidence found</h3><p>The visual audit did not find a sufficiently clear UX issue to present as client-facing evidence on this page.</p></div>}
        </div>
      </div>}
      {activeTab === "business" && <div className="tabPanel"><div className="sectionHeader"><div><div className="reportKicker">{page.title} · Business analysis</div><h3>How design friction can influence the funnel</h3><p>Directional hypotheses only — validate these with analytics, experiments or research.</p></div></div><div className="businessGrid">{findings.map((finding, index) => <article className="businessCard card" key={finding.id} onClick={() => focusFinding(index)}><div className="businessCardTop"><span className={`findingNumber small ${markerColor(index)}`}>{index + 1}</span><span className={`severity ${finding.severity}`}>{finding.severity}</span></div><h3>{finding.title}</h3><div className="businessStage">{finding.businessAnalysis.funnelStage}</div><p><strong>Impact:</strong> {finding.businessAnalysis.impact}</p><p><strong>KPI:</strong> {finding.businessAnalysis.kpi}</p><p><strong>Mechanism:</strong> {finding.businessAnalysis.mechanism}</p><div className="suggestions"><strong>Improve the KPI</strong><ul>{finding.businessAnalysis.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul></div></article>)}</div></div>}
      {activeTab === "summary" && <div className="tabPanel summaryPanel"><div className="summaryHero card"><div><div className="reportKicker">Page summary</div><h3>{page.title}</h3><p>{findings.length ? `This page has ${high} high-priority, ${medium} medium-priority and ${low} low-priority findings. Review the evidence against the original screenshot before making design decisions.` : "No sufficiently defensible issues were found in the supplied screenshot."}</p></div><div className="summaryMetric"><strong>{findings.length}</strong><span>findings</span></div></div><div className="summary"><div className="card scoreCard"><div className="muted">HIGH PRIORITY</div><div className="metric">{high}</div><p>Material friction for this page.</p></div><div className="card"><div className="muted">MEDIUM PRIORITY</div><div className="metric">{medium}</div><p>Meaningful opportunities.</p></div><div className="card"><div className="muted">LOW PRIORITY</div><div className="metric">{low}</div><p>Secondary opportunities.</p></div><div className="card"><div className="muted">VIEW MODE</div><div className="metric" style={{ fontSize: 22 }}>{viewLabel(page.viewMode).replace(" view", "")}</div><p>Detected from visible UI cues.</p></div></div></div>}
    </section>}
  </main>;
}
