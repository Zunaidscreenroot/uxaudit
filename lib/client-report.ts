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

type ReportPage = {
  id: string;
  title: string;
  screenshot: string;
  screenshot_width: number;
  screenshot_height: number;
  view_mode?: ViewMode | string | null;
  findings: ReportFinding[];
};

type ReportAudit = {
  id: string;
  client_name: string;
  created_at: string;
  pages: ReportPage[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
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
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation < 0.22 || max < 55 || max > 248) continue;
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    candidates.push({ hex, score: saturation * 100 + Math.min(max, 220) / 10 });
  }
  candidates.sort((a, b) => b.score - a.score);
  const colors: string[] = [];
  for (const candidate of candidates) { if (colors.every((color) => hexDistance(candidate.hex, color) > 55)) colors.push(candidate.hex); if (colors.length === 4) break; }
  return { primary: colors[0] || "1F4E79", secondary: colors[1] || colors[0] || "2F75B5", accent: colors[2] || colors[0] || "70AD47" };
}
function viewLabel(value?: string | null) { return value === "mobile" ? "Mobile responsive view" : value === "tablet" ? "Tablet view" : value === "desktop" ? "Desktop web view" : "Web experience view"; }
function markerStyle(marker: { x: number; y: number } | undefined) { if (!marker) return "display:none"; return `left:${Math.max(1, Math.min(99, marker.x * 100))}%;top:${Math.max(1, Math.min(99, marker.y * 100))}%`; }

export async function buildClientReportHtml(audit: ReportAudit) {
  const reportPages = audit.pages.map((page) => ({ ...page, findings: page.findings.filter((finding) => finding.severity === "high") })).filter((page) => page.findings.length > 0);
  const palette = await extractBrandPalette((reportPages[0] || audit.pages[0])?.screenshot || "");
  const totalHigh = reportPages.reduce((sum, page) => sum + page.findings.length, 0);
  const generatedDate = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short" }).format(new Date(audit.created_at));
  const markerColors = [palette.accent, palette.secondary, palette.primary, "EC268F", "F06D13", "1688DF", "12A96D", "F0AE00"];

  const pageSections = reportPages.map((page, pageIndex) => {
    const findings = page.findings;
    const markers = findings.map((finding, index) => {
      const marker = finding.evidence?.[0]?.marker;
      return marker ? `<span class="marker" style="${markerStyle(marker)};background:#${markerColors[index % markerColors.length]}">${index + 1}</span>` : "";
    }).join("");
    const cards = findings.map((finding, index) => {
      const color = markerColors[index % markerColors.length];
      const business = finding.businessAnalysis;
      return `<article class="findingCard">
        <div class="findingHeader"><div class="findingNumber" style="background:#${color}">${index + 1}</div><div><div class="metaLine"><span>${escapeHtml(finding.category)}</span><span class="priority">HIGH PRIORITY</span></div><h3>${escapeHtml(finding.title)}</h3></div></div>
        <p class="findingDescription">${escapeHtml(finding.description)}</p>
        <div class="evidenceBox"><strong>Evidence · ${escapeHtml(finding.evidence?.[0]?.element || "Analysed region")}</strong><span>${escapeHtml(finding.evidence?.[0]?.detail || "Visible evidence from the original screenshot.")}</span></div>
        <div class="twoColumn"><section><div class="panelLabel">UX principle & research</div><h4>${escapeHtml(finding.uxPerspective.law)}</h4><p><strong>Definition</strong>${escapeHtml(finding.uxPerspective.definition)}</p><p><strong>Why it applies</strong>${escapeHtml(finding.uxPerspective.assessment)}</p><p><strong>Research context</strong>${escapeHtml(finding.uxPerspective.researchContext)}</p></section><section><div class="panelLabel">Business opportunity</div><h4>${escapeHtml(business.funnelStage)}</h4><p><strong>Impact</strong>${escapeHtml(business.impact)}</p><p><strong>KPI at risk</strong>${escapeHtml(business.kpi)}</p><p><strong>Mechanism</strong>${escapeHtml(business.mechanism)}</p></section></div>
        <div class="recommendation" style="border-left-color:#${color}"><div class="panelLabel">Recommended redesign</div><p>${escapeHtml(finding.recommendation)}</p></div>
      </article>`;
    }).join("");
    return `<section class="pageSection ${pageIndex ? "pageBreak" : ""}">
      <div class="pageHeader"><div><div class="sectionLabel">Page ${pageIndex + 1} · high-priority evidence</div><h2>${escapeHtml(page.title)}</h2><p>${escapeHtml(viewLabel(page.view_mode))} · ${page.findings.length} high-priority finding${page.findings.length === 1 ? "" : "s"}</p></div></div>
      <div class="screenshotStage"><div class="screenshotCanvas"><img src="/api/audit-assets/${encodeURIComponent(audit.id)}?pageId=${encodeURIComponent(page.id)}" alt="Original ${escapeHtml(page.title)} screenshot"/>${markers}</div></div>
      <div class="caption">Original screenshot shown once for this page. Markers correspond only to the high-priority findings listed below.</div>
      <div class="findingList">${cards}</div>
    </section>`;
  }).join("");

  const pageSummary = reportPages.map((page) => `<div class="pageRow"><strong>${escapeHtml(page.title)}</strong><span>${page.findings.length} high-priority evidence${page.findings.length === 1 ? "" : "s"}</span></div>`).join("");
  const noHigh = totalHigh === 0 ? `<div class="noHigh"><strong>No high-priority evidence was identified.</strong><span>The report intentionally excludes medium- and low-priority findings.</span></div>` : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(audit.client_name)} — UX Audit</title><style>
  @page{size:A4;margin:14mm 13mm 16mm}*{box-sizing:border-box}html{background:#ecebe6}body{margin:0;background:#fff;color:#191919;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}.report{max-width:1080px;margin:0 auto;background:#fff}.cover{min-height:620px;padding:58px 64px 52px;background:linear-gradient(145deg,#${palette.primary},#${palette.secondary});color:#fff;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.cover:after{content:"";position:absolute;width:360px;height:360px;border-radius:50%;right:-130px;top:-120px;border:70px solid rgba(255,255,255,.08)}.brandMark{display:flex;align-items:center;gap:12px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;position:relative;z-index:1}.brandDot{width:12px;height:12px;border-radius:50%;background:#${palette.accent};box-shadow:0 0 0 6px rgba(255,255,255,.08)}.coverMain{position:relative;z-index:1}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;opacity:.72}.cover h1{font-size:58px;line-height:.98;letter-spacing:-.055em;margin:12px 0 20px;max-width:780px}.cover p{font-size:18px;line-height:1.5;max-width:720px;opacity:.88}.coverMeta{display:flex;justify-content:space-between;gap:20px;position:relative;z-index:1;font-size:11px;opacity:.72}.content{padding:54px 64px}.sectionLabel{font-size:11px;text-transform:uppercase;letter-spacing:.14em;font-weight:900;color:#${palette.secondary};margin-bottom:10px}.content h2{font-size:34px;line-height:1.08;letter-spacing:-.045em;margin:0 0 10px}.intro{font-size:18px;line-height:1.55;color:#4d4c47;max-width:850px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:30px 0}.stat{border:1px solid #e1dfd7;border-radius:16px;padding:20px;background:#faf9f5}.stat strong{font-size:40px;line-height:1;display:block;letter-spacing:-.05em;color:#${palette.primary}}.stat span{font-size:10px;display:block;margin-top:8px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:#777}.pageList{border-top:1px solid #dedcd4;margin-top:26px}.pageRow{display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid #e7e5de}.pageRow strong{font-size:13px}.pageRow span{font-size:11px;color:#777}.pageSection{padding:0 64px 52px}.pageBreak{break-before:page}.pageHeader{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;padding:52px 0 22px}.pageHeader h2{margin:0}.pageHeader p{margin:7px 0 0;color:#777;font-size:11px}.screenshotStage{position:relative;display:flex;justify-content:center;align-items:flex-start;width:100%;background:#f7f6f1;border:1px solid #d9d7cf;border-radius:18px;padding:18px;overflow:hidden}.screenshotCanvas{position:relative;display:inline-block;max-width:100%;line-height:0}.screenshotCanvas img{display:block;width:auto;height:auto;max-width:100%;border-radius:6px}.marker{position:absolute;width:30px;height:30px;border:3px solid #fff;border-radius:50%;transform:translate(-50%,-50%);display:grid;place-items:center;color:#fff;font-size:10px;font-weight:900;line-height:1;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2}.caption{font-size:10px;color:#777;margin:10px 0 22px;text-align:center}.findingList{border-top:1px solid #dedcd4}.findingCard{padding:30px 0;border-bottom:1px solid #dedcd4;break-inside:avoid}.findingHeader{display:flex;gap:14px;align-items:flex-start}.findingNumber{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:900;flex:none}.metaLine{display:flex;gap:10px;align-items:center;color:#777;font-size:9px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.priority{background:#a7352b;color:#fff;border-radius:999px;padding:4px 8px;font-size:8px}.findingHeader h3{font-size:24px;line-height:1.15;letter-spacing:-.035em;margin:8px 0 0}.findingDescription{font-size:15px;line-height:1.55;color:#3e3d38;margin:18px 0 14px;padding-left:48px;max-width:920px}.evidenceBox{margin:0 0 16px 48px;border:1px solid #e0ded7;border-left:4px solid #${palette.accent};border-radius:10px;padding:12px 14px;background:#fbfaf7}.evidenceBox strong,.evidenceBox span{display:block}.evidenceBox strong{font-size:10px;text-transform:uppercase;letter-spacing:.06em}.evidenceBox span{font-size:11px;color:#666;margin-top:4px}.twoColumn{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-left:48px}.twoColumn section{border:1px solid #e0ded7;border-radius:13px;padding:18px;background:#fbfaf7}.twoColumn section:nth-child(2){border-top:3px solid #${palette.accent}}.panelLabel{font-size:9px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:#777}.twoColumn h4{font-size:15px;line-height:1.25;margin:7px 0 12px}.twoColumn p{font-size:11px;line-height:1.5;color:#5b5953;margin:8px 0}.twoColumn p strong{display:block;color:#25241f;font-size:9px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px}.recommendation{margin:16px 0 0 48px;border:1px solid #e0ded7;border-left:5px solid;border-radius:12px;padding:14px 17px;background:#fff}.recommendation p{font-size:12px;line-height:1.5;margin:5px 0 0;color:#373631}.noHigh{margin-top:24px;padding:20px;border:1px solid #ddd;border-radius:12px;background:#faf9f5}.noHigh strong,.noHigh span{display:block}.noHigh span{font-size:12px;color:#777;margin-top:4px}.footer{padding:24px 64px 34px;border-top:1px solid #e4e2da;display:flex;justify-content:space-between;color:#888;font-size:9px;text-transform:uppercase;letter-spacing:.08em}@media(max-width:700px){.cover{min-height:560px;padding:38px 32px}.cover h1{font-size:44px}.content,.pageSection{padding-left:32px;padding-right:32px}.twoColumn{grid-template-columns:1fr}.findingDescription,.evidenceBox,.recommendation{margin-left:0;padding-left:0}.findingDescription{padding-left:0}.evidenceBox{padding:12px}.recommendation{padding:14px}.stats{grid-template-columns:1fr}}
  </style></head><body><div class="report">
    <section class="cover"><div class="brandMark"><span class="brandDot"></span>${escapeHtml(audit.client_name)} · UX Audit</div><div class="coverMain"><div class="eyebrow">Client evidence report</div><h1>High-priority UX evidence, page by page.</h1><p>A focused view of the most material experience issues found across this audit run. Only high-priority evidence is included in this client report.</p></div><div class="coverMeta"><span>${escapeHtml(generatedDate)}</span><span>${reportPages.length} page${reportPages.length === 1 ? "" : "s"} with high-priority evidence</span></div></section>
    <section class="content"><div class="sectionLabel">Executive summary</div><h2>What needs attention first</h2><p class="intro">This report intentionally filters out medium- and low-priority findings so the client conversation starts with the issues most likely to create material clarity, usability or conversion friction.</p><div class="stats"><div class="stat"><strong>${totalHigh}</strong><span>High-priority findings</span></div><div class="stat"><strong>${reportPages.length}</strong><span>Pages with evidence</span></div><div class="stat"><strong>${audit.pages.length}</strong><span>Pages audited</span></div></div><div class="sectionLabel">Evidence map</div><div class="pageList">${pageSummary}${noHigh}</div></section>
    ${pageSections}
    <footer class="footer"><span>${escapeHtml(audit.client_name)} · UX Audit</span><span>High-priority evidence only</span></footer>
  </div></body></html>`;
}
