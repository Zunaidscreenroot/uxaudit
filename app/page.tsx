"use client";

import { FormEvent, useEffect, useState } from "react";

type Connection = { connected: boolean; provider: string; label?: string; error?: string; checkedAt?: string };
type EntryMode = "website" | "screenshot";
type AuditMode = "desktop" | "mobile";
type UploadMode = "auto" | AuditMode;
type AuditStage = { id: string; label: string; detail: string; status: "active" | "complete" | "failed" };
type Finding = {
  id?: string;
  severity?: string;
  category?: string;
  title: string;
  description: string;
  recommendation: string;
  evidence?: Array<{ element?: string; detail?: string; section?: string }>;
  uxPerspective?: { law?: string; definition?: string; assessment?: string; researchContext?: string };
  businessAnalysis?: { funnelStage?: string; impact?: string; kpi?: string; mechanism?: string; suggestions?: string[] };
};
type AuditPage = {
  title: string;
  url: string;
  screenshot: string;
  screenshotWidth: number;
  screenshotHeight: number;
  findings: Finding[];
  auditMode?: AuditMode;
};
type PreparedScreenshot = { dataUrl: string; auditMode: AuditMode; originalWidth: number; originalHeight: number };

async function prepareScreenshot(file: File, preferredMode: UploadMode): Promise<PreparedScreenshot> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error("Upload a PNG, JPG or WebP screenshot.");
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("This image is over 25 MB. Export a smaller screenshot and try again.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const auditMode: AuditMode = preferredMode === "auto"
      ? (bitmap.width <= 768 ? "mobile" : "desktop")
      : preferredMode;
    let scale = Math.min(1, 2200 / bitmap.width, 18000 / bitmap.height);

    for (let pass = 0; pass < 7; pass += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.min(18000, Math.round(bitmap.height * scale)));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare the screenshot for upload.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.86, 0.78, 0.70, 0.62, 0.54]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= 2.25 * 1024 * 1024) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not encode the screenshot."));
            reader.onerror = () => reject(new Error("Could not encode the screenshot."));
            reader.readAsDataURL(blob);
          });
          return { dataUrl, auditMode, originalWidth: bitmap.width, originalHeight: bitmap.height };
        }
      }
      scale *= 0.78;
    }
    throw new Error("Could not compress this image enough for a safe upload. Try a shorter page screenshot.");
  } finally {
    bitmap.close();
  }
}

export default function Home() {
  const [mode, setMode] = useState<EntryMode>("website");
  const [url, setUrl] = useState("");
  const [loadingWebsite, setLoadingWebsite] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [recentIa, setRecentIa] = useState<any>(null);

  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState("");
  const [uploadMode, setUploadMode] = useState<UploadMode>("auto");
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditStages, setAuditStages] = useState<AuditStage[]>([]);
  const [auditStatus, setAuditStatus] = useState("");
  const [auditError, setAuditError] = useState("");
  const [auditResult, setAuditResult] = useState<AuditPage | null>(null);
  const [auditId, setAuditId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/openrouter-status", { cache: "no-store" });
        const data = await response.json();
        if (!cancelled) setConnection(data);
      } catch (e) {
        if (!cancelled) setConnection({ connected: false, provider: "OpenRouter", error: e instanceof Error ? e.message : "Could not check OpenRouter connection." });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = localStorage.getItem("uxaudit-current-ia-session");
        if (!id) return;
        const response = await fetch("/api/ia-session?id=" + encodeURIComponent(id), { cache: "no-store" });
        const data = await response.json();
        if (response.ok && data.session && !cancelled) setRecentIa(data.session);
        else if (!response.ok && response.status === 404) localStorage.removeItem("uxaudit-current-ia-session");
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!screenshotPreview) return;
    return () => URL.revokeObjectURL(screenshotPreview);
  }, [screenshotPreview]);

  function startWebsite(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const typed = url.trim();
      const parsed = new URL(/^https?:\/\//i.test(typed) ? typed : "https://" + typed);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      setLoadingWebsite(true);
      window.location.href = "/site-map?url=" + encodeURIComponent(parsed.origin);
    } catch {
      setError("Enter a valid website URL, for example https://example.com");
    }
  }

  function selectScreenshot(file: File | null) {
    setScreenshotFile(file);
    setAuditResult(null);
    setAuditId("");
    setAuditStages([]);
    setAuditError("");
    setAuditStatus("");
    setError("");
    setScreenshotPreview(file ? URL.createObjectURL(file) : "");
  }

  async function auditUploadedScreenshot() {
    if (!screenshotFile || auditRunning) return;
    setAuditRunning(true);
    setAuditError("");
    setAuditResult(null);
    setAuditId("");
    setAuditStages([{ id: "prepare", label: "Prepare screenshot", detail: "Validating and compressing the image while preserving its layout and proportions.", status: "active" }]);
    setAuditStatus("Preparing your screenshot for AI analysis.");

    try {
      const prepared = await prepareScreenshot(screenshotFile, uploadMode);
      setAuditStages([{ id: "prepare", label: "Screenshot prepared", detail: `${prepared.originalWidth} × ${prepared.originalHeight}px source image · ${prepared.auditMode} audit context · compressed for upload.`, status: "complete" }]);
      setAuditStatus("Sending the attached image to OpenRouter for visual analysis.");

      const response = await fetch("/api/audit-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "upload",
          title: screenshotFile.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Uploaded screenshot",
          projectName: "Screenshot audit",
          screenshot: prepared.dataUrl,
          auditMode: prepared.auditMode,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not start the screenshot audit.");
      }
      if (!response.body) throw new Error("The AI audit stream was unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: { page?: AuditPage; auditId?: string } | null = null;

      const handleFrame = (frame: string) => {
        const line = frame.split("\n").find((item) => item.startsWith("data: "));
        if (!line) return;
        const event = JSON.parse(line.slice(6));
        if (event.type === "stage") {
          setAuditStages((previous) => [...previous.filter((stage) => stage.id !== event.stage.id), event.stage]);
          setAuditStatus(event.stage.detail || event.stage.label);
        } else if (event.type === "result") {
          result = event.payload;
        } else if (event.type === "error") {
          throw new Error(event.error || "The AI model could not analyse this screenshot.");
        }
      };

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) handleFrame(frame);
      }
      if (buffer.trim()) handleFrame(buffer);

      if (!result?.page) throw new Error("The AI audit finished without returning a report. Please try again.");
      setAuditResult(result.page);
      setAuditId(result.auditId || "");
      setAuditStages((previous) => previous.map((stage) => stage.status === "active" ? { ...stage, status: "complete" } : stage));
      setAuditStatus("AI analysis complete. The report contains findings generated from your uploaded image.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Screenshot audit failed.";
      setAuditError(message);
      setAuditStatus("Screenshot audit stopped.");
      setAuditStages((previous) => previous.map((stage) => stage.status === "active" ? { ...stage, status: "failed", detail: message } : stage));
    } finally {
      setAuditRunning(false);
    }
  }

  const severityCount = (severity: string) => auditResult?.findings?.filter((finding) => (finding.severity || "").toLowerCase() === severity).length || 0;

  return (
    <main className="homeShell">
      <style>{`
        * { box-sizing: border-box; }
        .homeShell { min-height: 100vh; background: #f4f6f9; color: #182438; padding: 24px clamp(16px, 4vw, 64px) 60px; font-family: Inter, Arial, sans-serif; }
        .homeNav { max-width: 1240px; margin: auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 4px 0 20px; border-bottom: 1px solid #e0e6ee; flex-wrap: wrap; }
        .homeBrand { font-size: 20px; letter-spacing: -.5px; font-weight: 900; color: #172943; }
        .homeNavActions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .connectionPill { color: #41516b; background: #fff; border: 1px solid #dfe5ed; border-radius: 9px; padding: 9px 12px; font-size: 12px; font-weight: 750; }
        .connectionPill.connected { color: #17663a; background: #eaf7ef; border-color: #b9dfc6; }
        .connectionPill.failed { color: #a12626; }
        .checkBtn { border: 1px solid #dfe5ed; border-radius: 9px; padding: 9px 12px; background: #fff; color: #283750; font-size: 12px; cursor: pointer; }
        .homeContent { max-width: 1080px; margin: 62px auto 0; }
        .eyebrow { font-size: 11px; font-weight: 850; letter-spacing: 1.8px; color: #657692; text-transform: uppercase; }
        .heroTitle { max-width: 900px; margin: 14px 0 16px; font-size: clamp(38px, 6.7vw, 68px); line-height: 1.02; letter-spacing: -2.8px; font-weight: 850; color: #152641; }
        .heroCopy { max-width: 760px; color: #66758b; font-size: 16px; line-height: 1.75; margin: 0; }
        .sourceGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 32px; }
        .sourceCard { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 9px; background: #fff; border: 1px solid #dce3ed; border-radius: 16px; padding: 22px; cursor: pointer; color: #182438; transition: border-color .15s, box-shadow .15s, transform .15s; }
        .sourceCard:hover { border-color: #91a9ce; transform: translateY(-1px); }
        .sourceCard.active { border-color: #284d83; box-shadow: 0 0 0 2px #dce7f7; background: #fbfdff; }
        .sourceNumber { font-size: 10px; color: #667791; font-weight: 850; letter-spacing: 1.3px; }
        .sourceIcon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; background: #edf2f8; color: #234777; font-size: 21px; font-weight: 800; }
        .sourceCard h2 { margin: 3px 0 0; font-size: 20px; letter-spacing: -.5px; }
        .sourceCard p { margin: 0; max-width: 440px; font-size: 13px; line-height: 1.6; color: #66758b; }
        .sourceAction { margin-top: 4px; font-size: 12px; font-weight: 850; color: #284d83; }
        .entryPanel { margin-top: 16px; border: 1px solid #dfe5ed; border-radius: 16px; padding: 22px; background: #fff; }
        .panelTitle { font-size: 18px; margin: 0 0 7px; letter-spacing: -.3px; }
        .panelCopy { color: #68778c; font-size: 13px; line-height: 1.6; margin: 0 0 17px; }
        .urlForm { display: flex; gap: 10px; flex-wrap: wrap; }
        .urlInput { flex: 1 1 320px; min-width: 0; padding: 15px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; background: #fff; color: #16243a; }
        .primaryBtn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 10px; padding: 14px 18px; background: #1b3559; color: #fff; font-size: 13px; font-weight: 850; text-decoration: none; cursor: pointer; }
        .primaryBtn:disabled { opacity: .45; cursor: not-allowed; }
        .secondaryBtn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid #d1dae7; border-radius: 10px; padding: 11px 14px; background: #fff; color: #263c5b; font-size: 12px; font-weight: 800; cursor: pointer; }
        .dropZone { position: relative; display: flex; align-items: center; gap: 15px; padding: 20px; border: 1.5px dashed #a8b9d0; border-radius: 12px; background: #f9fbfe; cursor: pointer; }
        .dropZone:hover { border-color: #466b9f; background: #f3f7fd; }
        .dropIcon { display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px; border-radius: 12px; background: #e8eef8; color: #244b7e; font-size: 22px; }
        .dropTitle { font-size: 14px; font-weight: 850; color: #1d2e49; }
        .dropHint { margin-top: 5px; color: #6e7d92; font-size: 12px; line-height: 1.5; }
        .visuallyHidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        .filePreview { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); align-items: center; gap: 16px; margin-top: 14px; padding: 13px; border: 1px solid #dfe6ef; border-radius: 12px; background: #fbfcfe; }
        .filePreview img { display: block; width: 100%; max-height: 190px; object-fit: contain; border: 1px solid #e3e8ef; border-radius: 8px; background: #edf1f6; }
        .fileName { overflow-wrap: anywhere; font-weight: 800; font-size: 13px; }
        .fileMeta { margin-top: 6px; color: #748198; font-size: 11px; line-height: 1.5; }
        .modePicker { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 17px 0; }
        .modeOption { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #dbe3ed; border-radius: 8px; background: #fff; color: #52637b; padding: 8px 11px; font-size: 11px; font-weight: 800; cursor: pointer; }
        .modeOption.active { border-color: #456b9d; background: #eef4fc; color: #1f467a; }
        .inlineError { padding: 11px 13px; color: #9d2525; background: #fff1f1; border: 1px solid #f1c4c4; border-radius: 9px; font-size: 12px; line-height: 1.5; margin: 12px 0 0; }
        .noteText { color: #748197; font-size: 11px; line-height: 1.6; margin: 11px 0 0; }
        .recentPanel { margin-top: 18px; padding: 15px 17px; background: #fff; border: 1px solid #dfe6ef; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; }
        .stepsGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 35px; }
        .stepCard { padding: 16px; background: rgba(255,255,255,.72); border: 1px solid #e1e7ef; border-radius: 12px; }
        .stepCard span { color: #6d7e96; font-size: 10px; font-weight: 850; }
        .stepCard h3 { margin: 8px 0 5px; font-size: 14px; }
        .stepCard p { margin: 0; color: #6b798e; font-size: 12px; line-height: 1.55; }
        .progressPanel { margin-top: 18px; padding: 18px; background: #fff; border: 1px solid #dfe5ed; border-radius: 14px; }
        .stageRow { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 9px; padding: 10px 0; }
        .stageIcon { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: #e9eef7; color: #284c80; font-size: 11px; font-weight: 900; }
        .stageIcon.complete { background: #e1f4e8; color: #17643b; }
        .stageIcon.failed { background: #ffe6e6; color: #9c2525; }
        .stageName { font-size: 12px; font-weight: 850; }
        .stageDetail { margin-top: 3px; color: #708096; font-size: 11px; line-height: 1.5; }
        .resultsPanel { margin-top: 18px; }
        .resultHeader { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
        .countGrid { display: flex; gap: 8px; flex-wrap: wrap; }
        .countPill { border: 1px solid #dfe5ed; border-radius: 8px; background: #fff; padding: 8px 10px; color: #65738a; font-size: 11px; }
        .countPill strong { color: #1c2c44; }
        .resultGrid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 14px; align-items: start; }
        .resultImagePanel, .findingsPanel { min-width: 0; background: #fff; border: 1px solid #dfe5ed; border-radius: 13px; padding: 15px; }
        .resultImagePanel img { display: block; max-width: 100%; max-height: 72vh; margin: auto; object-fit: contain; border: 1px solid #e5eaf1; border-radius: 8px; }
        .findingCard { padding: 13px 0; border-bottom: 1px solid #e8edf3; }
        .findingCard:last-child { border-bottom: 0; }
        .findingTop { display: flex; align-items: flex-start; gap: 8px; }
        .findingNumber { display: grid; place-items: center; width: 25px; height: 25px; flex: 0 0 25px; border-radius: 7px; background: #eef3fa; color: #244a7c; font-size: 11px; font-weight: 900; }
        .findingTitle { margin: 0; font-size: 13px; line-height: 1.45; }
        .findingMeta { margin-bottom: 4px; color: #748197; font-size: 9px; font-weight: 850; letter-spacing: .7px; text-transform: uppercase; }
        .findingCard p { color: #66758a; font-size: 12px; line-height: 1.6; margin: 8px 0 0; }
        .recommendation { margin-top: 9px; border-radius: 8px; background: #f5f8fc; padding: 10px; color: #344b6b; font-size: 12px; line-height: 1.55; }
        .recommendation strong { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 3px; color: #5c718e; }
        @media (max-width: 700px) {
          .homeContent { margin-top: 40px; }
          .heroTitle { letter-spacing: -1.8px; }
          .sourceGrid, .stepsGrid, .resultGrid { grid-template-columns: 1fr; }
          .sourceCard { padding: 18px; }
          .entryPanel { padding: 16px; }
          .filePreview { grid-template-columns: 1fr; }
          .filePreview img { max-height: 260px; }
        }
      `}</style>

      <nav className="homeNav">
        <div className="homeBrand">UX AUDIT</div>
        <div className="homeNavActions">
          <span className={"connectionPill " + (connection?.connected ? "connected" : connection ? "failed" : "")} title={connection?.error || "OpenRouter API connection status"}>
            {connection?.connected ? "● OpenRouter connected" : connection ? "● OpenRouter connection failed" : "Checking OpenRouter…"}
          </span>
          <button className="checkBtn" onClick={async () => {
            setConnection(null);
            try {
              const response = await fetch("/api/openrouter-status?refresh=1", { cache: "no-store" });
              setConnection(await response.json());
            } catch (e) {
              setConnection({ connected: false, provider: "OpenRouter", error: e instanceof Error ? e.message : "Connection check failed." });
            }
          }}>Check status</button>
        </div>
      </nav>

      <section className="homeContent">
        <div className="eyebrow">EVIDENCE-LED UX REVIEW · AI-POWERED</div>
        <h1 className="heroTitle">Audit the experience.<br />Find what needs fixing.</h1>
        <p className="heroCopy">Start with one of two workflows. Explore a live website's information architecture and choose pages to audit, or attach an existing screenshot and let AI inspect the interface directly.</p>

        <div className="sourceGrid" role="group" aria-label="Choose what to audit">
          <button type="button" className={"sourceCard " + (mode === "website" ? "active" : "")} aria-pressed={mode === "website"} onClick={() => { setMode("website"); setError(""); }}>
            <span className="sourceNumber">OPTION 01</span>
            <span className="sourceIcon" aria-hidden="true">↗</span>
            <h2>Audit a live website</h2>
            <p>Discover public pages, inspect the interactive information architecture, select the URLs that matter, then capture and audit those pages.</p>
            <span className="sourceAction">{mode === "website" ? "Selected · enter a website URL ↓" : "Choose website audit →"}</span>
          </button>
          <button type="button" className={"sourceCard " + (mode === "screenshot" ? "active" : "")} aria-pressed={mode === "screenshot"} onClick={() => { setMode("screenshot"); setError(""); }}>
            <span className="sourceNumber">OPTION 02</span>
            <span className="sourceIcon" aria-hidden="true">▧</span>
            <h2>Audit an attached screenshot</h2>
            <p>Upload a PNG, JPG or WebP. OpenRouter sends the actual image to a vision model to identify visible UX issues and evidence-linked recommendations—no website URL required.</p>
            <span className="sourceAction">{mode === "screenshot" ? "Selected · attach a screenshot ↓" : "Choose screenshot audit →"}</span>
          </button>
        </div>

        {mode === "website" ? (
          <section className="entryPanel" aria-labelledby="website-entry-title">
            <div className="eyebrow">LIVE WEBSITE WORKFLOW</div>
            <h2 className="panelTitle" id="website-entry-title">Discover the site's structure first</h2>
            <p className="panelCopy">Enter a public domain to map its navigation and sitemap. Automated access can vary by website; pages behind sign-in or bot protection may need manual evidence.</p>
            <form className="urlForm" onSubmit={startWebsite}>
              <input className="urlInput" type="url" aria-label="Website URL" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
              <button className="primaryBtn" type="submit" disabled={loadingWebsite}>{loadingWebsite ? "Opening discovery…" : "Discover information architecture →"}</button>
            </form>
            {error && <p className="inlineError" role="alert">{error}</p>}
          </section>
        ) : (
          <section className="entryPanel" aria-labelledby="screenshot-entry-title">
            <div className="eyebrow">SCREENSHOT WORKFLOW</div>
            <h2 className="panelTitle" id="screenshot-entry-title">Upload the screen you want AI to audit</h2>
            <p className="panelCopy">The attached image—not a text-only description—is passed to the vision analysis stage. The model reviews what is visible and returns prioritised findings with recommendations.</p>

            <label className="dropZone">
              <input className="visuallyHidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={auditRunning} onChange={(e) => selectScreenshot(e.currentTarget.files?.[0] || null)} />
              <span className="dropIcon" aria-hidden="true">↑</span>
              <span>
                <span className="dropTitle">{screenshotFile ? "Replace screenshot" : "Choose a screenshot to upload"}</span>
                <span className="dropHint">PNG, JPG or WebP · up to 25 MB · full-page or viewport captures work</span>
              </span>
            </label>

            {screenshotFile && (
              <div className="filePreview">
                {screenshotPreview && <img src={screenshotPreview} alt="Preview of the screenshot selected for AI audit" />}
                <div>
                  <div className="eyebrow">ATTACHED EVIDENCE</div>
                  <div className="fileName">{screenshotFile.name}</div>
                  <div className="fileMeta">{(screenshotFile.size / (1024 * 1024)).toFixed(2)} MB · {(screenshotFile.type || "image").toUpperCase()}</div>
                  <button type="button" className="secondaryBtn" style={{ marginTop: 12 }} onClick={() => selectScreenshot(null)} disabled={auditRunning}>Remove image</button>
                </div>
              </div>
            )}

            <div className="modePicker" role="group" aria-label="Screenshot audit context">
              <span className="panelCopy" style={{ margin: 0, fontWeight: 800 }}>Analyse as:</span>
              {([
                ["auto", "Auto-detect from image"],
                ["desktop", "Desktop UI"],
                ["mobile", "Mobile UI"],
              ] as Array<[UploadMode, string]>).map(([value, label]) => (
                <button key={value} type="button" className={"modeOption " + (uploadMode === value ? "active" : "")} aria-pressed={uploadMode === value} onClick={() => setUploadMode(value)} disabled={auditRunning}>{label}</button>
              ))}
            </div>

            <button type="button" className="primaryBtn" onClick={auditUploadedScreenshot} disabled={!screenshotFile || auditRunning}>
              {auditRunning ? "AI is analysing your screenshot…" : "Audit uploaded screenshot with AI →"}
            </button>
            <p className="noteText">The image is compressed in your browser before upload. OpenRouter handles vision analysis and fallback routing; the report is saved to the audit knowledge base.</p>
            {auditError && <p className="inlineError" role="alert">{auditError}</p>}
          </section>
        )}

        {recentIa && (
          <article className="recentPanel">
            <div>
              <div className="eyebrow">RECENT IA · SAVED FOR 30 MINUTES</div>
              <h2 style={{ fontSize: 16, margin: "6px 0" }}>{recentIa.title || recentIa.root}</h2>
              <p className="fileMeta" style={{ margin: 0 }}>{recentIa.root} · {recentIa.audited_pages?.length || 0} saved page result(s)</p>
            </div>
            <a className="secondaryBtn" style={{ textDecoration: "none" }} href={"/site-map?session=" + encodeURIComponent(recentIa.id)}>Continue saved IA →</a>
          </article>
        )}

        {mode === "screenshot" && (auditRunning || auditStages.length > 0) && (
          <section className="progressPanel" aria-live="polite">
            <div className="eyebrow">LIVE AI AUDIT PROGRESS</div>
            <h2 className="panelTitle" style={{ marginTop: 6 }}>{auditRunning ? "Analysing the attached screenshot" : auditResult ? "Screenshot audit complete" : "Screenshot audit stopped"}</h2>
            <p className="panelCopy" style={{ marginBottom: 8 }}>{auditStatus}</p>
            {auditStages.map((stage, index) => (
              <div className="stageRow" key={stage.id}>
                <span className={"stageIcon " + stage.status}>{stage.status === "complete" ? "✓" : stage.status === "failed" ? "!" : index + 1}</span>
                <div><div className="stageName">{stage.label}</div><div className="stageDetail">{stage.detail}</div></div>
              </div>
            ))}
          </section>
        )}

        {mode === "screenshot" && auditResult && (
          <section className="resultsPanel">
            <div className="resultHeader">
              <div>
                <div className="eyebrow">AI-GENERATED · IMAGE-BASED REVIEW</div>
                <h2 className="panelTitle" style={{ marginTop: 6 }}>{auditResult.title || "Uploaded screenshot"}</h2>
                <p className="panelCopy" style={{ marginBottom: 0 }}>{auditResult.screenshotWidth} × {auditResult.screenshotHeight}px analysed · {auditResult.findings?.length || 0} findings {auditId ? "· saved to audit knowledge base" : ""}</p>
              </div>
              <div className="countGrid">
                <span className="countPill"><strong>{severityCount("high")}</strong> High</span>
                <span className="countPill"><strong>{severityCount("medium")}</strong> Medium</span>
                <span className="countPill"><strong>{severityCount("low")}</strong> Low</span>
              </div>
            </div>

            <div className="resultGrid">
              <article className="resultImagePanel">
                <div className="eyebrow" style={{ marginBottom: 10 }}>SCREENSHOT EVIDENCE</div>
                <img src={auditResult.screenshot} alt={"Screenshot analysed by AI: " + auditResult.title} />
              </article>
              <article className="findingsPanel">
                <div className="eyebrow">FINDINGS & RECOMMENDATIONS</div>
                {auditResult.findings?.length ? auditResult.findings.map((finding, index) => (
                  <article className="findingCard" key={finding.id || index}>
                    <div className="findingTop">
                      <span className="findingNumber">{index + 1}</span>
                      <div>
                        <div className="findingMeta">{finding.severity || "Review"} · {finding.category || "UX finding"}</div>
                        <h3 className="findingTitle">{finding.title}</h3>
                      </div>
                    </div>
                    <p>{finding.description}</p>
                    {finding.evidence?.[0] && <p><strong>Visible evidence:</strong> {finding.evidence[0].detail || finding.evidence[0].element || finding.evidence[0].section || "See the screenshot evidence."}</p>}
                    <div className="recommendation"><strong>Recommended fix</strong>{finding.recommendation}</div>
                    {finding.uxPerspective?.law && <p><strong>UX principle:</strong> {finding.uxPerspective.law} — {finding.uxPerspective.assessment || finding.uxPerspective.definition}</p>}
                    {finding.businessAnalysis?.kpi && <p><strong>Potential KPI impact:</strong> {finding.businessAnalysis.kpi} — {finding.businessAnalysis.impact}</p>}
                  </article>
                )) : <p className="panelCopy">The model returned a report without structured findings. Try the audit again or attach a higher-resolution screenshot of the actual interface.</p>}
                <button className="secondaryBtn" type="button" onClick={() => { setAuditResult(null); setAuditStages([]); setAuditError(""); setAuditStatus(""); }}>Audit another screenshot</button>
              </article>
            </div>
          </section>
        )}

        <div className="stepsGrid">
          <article className="stepCard"><span>WEBSITE ROUTE</span><h3>Discover</h3><p>Build an interactive hierarchy from public navigation and sitemap links.</p></article>
          <article className="stepCard"><span>BOTH ROUTES</span><h3>Analyse visual evidence</h3><p>AI evaluates the actual screenshot for usability, interface hierarchy and content issues.</p></article>
          <article className="stepCard"><span>BOTH ROUTES</span><h3>Act on findings</h3><p>Receive prioritised issues, recommended fixes and evidence-linked UX reasoning.</p></article>
        </div>
        {connection?.error && <p className="noteText">OpenRouter connection: {connection.error}</p>}
      </section>
    </main>
  );
}
