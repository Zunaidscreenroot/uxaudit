"use client";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import type { AuditPage, AuditResult, AuditStage } from "@/lib/audit";

const PIPELINE = [
  { id: "capture", label: "Preparing screenshot" },
  { id: "analyse", label: "Running multi-model analysis" },
  { id: "quality", label: "Running AI quality check" },
  { id: "crops", label: "Preparing visual evidence" },
  { id: "enrich", label: "Applying UX standards" },
  { id: "complete", label: "Finalising evidence report" },
];

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function ProgressPanel({ stages }: { stages: Record<string, AuditStage> }) {
  const active = Object.values(stages).find((stage) => stage.status === "active");
  const activeIndex = Math.max(0, PIPELINE.findIndex((item) => item.id === active?.id));
  return <div className="progressCard" role="status" aria-live="polite">
    <div className="progressTop"><div><div className="muted">LIVE AUDIT PIPELINE</div><h2>{active?.label ?? "Preparing audit"}</h2><p>{active?.detail ?? "Starting the screenshot review…"}</p></div><div className="progressSpinner" aria-hidden="true" /></div>
    <div className="pipeline">{PIPELINE.map((item, index) => { const state = stages[item.id]; const done = index < activeIndex || state?.status === "complete"; const current = item.id === active?.id; return <div className={`pipelineStep ${done ? "done" : ""} ${current ? "current" : ""}`} key={item.id}><span className="pipelineIcon">{done ? "✓" : index + 1}</span><div><strong>{item.label}</strong><small>{done ? "Complete" : current ? "In progress" : "Waiting"}</small></div></div>; })}</div>
    <div className="pipelineNote">The screenshot is sent to multiple independent vision models in parallel. Their findings are then passed through an AI quality run that re-checks the strongest evidence against the screenshot, followed by focused visual crops for every selected evidence item.</div>
  </div>;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The screenshot could not be read in the browser.")); };
    image.src = url;
  });
}

async function prepareAuditUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  const image = await loadImage(file);
  const scale = Math.min(1, 1600 / image.naturalWidth, 10000 / image.naturalHeight);
  let width = Math.max(1, Math.round(image.naturalWidth * scale));
  let height = Math.max(1, Math.round(image.naturalHeight * scale));
  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare the screenshot for upload.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(image, 0, 0, width, height);
    const quality = Math.max(0.5, 0.82 - attempt * 0.05);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return new File([blob], file.name.replace(/\.(png|jpe?g|webp)$/i, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
    width = Math.max(900, Math.round(width * 0.85)); height = Math.max(560, Math.round(height * 0.85));
  }
  throw new Error("This screenshot is too large to upload safely. Please use a slightly smaller screenshot.");
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stages, setStages] = useState<Record<string, AuditStage>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const page = result?.pages[0] as AuditPage | undefined;

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]; if (!selected) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(selected);
    setError(""); setResult(null); setFile(selected); setPreview(url); setPreviewUrl(url);
  }
  function clearFile() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null); setPreview(""); setPreviewUrl(""); if (inputRef.current) inputRef.current.value = "";
  }
  async function runAudit(event: FormEvent) {
    event.preventDefault(); if (!file) { setError("Upload a screenshot first."); return; }
    setLoading(true); setError(""); setResult(null); setStages({});
    try {
      const upload = await prepareAuditUpload(file); const body = new FormData(); body.append("screenshot", upload);
      const response = await fetch("/api/audit", { method: "POST", body });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "Audit failed."); }
      if (!response.body) throw new Error("The audit server did not return a progress stream.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) { if (!line.trim()) continue; const eventData = JSON.parse(line) as { type: string; stage?: AuditStage; result?: AuditResult; error?: string }; if (eventData.type === "stage" && eventData.stage) setStages((previous) => ({ ...previous, [eventData.stage!.id]: eventData.stage! })); if (eventData.type === "result" && eventData.result) setResult(eventData.result); if (eventData.type === "error") throw new Error(eventData.error ?? "Audit failed."); }
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); } finally { setLoading(false); }
  }

  const findings = page?.findings ?? [];
  const evidenceCount = findings.reduce((count, finding) => count + finding.evidence.length, 0);
  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter((finding) => finding.severity === "medium").length;
  const low = findings.filter((finding) => finding.severity === "low").length;

  return <main className="shell">
    <nav className="nav"><div className="brandLockup"><div className="brand">UX Audit</div><div className="brandByline">by ScreenRoot</div></div><div className="navMeta">Evidence-first UX review</div></nav>
    <section className="hero"><div className="eyebrow">Screenshot → UX evidence</div><h1>Show clients exactly where the experience breaks.</h1><p className="lede">Upload a full-page website screenshot and get evidence-backed UX findings that a client can locate, understand, and act on.</p>
      <form className="auditForm" onSubmit={runAudit}><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectFile} hidden /><button className="uploadButton" type="button" onClick={() => inputRef.current?.click()} disabled={loading}>{file ? "Change screenshot" : "Upload screenshot"}</button><button className="auditButton" type="submit" disabled={loading || !file}>{loading ? "Running multi-model audit…" : "Run UX audit"}</button></form>
      {file && <div className="uploadInfo"><span><strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(1)} MB{file.size > MAX_UPLOAD_BYTES ? " · will be optimized before upload" : ""}</span><button type="button" onClick={clearFile} disabled={loading}>Remove</button></div>}
      {preview && !loading && !result && <div className="uploadPreview"><img src={preview} alt="Uploaded website screenshot preview" /></div>}
      {!file && <p className="uploadHint">PNG, JPG, JPEG or WebP · large screenshots are automatically optimized before upload · full-page desktop screenshots work best.</p>}
      {error && <div className="error">{error}</div>}
    </section>
    {loading && <section className="results progressResults"><ProgressPanel stages={stages} /></section>}
    {result && page && <section className="results" aria-live="polite">
      <div className="reportHeader"><div><div className="muted">SCREENSHOT UX AUDIT</div><h2>{page.title}</h2><span className="sourceLabel">Source: uploaded screenshot</span></div><div className="reportOutcome"><span>Evidence-backed findings</span><strong>{findings.length}</strong><small>{evidenceCount} visible evidence items</small></div></div>
      <p className="reportSummary">This report is intentionally evidence-first. There is no composite UX score: each finding points to a specific page section and visible interface element so a prospective client can verify the problem themselves.</p>
      <div className="summary"><div className="card scoreCard"><div className="muted">AUDIT EVIDENCE</div><div className="metric">{evidenceCount}</div><p>Specific visible evidence items from the supplied screenshot.</p></div><div className="card"><div className="muted">High priority</div><div className="metric">{high}</div><p>Material UX problems</p></div><div className="card"><div className="muted">Medium priority</div><div className="metric">{medium}</div><p>Meaningful friction</p></div><div className="card"><div className="muted">Low priority</div><div className="metric">{low}</div><p>Secondary opportunities</p></div></div>
      <div className="evidenceSection"><div className="sectionHeader"><div><div className="muted">CLIENT-READY UX EVIDENCE</div><h3>What is wrong, where it happens, and why it matters</h3></div><span className="pill">{findings.length} findings · {evidenceCount} evidence items</span></div>
        {findings.map((finding, findingIndex) => <article className="card regionFinding" key={finding.id}><div className="findingBody"><div className="findingTop"><div><div className="category">Finding {findingIndex + 1} · {finding.category}</div><h3>{finding.title}</h3></div><div className={`severity ${finding.severity}`}>{finding.severity}</div></div><p className="findingDescription">{finding.description}</p><div className="evidenceList">{finding.evidence.map((item, index) => <div className={`evidenceItem ${item.crop ? "hasCrop" : ""}`} key={`${finding.id}-${index}`}>
          {item.crop && <div className="evidenceCrop"><div className="cropLabel">CROPPED EVIDENCE · {item.section}</div><img src={item.crop} alt={`Cropped screenshot showing ${item.element}`} /></div>}
          <div className="evidenceCopy"><div className="evidenceMeta"><span className="evidenceNumber">Evidence {index + 1}</span><span className="evidenceSection">{item.section}</span></div><h4>{item.element}</h4><p>{item.detail}</p></div>
        </div>)}</div><div className="clientImpact"><strong>Why this matters</strong><p>{finding.uxPerspective.assessment}</p></div><p className="recommendation"><strong>Recommended redesign:</strong> {finding.recommendation}</p><div className="detailGrid"><section className="detailBlock"><h4>UX law / principle</h4><div className="lawName">{finding.uxPerspective.law}</div><p><strong>Definition:</strong> {finding.uxPerspective.definition}</p></section><section className="detailBlock"><h4>ScreenRoot design tasks</h4><ul>{finding.screenrootTasks.map((task) => <li key={task}>{task}</li>)}</ul></section><section className="detailBlock"><h4>Development tasks</h4><ul>{finding.devTasks.map((task) => <li key={task}>{task}</li>)}</ul></section></div></div></article>)}
        {!findings.length && <div className="card emptyState"><h3>No defensible evidence found</h3><p>The visual audit did not find a sufficiently clear UX issue to present as client-facing evidence. This is preferable to inventing findings.</p></div>}
      </div>
    </section>}
  </main>;
}
