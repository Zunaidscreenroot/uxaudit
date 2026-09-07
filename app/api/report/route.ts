import { getAudit } from "@/lib/knowledge-base";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";

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
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation < 0.22 || max < 55 || max > 248) continue;
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    const score = saturation * 100 + Math.min(max, 220) / 10;
    candidates.push({ hex, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const colors: string[] = [];
  for (const candidate of candidates) {
    if (colors.every((color) => hexDistance(candidate.hex, color) > 55)) colors.push(candidate.hex);
    if (colors.length === 4) break;
  }
  return {
    primary: colors[0] || "1F4E79",
    secondary: colors[1] || colors[0] || "2F75B5",
    accent: colors[2] || colors[0] || "70AD47",
  };
}

function markerX(marker: any, width: number) {
  return Math.max(0.12, Math.min(width - 0.12, marker.x * width));
}
function markerY(marker: any, height: number) {
  return Math.max(0.12, Math.min(height - 0.12, marker.y * height));
}

export async function GET(request: Request) {
  try {
    const auditId = new URL(request.url).searchParams.get("auditId");
    if (!auditId) return Response.json({ error: "auditId is required." }, { status: 400 });

    const audit: any = await getAudit(auditId);
    if (!audit) return Response.json({ error: "Audit not found." }, { status: 404 });

    const palette = await extractBrandPalette(audit.screenshot);
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "UX Audit by ScreenRoot";
    pptx.company = "ScreenRoot";
    pptx.subject = `UX audit for ${audit.client_name}`;
    pptx.title = `${audit.client_name} — UX Audit`;
    pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos" };
    pptx.defineSlideMaster({ title: "MASTER", background: { color: "F8F7F2" }, objects: [] });

    const findings = audit.findings.map((item: any) => item.finding);
    const high = findings.filter((f: any) => f.severity === "high").length;
    const medium = findings.filter((f: any) => f.severity === "medium").length;
    const low = findings.filter((f: any) => f.severity === "low").length;

    let slideNo = 1;
    let slide = pptx.addSlide("MASTER");
    slide.background = { color: palette.primary };
    slide.addText(audit.client_name, { x: 0.7, y: 1.55, w: 12, h: 0.7, fontFace: "Aptos Display", fontSize: 30, bold: true, color: "FFFFFF" });
    slide.addText("UX Audit", { x: 0.7, y: 2.35, w: 12, h: 0.55, fontFace: "Aptos", fontSize: 20, color: "FFFFFF" });
    slide.addText("Client-ready experience review", { x: 0.7, y: 6.6, w: 6, h: 0.35, fontSize: 11, color: "FFFFFF", transparency: 12 });
    slide.addText(String(slideNo++), { x: 12.4, y: 7.0, w: 0.4, h: 0.2, fontSize: 9, color: "FFFFFF", align: "right" });

    slide = pptx.addSlide("MASTER");
    slide.addText("Executive summary", { x: 0.65, y: 0.5, w: 7, h: 0.5, fontSize: 25, bold: true, color: palette.primary });
    slide.addText(`${findings.length} findings identified`, { x: 0.7, y: 1.45, w: 5.5, h: 0.6, fontSize: 24, bold: true, color: "222222" });
    const stats = [["High priority", high, "C00000"], ["Medium priority", medium, "C57B00"], ["Low priority", low, "5B7DB1"]];
    stats.forEach(([label, value, color], i) => {
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.7 + i * 4.05, y: 2.5, w: 3.55, h: 1.35, rectRadius: 0.08, fill: { color: String(color), transparency: 8 }, line: { color: String(color), transparency: 100 } });
      slide.addText(String(value), { x: 0.95 + i * 4.05, y: 2.75, w: 1, h: 0.45, fontSize: 25, bold: true, color: "FFFFFF" });
      slide.addText(String(label), { x: 1.95 + i * 4.05, y: 2.84, w: 1.9, h: 0.3, fontSize: 12, bold: true, color: "FFFFFF" });
    });
    slide.addText("The audit focuses on experience friction, UX principles, and the likely business impact across the funnel.", { x: 0.7, y: 4.55, w: 11.5, h: 0.8, fontSize: 18, color: "444444", breakLine: false });
    slide.addText(String(slideNo++), { x: 12.4, y: 7.0, w: 0.4, h: 0.2, fontSize: 9, color: "888888", align: "right" });

    slide = pptx.addSlide("MASTER");
    slide.addText("Experience overview", { x: 0.55, y: 0.35, w: 6, h: 0.45, fontSize: 23, bold: true, color: palette.primary });
    slide.addImage({ data: audit.screenshot, x: 0.55, y: 0.95, w: 12.25, h: 5.9 });
    slide.addText("Original audited screen", { x: 0.55, y: 6.95, w: 3, h: 0.2, fontSize: 9, color: "777777" });
    slide.addText(String(slideNo++), { x: 12.4, y: 7.0, w: 0.4, h: 0.2, fontSize: 9, color: "888888", align: "right" });

    findings.forEach((finding: any, index: number) => {
      slide = pptx.addSlide("MASTER");
      slide.addText(`Finding ${index + 1}`, { x: 0.55, y: 0.25, w: 2, h: 0.3, fontSize: 10, bold: true, color: palette.secondary });
      slide.addText(finding.title || "UX finding", { x: 0.55, y: 0.62, w: 7.2, h: 0.62, fontSize: 22, bold: true, color: "222222", fit: "shrink" });
      slide.addText(String(finding.severity || "medium").toUpperCase(), { x: 9.85, y: 0.62, w: 2.3, h: 0.35, fontSize: 10, bold: true, color: palette.primary, align: "right" });
      slide.addImage({ data: audit.screenshot, x: 0.55, y: 1.45, w: 7.05, h: 4.85 });
      const marker = finding.evidence?.marker;
      if (marker && typeof marker.x === "number" && typeof marker.y === "number") {
        const mx = markerX(marker, 7.05) + 0.55;
        const my = markerY(marker, 4.85) + 1.45;
        slide.addShape(pptx.ShapeType.ellipse, { x: mx - 0.13, y: my - 0.13, w: 0.26, h: 0.26, fill: { color: palette.accent }, line: { color: "FFFFFF", width: 2 } });
        slide.addText(String(index + 1), { x: mx - 0.09, y: my - 0.07, w: 0.18, h: 0.12, fontSize: 7, bold: true, color: "FFFFFF", align: "center", margin: 0 });
      }
      slide.addText(finding.description || "", { x: 7.95, y: 1.45, w: 4.85, h: 1.25, fontSize: 13, color: "333333", valign: "top", fit: "shrink" });
      const ux = finding.uxContext || {};
      slide.addText("UX principle / research", { x: 7.95, y: 2.9, w: 4.6, h: 0.28, fontSize: 10, bold: true, color: palette.secondary });
      slide.addText(`${ux.principle || finding.category || "UX principle"}\n${ux.definition || ux.whyItApplies || ""}`, { x: 7.95, y: 3.25, w: 4.85, h: 1.2, fontSize: 11, color: "444444", fit: "shrink" });
      const business = finding.businessAnalysis || {};
      slide.addText("Business impact", { x: 7.95, y: 4.7, w: 4.6, h: 0.28, fontSize: 10, bold: true, color: palette.secondary });
      slide.addText(`${business.funnelStage || "Funnel impact"} · ${business.kpi || "KPI"}\n${business.impact || business.mechanism || ""}`, { x: 7.95, y: 5.05, w: 4.85, h: 0.8, fontSize: 11, color: "444444", fit: "shrink" });
      slide.addText(`Recommendation: ${finding.recommendation || ""}`, { x: 0.55, y: 6.55, w: 11.8, h: 0.42, fontSize: 11, bold: true, color: "222222", fit: "shrink" });
      slide.addText(String(slideNo++), { x: 12.4, y: 7.0, w: 0.4, h: 0.2, fontSize: 9, color: "888888", align: "right" });
    });

    slide = pptx.addSlide("MASTER");
    slide.addText("Prioritized action plan", { x: 0.65, y: 0.55, w: 7, h: 0.5, fontSize: 25, bold: true, color: palette.primary });
    const priorities = [...findings].sort((a: any, b: any) => ({ high: 0, medium: 1, low: 2 }[a.severity] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.severity] ?? 1));
    priorities.slice(0, 8).forEach((finding: any, i: number) => {
      const y = 1.35 + i * 0.65;
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.7, y, w: 0.5, h: 0.38, rectRadius: 0.04, fill: { color: palette.primary }, line: { color: palette.primary } });
      slide.addText(String(i + 1), { x: 0.7, y: y + 0.08, w: 0.5, h: 0.15, fontSize: 9, bold: true, color: "FFFFFF", align: "center", margin: 0 });
      slide.addText(finding.title || "UX finding", { x: 1.45, y: y - 0.01, w: 6.4, h: 0.28, fontSize: 13, bold: true, color: "222222", fit: "shrink" });
      slide.addText(finding.recommendation || "Prioritize this experience improvement.", { x: 7.95, y: y - 0.01, w: 4.5, h: 0.32, fontSize: 10, color: "555555", fit: "shrink" });
    });
    slide.addText(String(slideNo++), { x: 12.4, y: 7.0, w: 0.4, h: 0.2, fontSize: 9, color: "888888", align: "right" });

    const output = await pptx.write({ outputType: "nodebuffer" as any });
    const body = Buffer.isBuffer(output) ? output : Buffer.from(output as any);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${audit.client_name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}-UX-Audit.pptx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Report export failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Report export failed." }, { status: 500 });
  }
}
