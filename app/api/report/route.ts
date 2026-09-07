import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import { getAudit } from "@/lib/knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client-facing report export: keep the original screenshot intact and use extracted brand colors.
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