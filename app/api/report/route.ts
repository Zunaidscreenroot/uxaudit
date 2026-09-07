import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import { getAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const W = 13.333;
const H = 7.5;

function hex(r: number, g: number, b: number) {
  return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function luminance(color: string) {
  const n = parseInt(color, 16);
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function readableText(background: string) { return luminance(background) < 0.58 ? "FFFFFF" : "111111"; }

async function extractBrandPalette(dataUri: string) {
  const base64 = dataUri.split(",")[1] || "";
  const input = Buffer.from(base64, "base64");
  const image = sharp(input).resize(70, 70, { fit: "cover" }).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { count: number; saturation: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const brightness = (r + g + b) / 3;
    if (brightness < 28 || brightness > 242 || saturation < 0.18) continue;
    const key = hex(Math.round(r / 24) * 24, Math.round(g / 24) * 24, Math.round(b / 24) * 24);
    const current = buckets.get(key) || { count: 0, saturation: 0 };
    current.count += 1; current.saturation += saturation; buckets.set(key, current);
  }
  const ranked = [...buckets.entries()].sort((a, b) => (b[1].count * (1 + b[1].saturation / Math.max(1, b[1].count))) - (a[1].count * (1 + a[1].saturation / Math.max(1, a[1].count))));
  const primary = ranked[0]?.[0] || "111111";
  const secondary = ranked.find(([color]) => color !== primary)?.[0] || "F5D547";
  return { primary, secondary, textOnPrimary: readableText(primary) };
}

function addText(slide: PptxGenJS.Slide, text: string, x: number, y: number, w: number, h: number, opts: PptxGenJS.TextPropsOptions = {}) {
  slide.addText(text, { x, y, w, h, margin: 0, fontFace: "Aptos", color: "171717", breakLine: false, fit: "shrink", ...opts });
}

function addScreenshot(slide: PptxGenJS.Slide, screenshot: string, width: number, height: number, boxX: number, boxY: number, boxW: number, boxH: number, marker?: { x: number; y: number }, markerColor = "E51E7A", markerLabel?: string) {
  const ratio = width / height;
  const boxRatio = boxW / boxH;
  let w = boxW; let h = boxH; let x = boxX; let y = boxY;
  if (ratio > boxRatio) { h = boxW / ratio; y = boxY + (boxH - h) / 2; } else { w = boxH * ratio; x = boxX + (boxW - w) / 2; }
  slide.addImage({ data: screenshot, x, y, w, h });
  if (marker) {
    const mx = x + marker.x * w; const my = y + marker.y * h;
    slide.addShape(PptxGenJS.ShapeType.ellipse, { x: mx - 0.13, y: my - 0.13, w: 0.26, h: 0.26, fill: { color: markerColor }, line: { color: "FFFFFF", width: 2 } });
    if (markerLabel) addText(slide, markerLabel, mx - 0.06, my - 0.06, 0.12, 0.12, { fontSize: 7, bold: true, color: "FFFFFF", align: "center", valign: "mid" });
  }
  return { x, y, w, h };
}

function addFooter(slide: PptxGenJS.Slide, clientName: string, accent: string, page: number) {
  slide.addShape(PptxGenJS.ShapeType.line, { x: 0.55, y: 7.08, w: 12.2, h: 0, line: { color: "E4E2DB", width: 0.7 } });
  addText(slide, `${clientName} · UX Audit`, 0.58, 7.16, 4.5, 0.15, { fontSize: 7, color: "77766E" });
  addText(slide, String(page).padStart(2, "0"), 12.25, 7.13, 0.5, 0.18, { fontSize: 7, color: accent, bold: true, align: "right" });
}

export async function GET(request: Request) {
  try {
    const auditId = new URL(request.url).searchParams.get("auditId");
    if (!auditId) return Response.json({ error: "Missing auditId." }, { status: 400 });
    const audit = await getAudit(auditId);
    if (!audit) return Response.json({ error: "Audit not found." }, { status: 404 });

    const palette = await extractBrandPalette(audit.screenshot);
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "UX Audit by ScreenRoot";
    pptx.company = "ScreenRoot";
    pptx.subject = `UX audit for ${audit.client_name}`;
    pptx.title = `${audit.client_name} — UX Audit`;
    pptx.lang = "en-IN";
    pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos", lang: "en-IN" };
    pptx.defineSlideMaster({ title: "MASTER", background: { color: "F8F7F2" }, objects: [] });

    const findings = audit.findings.map((item: any) => item.finding);
    const high = findings.filter((f: any) => f.severity === "high").length;
    const medium = findings.filter((f: any) => f.severity === "medium").length;
    const low = findings.filter((f: any) => f.severity === "low").length;
    const topFindings = findings.slice(0, 3);

    let slideNo = 1;
    let slide = pptx.addSlide("MASTER");
    slide.background = { color: palette.primary };
    addText(slide, "UX AUDIT", 0.72, 0.75, 2.2, 0.3, { fontSize: 11, bold: true, color: palette.textOnPrimary, charSpacing: 2.2 });
    addText(slide, audit.client_name, 0.72, 1.72, 10.8, 1.0, { fontSize: 42, bold: true, color: palette.textOnPrimary, breakLine: true });
    addText(slide, "Experience review · UX research · business funnel impact", 0.75, 2.9, 8.6, 0.35, { fontSize: 15, color: palette.textOnPrimary, transparency: 12 });
    slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 0.75, y: 5.72, w: 3.0, h: 0.62, rectRadius: 0.06, fill: { color: palette.secondary }, line: { color: palette.secondary } });
    addText(slide, new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(new Date(audit.created_at)), 0.94, 5.91, 2.6, 0.2, { fontSize: 10, bold: true, color: readableText(palette.secondary), align: "center" });
    addText(slide, "Prepared by ScreenRoot", 0.75, 6.72, 3.0, 0.2, { fontSize: 8, color: palette.textOnPrimary, transparency: 18 });

    slideNo += 1; slide = pptx.addSlide("MASTER");
    addText(slide, "Executive summary", 0.65, 0.55, 7.0, 0.5, { fontSize: 27, bold: true });
    addText(slide, "The highest-value opportunities identified in this audit.", 0.65, 1.12, 7.6, 0.3, { fontSize: 12, color: "686860" });
    const stats = [[String(findings.length), "findings"], [String(high), "high priority"], [String(medium), "medium"], [String(low), "low"]];
    stats.forEach(([value, label], i) => {
      const x = 0.65 + i * 3.02;
      slide.addShape(PptxGenJS.ShapeType.roundRect, { x, y: 1.72, w: 2.7, h: 1.25, rectRadius: 0.06, fill: { color: i === 0 ? palette.primary : "FFFFFF" }, line: { color: i === 0 ? palette.primary : "E1DFD7", width: 0.8 } });
      addText(slide, value, x + 0.18, 1.94, 2.2, 0.48, { fontSize: 28, bold: true, color: i === 0 ? palette.textOnPrimary : palette.primary });
      addText(slide, label, x + 0.18, 2.52, 2.2, 0.2, { fontSize: 8, bold: true, color: i === 0 ? palette.textOnPrimary : "77766E" });
    });
    topFindings.forEach((f: any, i: number) => {
      const y = 3.45 + i * 1.0;
      slide.addShape(PptxGenJS.ShapeType.ellipse, { x: 0.68, y: y + 0.03, w: 0.3, h: 0.3, fill: { color: palette.primary }, line: { color: palette.primary } });
      addText(slide, String(i + 1), 0.75, y + 0.09, 0.16, 0.1, { fontSize: 7, bold: true, color: palette.textOnPrimary, align: "center" });
      addText(slide, f.title, 1.18, y, 7.8, 0.28, { fontSize: 13, bold: true });
      addText(slide, `${f.businessAnalysis?.kpi || "Key KPI"} · ${f.severity} priority`, 1.18, y + 0.36, 6.7, 0.2, { fontSize: 8, color: "77766E" });
    });
    addFooter(slide, audit.client_name, palette.primary, slideNo);

    slideNo += 1; slide = pptx.addSlide("MASTER");
    addText(slide, "The experience at a glance", 0.65, 0.55, 8.0, 0.5, { fontSize: 27, bold: true });
    addText(slide, audit.title || "Analysed interface", 0.65, 1.12, 6.8, 0.25, { fontSize: 11, color: "686860" });
    addScreenshot(slide, audit.screenshot, audit.screenshot_width, audit.screenshot_height, 0.65, 1.55, 7.25, 4.95);
    slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 8.25, y: 1.55, w: 4.35, h: 4.95, rectRadius: 0.06, fill: { color: "FFFFFF" }, line: { color: "E1DFD7", width: 0.8 } });
    addText(slide, "What this audit covers", 8.62, 1.95, 3.5, 0.3, { fontSize: 13, bold: true });
    addText(slide, "Visual hierarchy\nNavigation & interaction\nLanguage & clarity\nConversion friction\nUX research principles\nBusiness funnel impact", 8.62, 2.55, 3.25, 2.3, { fontSize: 11, breakLine: true, bullet: { indent: 10 }, color: "4D4C47", valign: "top" });
    addText(slide, audit.pages?.[0]?.pageSummary || "The interface was reviewed from the supplied screenshot with evidence anchored to visible UI regions.", 8.62, 5.35, 3.25, 0.72, { fontSize: 9, color: "686860", italic: true, breakLine: true });
    addFooter(slide, audit.client_name, palette.primary, slideNo);

    findings.forEach((f: any, index: number) => {
      slideNo += 1; slide = pptx.addSlide("MASTER");
      const accent = index % 2 === 0 ? palette.primary : palette.secondary;
      addText(slide, `FINDING ${String(index + 1).padStart(2, "0")}`, 0.65, 0.45, 2.0, 0.22, { fontSize: 8, bold: true, color: accent, charSpacing: 1.5 });
      addText(slide, f.title, 0.65, 0.82, 5.55, 0.72, { fontSize: 23, bold: true, breakLine: true });
      addText(slide, `${String(f.severity).toUpperCase()} · ${f.category}`, 0.67, 1.62, 5.0, 0.2, { fontSize: 8, bold: true, color: "77766E", charSpacing: 0.6 });
      addText(slide, f.description, 0.65, 2.02, 5.15, 1.05, { fontSize: 11, color: "4D4C47", breakLine: true, valign: "top" });
      slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 0.65, y: 3.28, w: 5.15, h: 1.1, rectRadius: 0.04, fill: { color: "FFFFFF" }, line: { color: "E1DFD7", width: 0.7 } });
      addText(slide, `UX principle · ${f.uxPerspective?.law || "UX design principle"}`, 0.9, 3.52, 4.55, 0.23, { fontSize: 10, bold: true, color: palette.primary });
      addText(slide, f.uxPerspective?.assessment || "This principle helps explain the observed user friction.", 0.9, 3.86, 4.45, 0.32, { fontSize: 8.5, color: "686860", breakLine: true });
      slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 0.65, y: 4.62, w: 5.15, h: 1.15, rectRadius: 0.04, fill: { color: "FFFDF3" }, line: { color: "E9DE9A", width: 0.7 } });
      addText(slide, `Business impact · ${f.businessAnalysis?.funnelStage || "Conversion"}`, 0.9, 4.87, 4.55, 0.23, { fontSize: 10, bold: true, color: "5D4B00" });
      addText(slide, `KPI at risk: ${f.businessAnalysis?.kpi || "Conversion rate"}`, 0.9, 5.22, 4.45, 0.22, { fontSize: 8.5, color: "686860" });
      const marker = f.evidence?.[0]?.marker;
      addScreenshot(slide, audit.screenshot, audit.screenshot_width, audit.screenshot_height, 6.15, 0.92, 6.55, 5.9, marker, accent, String(index + 1));
      addText(slide, "Evidence marker", 6.18, 6.5, 2.0, 0.18, { fontSize: 7, color: "77766E", italic: true });
      addText(slide, f.recommendation, 8.2, 6.45, 4.45, 0.35, { fontSize: 8, bold: true, color: "4D4C47", align: "right", breakLine: true });
      addFooter(slide, audit.client_name, accent, slideNo);
    });

    slideNo += 1; slide = pptx.addSlide("MASTER");
    addText(slide, "Priority actions", 0.65, 0.55, 7.0, 0.5, { fontSize: 27, bold: true });
    addText(slide, "A practical sequence for improving the experience and its business outcomes.", 0.65, 1.12, 8.0, 0.3, { fontSize: 12, color: "686860" });
    findings.slice(0, 5).forEach((f: any, i: number) => {
      const y = 1.72 + i * 0.95;
      slide.addShape(PptxGenJS.ShapeType.ellipse, { x: 0.7, y: y + 0.03, w: 0.3, h: 0.3, fill: { color: i === 0 ? palette.primary : "FFFFFF" }, line: { color: palette.primary, width: 1.2 } });
      addText(slide, String(i + 1), 0.78, y + 0.09, 0.14, 0.1, { fontSize: 7, bold: true, color: i === 0 ? palette.textOnPrimary : palette.primary, align: "center" });
      addText(slide, f.recommendation, 1.25, y, 7.25, 0.45, { fontSize: 10.5, bold: true, color: "33322E", breakLine: true });
      addText(slide, `Focus: ${f.businessAnalysis?.kpi || "user progression"}`, 8.85, y + 0.04, 3.3, 0.22, { fontSize: 8, color: "77766E", align: "right" });
    });
    slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 9.05, y: 5.95, w: 3.55, h: 0.62, rectRadius: 0.04, fill: { color: palette.primary }, line: { color: palette.primary } });
    addText(slide, "Measure · iterate · validate", 9.32, 6.15, 3.0, 0.18, { fontSize: 9, bold: true, color: palette.textOnPrimary, align: "center" });
    addFooter(slide, audit.client_name, palette.primary, slideNo);

    const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
    const filename = `${audit.client_name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "ux-audit"}-ux-audit.pptx`;
    return new Response(buffer, { status: 200, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Report export failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not export the report." }, { status: 500 });
  }
}
