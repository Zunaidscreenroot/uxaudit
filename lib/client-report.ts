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

  const markerButtons = findings.map((finding, index) => {
    const marker = finding.evidence?.[0]?.marker;
    return marker ? `<span class="marker" style="${markerStyle(marker)};background:#${markerColors[index % markerColors.length]}">${index + 1}</span>` : "";
  }).join("");

  const findingSlides = findings.map((finding, index) => {
    const marker = finding.evidence?.[0]?.marker;
    const business = finding.businessAnalysis;
    return `<section class="slide findingSlide">
      <div class="topline"><span>Finding ${index + 1}</span><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></div>
      <h2>${escapeHtml(finding.title)}</h2>
      <div class="findingGrid">
        <div class="findingVisual"><img src="${screenshotSrc}" alt="Analysed ${escapeHtml(audit.client_name)} screenshot"><span class="marker selected" style="${markerStyle(marker)};background:#${markerColors[index % markerColors.length]}">${index + 1}</span></div>
        <div class="findingCopy">
          <p class="lead">${escapeHtml(finding.description)}</p>
          <div class="copyBlock"><span>UX principle & research</span><h3>${escapeHtml(finding.uxPerspective.law)}</h3><p><b>Definition:</b> ${escapeHtml(finding.uxPerspective.definition)}</p><p><b>Why it applies:</b> ${escapeHtml(finding.uxPerspective.assessment)}</p><p><b>Research context:</b> ${escapeHtml(finding.uxPerspective.researchContext)}</p></div>
          <div class="copyBlock business"><span>Business opportunity</span><h3>${escapeHtml(business.funnelStage)}</h3><p><b>Impact:</b> ${escapeHtml(business.impact)}</p><p><b>KPI at risk:</b> ${escapeHtml(business.kpi)}</p><p><b>Mechanism:</b> ${escapeHtml(business.mechanism)}</p></div>
        </div>
      </div>
      <div class="recommendation"><span>Recommended redesign</span><strong>${escapeHtml(finding.recommendation)}</strong></div>
    </section>`;
  }).join("");

  const businessRows = findings.map((finding, index) => `<div class="businessRow"><span class="rowNumber" style="background:#${markerColors[index % markerColors.length]}">${index + 1}</span><div><strong>${escapeHtml(finding.title)}</strong><span>${escapeHtml(finding.businessAnalysis.funnelStage)} · ${escapeHtml(finding.businessAnalysis.kpi)}</span></div><p>${escapeHtml(finding.businessAnalysis.impact)}</p></div>`).join("");
  const suggestions = findings.flatMap((finding) => finding.businessAnalysis.suggestions || []).slice(0, 12).map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1280, initial-scale=1"><title>${escapeHtml(audit.client_name)} — UX Audit</title><style>
    @page{size:1280px 720px;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#111;font-family:Arial,Helvetica,sans-serif;color:#171717}body{width:1280px}.slide{width:1280px;height:720px;position:relative;overflow:hidden;background:#f8f7f2;padding:58px 66px;page-break-after:always}.slide:last-child{page-break-after:auto}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.14em;font-weight:800;color:#666}.cover{background:#${palette.primary};color:#fff;display:flex;flex-direction:column;justify-content:space-between}.cover .eyebrow{color:#fff;opacity:.72}.cover h1{font-size:70px;line-height:.94;letter-spacing:-.055em;max-width:900px;margin:0 0 24px}.cover p{font-size:19px;max-width:700px;line-height:1.45;opacity:.82}.coverMeta{display:flex;justify-content:space-between;align-items:end;font-size:12px;opacity:.76}.accentBar{width:110px;height:8px;background:#${palette.accent};border-radius:99px;margin-bottom:28px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:36px}.stat{background:#fff;border:1px solid #dfded6;border-radius:20px;padding:25px}.stat strong{font-size:48px;display:block;letter-spacing:-.06em;color:#${palette.primary}}.stat span{font-size:12px;color:#6d6b64;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.intro{font-size:22px;line-height:1.45;max-width:970px;color:#484740;margin-top:42px}.screenFrame{position:relative;margin-top:30px;height:480px;border-radius:18px;overflow:hidden;border:1px solid #dddcd4;background:#fff}.screenFrame img{width:100%;height:100%;object-fit:contain;display:block}.marker{position:absolute;width:31px;height:31px;border:3px solid #fff;border-radius:50%;transform:translate(-50%,-50%);display:grid;place-items:center;color:#fff;font-size:10px;font-weight:900;box-shadow:0 4px 12px rgba(0,0,0,.24);z-index:2}.screenFrame .marker{width:27px;height:27px;border-width:2px}.topline{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#${palette.secondary}.severity{border-radius:999px;padding:7px 12px;font-size:9px;color:#fff;background:#777;text-transform:uppercase}.severity.high{background:#a7352b}.severity.medium{background:#b97917}.severity.low{background:#50719b}.findingSlide h2{font-size:34px;line-height:1.05;letter-spacing:-.045em;max-width:930px;margin:18px 0 28px}.findingGrid{display:grid;grid-template-columns:530px 1fr;gap:34px}.findingVisual{position:relative;height:395px;border:1px solid #dddcd4;border-radius:17px;overflow:hidden;background:#fff}.findingVisual img{width:100%;height:100%;object-fit:contain;display:block}.findingCopy{display:flex;flex-direction:column;gap:17px}.lead{font-size:17px;line-height:1.45;margin:0;color:#333}.copyBlock{border-top:3px solid #${palette.secondary};padding-top:11px}.copyBlock.business{border-color:#${palette.accent}}.copyBlock>span,.recommendation>span{font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:900;color:#777}.copyBlock h3{font-size:17px;margin:6px 0 8px}.copyBlock p{font-size:11px;line-height:1.42;margin:4px 0;color:#555}.recommendation{position:absolute;left:66px;right:66px;bottom:38px;background:#fff;border:1px solid #dfded6;border-left:6px solid #${palette.primary};border-radius:13px;padding:12px 16px;display:flex;gap:15px;align-items:center}.recommendation strong{font-size:12px;line-height:1.35}.businessRows{margin-top:28px;border-top:1px solid #dddcd4}.businessRow{display:grid;grid-template-columns:42px 1.2fr 1fr;gap:18px;align-items:center;padding:17px 0;border-bottom:1px solid #e1dfd7}.rowNumber{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:900;font-size:10px}.businessRow strong{display:block;font-size:13px}.businessRow span{display:block;font-size:10px;color:#777;margin-top:5px}.businessRow p{font-size:11px;color:#555;margin:0;line-height:1.35}.closing{background:#${palette.primary};color:#fff}.closing h2{font-size:52px;letter-spacing:-.05em;line-height:1;margin:0 0 20px;max-width:900px}.closing p{font-size:19px;line-height:1.5;max-width:760px;opacity:.85}.closing ul{columns:2;gap:40px;margin:32px 0;padding-left:20px;max-width:950px}.closing li{font-size:13px;line-height:1.5;margin-bottom:10px}.footer{position:absolute;left:66px;right:66px;bottom:28px;display:flex;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:.08em;opacity:.55}
  </style></head><body>
    <section class="slide cover"><div><div class="accentBar"></div><div class="eyebrow">ScreenRoot · UX audit</div></div><div><h1>${escapeHtml(audit.client_name)}</h1><p>Experience review focused on visible UX friction, research-backed principles and the business opportunities created by improving the customer journey.</p></div><div class="coverMeta"><span>${escapeHtml(view)}</span><span>${escapeHtml(generatedDate)}</span></div></section>
    <section class="slide"><div class="eyebrow">Executive snapshot</div><h2 style="font-size:42px;letter-spacing:-.05em;margin:14px 0 0">The experience has ${findings.length} visible opportunities to improve.</h2><div class="stats"><div class="stat"><strong>${high}</strong><span>High priority</span></div><div class="stat"><strong>${medium}</strong><span>Medium priority</span></div><div class="stat"><strong>${low}</strong><span>Low priority</span></div></div><p class="intro">The review connects each observation to a visible region of the original screen, a relevant UX principle, and a directional business hypothesis. These are opportunities to validate with analytics, research or experimentation—not measured performance claims.</p></section>
    <section class="slide"><div class="eyebrow">Experience overview · ${escapeHtml(view)}</div><h2 style="font-size:36px;letter-spacing:-.045em;margin:12px 0 0">The screen we reviewed</h2><div class="screenFrame"><img src="${screenshotSrc}" alt="Original ${escapeHtml(audit.client_name)} screenshot">${markerButtons}</div><div class="footer"><span>Original audited screen · ${audit.screenshot_width} × ${audit.screenshot_height}px</span><span>${escapeHtml(audit.title)}</span></div></section>
    ${findingSlides}
    <section class="slide"><div class="eyebrow">Business opportunity</div><h2 style="font-size:40px;letter-spacing:-.05em;margin:14px 0 0">Where experience improvements can influence the funnel</h2><div class="businessRows">${businessRows || `<p class="intro">No business opportunities were strong enough to present.</p>`}</div></section>
    <section class="slide closing"><div class="accentBar"></div><div class="eyebrow">Recommended next conversation</div><h2>Turn the strongest UX opportunities into measurable growth experiments.</h2><p>The next step is to validate the highest-impact observations with user research and funnel data, then prioritise the changes most likely to improve clarity, progression and conversion.</p><ul>${suggestions || "<li>Validate the highest-priority friction with users.</li><li>Connect the relevant funnel KPI to the experience issue.</li><li>Prototype the strongest redesign direction.</li><li>Measure the change after launch.</li>"}</ul><div class="footer"><span>Prepared by ScreenRoot</span><span>${escapeHtml(audit.client_name)} · UX Audit</span></div></section>
  </body></html>`;
}
