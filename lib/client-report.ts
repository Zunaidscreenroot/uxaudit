import sharp from "sharp";
import type { ViewMode } from "@/lib/audit";

type ReportFinding = {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  recommendation: string;
  uxPerspective: { law: string; definition: string; assessment: string; researchContext: string };
  businessAnalysis: { funnelStage: string; impact: string; kpi: string; mechanism: string; suggestions: string[] };
  evidence: Array<{ section: string; element: string; detail: string; marker?: { x: number; y: number } }>;
};

type ReportAudit = {
  id: string;
  client_name: string;
  title: string;
  screenshot: string;
  screenshot_width: number;
  screenshot_height: number;
  view_mode?: ViewMode | string | null;
  created_at: string;
  findings: Array<{ finding: ReportFinding }>;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hexDistance(a: string, b: string) {
  const pa = a.match(/.{2}/g)?.map((x) => parseInt(x, 16)) ?? [0, 0, 0];
  const pb = b.match(/.{2}/g)?.map((x) => parseInt(x, 16)) ?? [0, 0, 0];
  return Math.sqrt(pa.reduce((sum, v, i) => sum + Math.pow(v - pb[i], 2), 0));
}

async function extractBrandPalette(dataUri: string) {
  const base64 = dataUri.split(",")[1] || dataUri;
  const buffer = Buffer.from(base64, "base64");
  const { data, info } = await sharp(buffer).resize(48, 48, { fit: "cover" }).raw().toBuffer({ resolveWithObject: true });
  const candidates: { hex: string; score: number }[] = [];
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation < 0.22 || max < 55 || max > 248) continue;
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    candidates.push({ hex, score: saturation * 100 + Math.min(max, 220) / 10 });
  }
  candidates.sort((a, b) => b.score - a.score);
  const colors: string[] = [];
  for (const candidate of candidates) {
    if (colors.every((color) => hexDistance(candidate.hex, color) > 55)) colors.push(candidate.hex);
    if (colors.length === 4) break;
  }
  return { primary: colors[0] || "1F4E79", secondary: colors[1] || colors[0] || "2F75B5", accent: colors[2] || colors[0] || "70AD47" };
}

function viewLabel(value?: string | null) {
  if (value === "mobile") return "Mobile responsive view";
  if (value === "tablet") return "Tablet view";
  if (value === "desktop") return "Desktop web view";
  return "Web experience view";
}

function markerStyle(marker: { x: number; y: number } | undefined) {
  if (!marker) return "display:none";
  const x = Math.max(1, Math.min(99, marker.x * 100));
  const y = Math.max(1, Math.min(99, marker.y * 100));
  return `left:${x}%;top:${y}%`;
}

export async function buildClientReportHtml(audit: ReportAudit) {
  const palette = await extractBrandPalette(audit.screenshot);
  const findings = audit.findings.map((item) => item.finding);
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  const low = findings.filter((f) => f.severity === "low").length;
  const view = viewLabel(audit.view_mode);
  const generatedDate = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short" }).format(new Date(audit.created_at));
  const screenshotSrc = `/api/audit-assets/${encodeURIComponent(audit.id)}`;
  const markerColors = [palette.accent, palette.secondary, palette.primary, "EC268F", "F06D13", "1688DF", "12A96D", "F0AE00"];

  const markers = findings.map((finding, index) => {
    const marker = finding.evidence?.[0]?.marker;
    if (!marker) return "";
    return `<span class="marker" style="${markerStyle(marker)};background:#${markerColors[index % markerColors.length]}">${index + 1}</span>`;
  }).join("");

  const findingCards = findings.map((finding, index) => {
    const business = finding.businessAnalysis;
    const markerColor = markerColors[index % markerColors.length];
    return `<article class="findingCard">
      <div class="findingHeader"><div class="findingNumber" style="background:#${markerColor}">${index + 1}</div><div class="findingHeading"><div class="metaLine"><span>${escapeHtml(finding.category)}</span><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)} priority</span></div><h3>${escapeHtml(finding.title)}</h3></div></div>
      <p class="findingDescription">${escapeHtml(finding.description)}</p>
      <div class="twoColumn"><div class="researchPanel"><div class="panelLabel">UX principle & research</div><h4>${escapeHtml(finding.uxPerspective.law)}</h4><p><strong>Definition</strong>${escapeHtml(finding.uxPerspective.definition)}</p><p><strong>Why it applies</strong>${escapeHtml(finding.uxPerspective.assessment)}</p><p><strong>Research context</strong>${escapeHtml(finding.uxPerspective.researchContext)}</p></div><div class="businessPanel"><div class="panelLabel">Business opportunity</div><h4>${escapeHtml(business.funnelStage)}</h4><p><strong>Impact</strong>${escapeHtml(business.impact)}</p><p><strong>KPI at risk</strong>${escapeHtml(business.kpi)}</p><p><strong>Mechanism</strong>${escapeHtml(business.mechanism)}</p></div></div>
      <div class="recommendation" style="border-left-color:#${markerColor}"><div class="panelLabel">Recommended redesign</div><p>${escapeHtml(finding.recommendation)}</p></div>
    </article>`;
  }).join("");

  const priorityRows = findings.map((finding, index) => `<div class="priorityRow"><span class="smallMarker" style="background:#${markerColors[index % markerColors.length]}">${index + 1}</span><div><strong>${escapeHtml(finding.title)}</strong><span>${escapeHtml(finding.businessAnalysis.funnelStage)} · ${escapeHtml(finding.businessAnalysis.kpi)}</span></div><span class="priorityBadge ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></div>`).join("");
  const suggestions = findings.flatMap((finding) => finding.businessAnalysis.suggestions || []).slice(0, 12);
  const suggestionList = suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(audit.client_name)} — UX Audit</title><style>
    @page{size:A4;margin:14mm 13mm 16mm}*{box-sizing:border-box}html{background:#ecebe6}body{margin:0;background:#fff;color:#191919;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}.report{max-width:1080px;margin:0 auto;background:#fff}.cover{min-height:620px;padding:58px 64px 52px;background:linear-gradient(145deg,#${palette.primary},#${palette.secondary});color:#fff;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.cover:after{content:"";position:absolute;width:360px;height:360px;border-radius:50%;right:-130px;top:-120px;border:70px solid rgba(255,255,255,.08)}.brandMark{display:flex;align-items:center;gap:12px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;position:relative;z-index:1}.brandDot{width:12px;height:12px;border-radius:50%;background:#${palette.accent};box-shadow:0 0 0 6px rgba(255,255,255,.08)}.coverMain{position:relative;z-index:1}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;opacity:.72}.cover h1{font-size:64px;line-height:.98;letter-spacing:-.055em;margin:12px 0 20px;max-width:780px}.cover p{font-size:18px;line-height:1.5;max-width:720px;opacity:.88}.coverMeta{display:flex;justify-content:space-between;gap:20px;position:relative;z-index:1;font-size:11px;opacity:.72}.content{padding:54px 64px}.section{margin-bottom:54px}.sectionLabel{font-size:11px;text-transform:uppercase;letter-spacing:.14em;font-weight:900;color:#${palette.secondary};margin-bottom:10px}.section h2{font-size:34px;line-height:1.08;letter-spacing:-.045em;margin:0 0 18px}.summaryIntro{font-size:18px;line-height:1.55;color:#4d4c47;max-width:850px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:30px 0 18px}.stat{border:1px solid #e1dfd7;border-radius:16px;padding:20px;background:#faf9f5}.stat strong{font-size:40px;line-height:1;display:block;letter-spacing:-.05em;color:#${palette.primary}}.stat span{font-size:10px;display:block;margin-top:8px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:#777}.callout{margin-top:24px;padding:20px 22px;border-radius:14px;background:#f3f4ef;border-left:5px solid #${palette.accent};color:#4a4944}.screenshotSection{background:#f7f6f1;border-top:1px solid #e4e2da;border-bottom:1px solid #e4e2da;padding:48px 64px}.screenMeta{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:20px}.screenMeta h2{margin:0;font-size:30px;letter-spacing:-.04em}.screenMeta span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#777}.screenshotStage{position:relative;display:flex;justify-content:center;align-items:flex-start;width:100%;background:#fff;border:1px solid #d9d7cf;border-radius:18px;padding:18px;overflow:hidden}.screenshotCanvas{position:relative;display:inline-block;max-width:100%;line-height:0}.screenshotCanvas img{display:block;width:auto;height:auto;max-width:100%;max-height:none;border-radius:6px}.marker{position:absolute;width:30px;height:30px;border:3px solid #fff;border-radius:50%;transform:translate(-50%,-50%);display:grid;place-items:center;color:#fff;font-size:10px;font-weight:900;line-height:1;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2}.screenCaption{font-size:10px;color:#777;margin-top:10px;text-align:center}.findingIntro{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:28px}.findingIntro p{max-width:720px;color:#5c5a54;margin:0}.legend{font-size:10px;color:#777;white-space:nowrap}.findingCard{padding:30px 0;border-top:1px solid #dedcd4;break-inside:avoid}.findingHeader{display:flex;gap:14px;align-items:flex-start}.findingNumber{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:900;flex:none}.findingHeading{flex:1}.metaLine{display:flex;align-items:center;gap:10px;font-size:10px;color:#777;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.severity{border-radius:999px;padding:4px 8px;color:#fff;font-size:8px;letter-spacing:.08em}.severity.high{background:#a7352b}.severity.medium{background:#b97917}.severity.low{background:#50719b}.findingHeading h3{font-size:25px;line-height:1.15;letter-spacing:-.035em;margin:8px 0 0}.findingDescription{font-size:15px;line-height:1.55;color:#3e3d38;margin:18px 0 24px;padding-left:48px;max-width:920px}.twoColumn{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-left:48px}.researchPanel,.businessPanel{border:1px solid #e0ded7;border-radius:13px;padding:18px;background:#fbfaf7}.researchPanel{border-top:3px solid #${palette.secondary}}.businessPanel{border-top:3px solid #${palette.accent}}.panelLabel{font-size:9px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:#777}.twoColumn h4{font-size:15px;line-height:1.25;margin:7px 0 12px;color:#222}.twoColumn p{font-size:11px;line-height:1.5;color:#5b5953;margin:8px 0}.twoColumn p strong{display:block;color:#25241f;font-size:9px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px}.recommendation{margin:16px 0 0 48px;border:1px solid #e0ded7;border-left:5px solid;border-radius:12px;padding:14px 17px;background:#fff}.recommendation p{font-size:12px;line-height:1.5;margin:5px 0 0;color:#373631}.priorityList{border-top:1px solid #dedcd4;margin-top:24px}.priorityRow{display:grid;grid-template-columns:34px 1fr auto;gap:13px;align-items:center;padding:14px 0;border-bottom:1px solid #e7e5de}.smallMarker{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:9px;font-weight:900}.priorityRow strong{font-size:12px;display:block}.priorityRow span:not(.smallMarker):not(.priorityBadge){display:block;font-size:10px;color:#777;margin-top:3px}.priorityBadge{font-size:8px;text-transform:uppercase;font-weight:900;padding:5px 8px;border-radius:999px;color:#fff}.priorityBadge.high{background:#a7352b}.priorityBadge.medium{background:#b97917}.priorityBadge.low{background:#50719b}.nextSteps{background:#${palette.primary};color:#fff;border-radius:20px;padding:38px 42px;margin-top:26px}.nextSteps .sectionLabel{color:#fff;opacity:.7}.nextSteps h2{font-size:32px;margin-bottom:12px}.nextSteps p{opacity:.84;max-width:760px}.nextSteps ul{columns:2;padding-left:18px;margin:24px 0 0}.nextSteps li{font-size:11px;line-height:1.55;margin-bottom:8px;padding-right:24px}.footer{padding:24px 64px 34px;border-top:1px solid #e4e2da;display:flex;justify-content:space-between;color:#888;font-size:9px;text-transform:uppercase;letter-spacing:.08em}.pageBreak{break-before:page}@media(max-width:700px){.cover{min-height:560px;padding:38px 28px}.cover h1{font-size:46px}.content,.screenshotSection,.footer{padding-left:24px;padding-right:24px}.stats,.twoColumn{grid-template-columns:1fr}.findingDescription,.twoColumn,.recommendation{margin-left:0;padding-left:0}.findingDescription{padding-left:0}.twoColumn{padding-left:0}.recommendation{margin-left:0}.nextSteps ul{columns:1}.screenMeta{display:block}.screenMeta span{display:block;margin-top:8px}}@media print{html{background:#fff}body{background:#fff}.report{max-width:none}.cover{min-height:0;height:265mm;break-after:page}.screenshotSection{break-inside:avoid}.findingCard{break-inside:avoid}.nextSteps{break-inside:avoid}.footer{break-inside:avoid}}
  </style></head><body><main class="report">
    <section class="cover"><div class="brandMark"><span class="brandDot"></span><span>ScreenRoot · UX Audit</span></div><div class="coverMain"><div class="eyebrow">Client experience review</div><h1>${escapeHtml(audit.client_name)}</h1><p>A client-focused review of visible experience friction, research-backed UX principles and the business opportunities created by improving the customer journey.</p></div><div class="coverMeta"><span>${escapeHtml(view)} · ${audit.screenshot_width} × ${audit.screenshot_height}px</span><span>${escapeHtml(generatedDate)}</span></div></section>
    <div class="content"><section class="section"><div class="sectionLabel">Executive summary</div><h2>What the experience is telling us</h2><p class="summaryIntro">This audit identifies ${findings.length} visible opportunities across the reviewed experience. Each observation is grounded in the original screen, connected to a relevant UX principle and translated into a directional business hypothesis. The business implications are opportunities to validate with analytics, user research or experimentation—not measured performance claims.</p><div class="stats"><div class="stat"><strong>${high}</strong><span>High priority findings</span></div><div class="stat"><strong>${medium}</strong><span>Medium priority findings</span></div><div class="stat"><strong>${low}</strong><span>Low priority findings</span></div></div><div class="callout"><strong>How to read this report:</strong> numbered markers correspond to the findings below. The screenshot is the original audited image; no crops or altered representations are used.</div></section></div>
    <section class="screenshotSection"><div class="screenMeta"><h2>The experience reviewed</h2><span>${escapeHtml(view)} · Original screenshot</span></div><div class="screenshotStage"><div class="screenshotCanvas"><img src="${screenshotSrc}" alt="Original ${escapeHtml(audit.client_name)} screenshot">${markers}</div></div><div class="screenCaption">Original screenshot · ${audit.screenshot_width} × ${audit.screenshot_height}px · Markers identify the evidence regions referenced in the findings.</div></section>
    <div class="content"><section class="section"><div class="findingIntro"><div><div class="sectionLabel">Evidence & recommendations</div><h2>What should change, and why</h2><p>Each finding combines the visible issue with its UX rationale, research context and potential business impact.</p></div><div class="legend">Markers 1–${findings.length} map directly to the screenshot above.</div></div>${findingCards || `<div class="callout">No findings were generated for this audit.</div>`}</section>
      <section class="section pageBreak"><div class="sectionLabel">Business prioritisation</div><h2>Where to focus first</h2><p class="summaryIntro">The following view connects each finding to the customer funnel and the KPI most relevant to the stated business mechanism.</p><div class="priorityList">${priorityRows || `<div class="callout">No prioritised findings available.</div>`}</div></section>
      <section class="nextSteps"><div class="sectionLabel">Recommended next conversation</div><h2>Turn the strongest opportunities into measurable improvements.</h2><p>Validate the highest-impact observations with users and funnel data, then prototype and test the changes most likely to improve clarity, progression and conversion.</p><ul>${suggestionList || `<li>Validate the highest-priority friction with users.</li><li>Connect the relevant funnel KPI to the experience issue.</li><li>Prototype the strongest redesign direction.</li><li>Measure the effect after release.</li>`}</ul></section></div>
    <footer class="footer"><span>${escapeHtml(audit.client_name)} · UX Audit</span><span>Prepared by ScreenRoot</span></footer>
  </main></body></html>`;
}
