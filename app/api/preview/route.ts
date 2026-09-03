import { NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";

export const runtime = "nodejs";

function isPrivateOrReservedIp(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      address === "192.0.0.1"
    );
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

async function validateTarget(rawUrl: string) {
  let target: URL;
  try { target = new URL(rawUrl); } catch { throw new Error("Enter a valid website URL."); }
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (target.username || target.password) throw new Error("URLs with embedded credentials are not supported.");
  const hostname = target.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local network URLs are not supported.");
  }
  const literalIp = net.isIP(hostname) ? hostname : null;
  const addresses = literalIp ? [literalIp] : (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateOrReservedIp)) throw new Error("Private or reserved network addresses are not supported.");
  return target.toString();
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function injectPreviewOverlay(html: string, target: string, findings: unknown[]) {
  const payload = safeScriptJson(findings);
  const overlayScript = `
<script>
(() => {
  const findings = ${payload};
  const evidence = findings.flatMap((finding) => (finding.evidence || []).map((item) => ({ ...item, finding })));
  const style = document.createElement('style');
  style.textContent = ` + "`" + `
    #sr-ux-audit-overlay { position:absolute; inset:0; width:100%; min-height:100%; z-index:2147483647; pointer-events:none; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .sr-ux-box { position:absolute; border:2px solid #f5d547; background:rgba(245,213,71,.18); box-shadow:0 0 0 1px rgba(17,17,17,.35), inset 0 0 0 1px rgba(255,255,255,.4); pointer-events:none; }
    .sr-ux-marker { position:absolute; top:-13px; left:-13px; width:28px; height:28px; border:2px solid #111; border-radius:50%; background:#111; color:#fff; display:grid; place-items:center; font:800 12px/1 Inter,ui-sans-serif,system-ui,sans-serif; cursor:pointer; pointer-events:auto; box-shadow:0 2px 8px rgba(0,0,0,.22); }
    .sr-ux-marker:hover, .sr-ux-marker:focus-visible { background:#f5d547; color:#111; }
    .sr-ux-pop { position:absolute; left:22px; top:0; width:min(360px,calc(100vw - 32px)); max-height:430px; overflow:auto; display:none; padding:15px; border:1px solid #d8d6cc; border-radius:12px; background:#fff; color:#171717; box-shadow:0 12px 34px rgba(0,0,0,.2); pointer-events:auto; }
    .sr-ux-marker:hover .sr-ux-pop, .sr-ux-marker:focus-within .sr-ux-pop { display:block; }
    .sr-ux-pop strong { display:block; font-size:14px; line-height:1.3; margin-bottom:6px; }
    .sr-ux-pop p { margin:7px 0 0; color:#686860; font-size:12px; line-height:1.45; }
    .sr-ux-pop .sr-ux-law { margin-top:10px; padding-top:10px; border-top:1px solid #ecebe4; }
    .sr-ux-pop .sr-ux-k { color:#171717; font-weight:800; }
    .sr-ux-pop ul { margin:5px 0 0; padding-left:17px; color:#686860; font-size:12px; line-height:1.45; }
  ` + "`" + `;
  document.head.appendChild(style);
  const overlay = document.createElement('div');
  overlay.id = 'sr-ux-audit-overlay';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  evidence.forEach((item, index) => {
    const box = document.createElement('div');
    box.className = 'sr-ux-box';
    box.style.left = clamp(Number(item.x) || 0, 0, 95) + '%';
    box.style.top = clamp(Number(item.y) || 0, 0, 98) + '%';
    box.style.width = Math.max(2, Math.min(95, Number(item.width) || 20)) + '%';
    box.style.height = Math.max(2, Math.min(95, Number(item.height) || 10)) + '%';
    const marker = document.createElement('span');
    marker.className = 'sr-ux-marker';
    marker.tabIndex = 0;
    marker.setAttribute('aria-label', 'UX finding ' + (index + 1));
    marker.textContent = String(index + 1);
    const pop = document.createElement('div');
    pop.className = 'sr-ux-pop';
    const finding = item.finding || {};
    const law = finding.uxPerspective || {};
    const esc = (text) => String(text || '').replace(/[&<>\"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]));
    const list = (items) => Array.isArray(items) && items.length ? '<ul>' + items.map((v) => '<li>' + esc(v) + '</li>').join('') + '</ul>' : '<p>None specified.</p>';
    pop.innerHTML = '<strong>' + esc(item.label || finding.title || 'UX evidence') + '</strong>' +
      '<p>' + esc(item.detail || finding.description) + '</p>' +
      '<div class="sr-ux-law"><p><span class="sr-ux-k">Finding:</span> ' + esc(finding.title) + '</p>' +
      '<p><span class="sr-ux-k">Severity:</span> ' + esc(finding.severity) + '</p>' +
      '<p><span class="sr-ux-k">UX law / principle:</span> ' + esc(law.law) + '</p>' +
      '<p><span class="sr-ux-k">Definition:</span> ' + esc(law.definition) + '</p>' +
      '<p><span class="sr-ux-k">Assessment:</span> ' + esc(law.assessment) + '</p>' +
      '<p><span class="sr-ux-k">Recommended change:</span> ' + esc(finding.recommendation) + '</p>' +
      '<p><span class="sr-ux-k">ScreenRoot / UX tasks:</span></p>' + list(finding.screenrootTasks) +
      '<p><span class="sr-ux-k">Development tasks:</span></p>' + list(finding.devTasks) + '</div>';
    marker.appendChild(pop);
    box.appendChild(marker);
    overlay.appendChild(box);
  });
  const mount = () => {
    document.body.style.position = document.body.style.position || 'relative';
    document.documentElement.style.minHeight = '100%';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) + 'px'; });
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once:true });
})();
</script>`;
  let cleaned = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy[^>]*>/gi, "");
  cleaned = cleaned.replace(/<meta[^>]+http-equiv=["']?x-frame-options[^>]*>/gi, "");
  cleaned = cleaned.replace(/<base\b[^>]*>/gi, "");
  const baseTag = `<base href="${escapeAttribute(target)}">`;
  if (/<head\b[^>]*>/i.test(cleaned)) cleaned = cleaned.replace(/<head\b[^>]*>/i, (match) => match + baseTag);
  else cleaned = baseTag + cleaned;
  if (/<\/body>/i.test(cleaned)) return cleaned.replace(/<\/body>/i, overlayScript + "</body>");
  return cleaned + overlayScript;
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const encodedTarget = requestUrl.searchParams.get("u")?.trim() ?? "";
    const rawUrl = encodedTarget ? decodeBase64Url(encodedTarget) : requestUrl.searchParams.get("url")?.trim() ?? "";
    if (!rawUrl) return NextResponse.json({ error: "Missing website URL." }, { status: 400 });
    const target = await validateTarget(rawUrl);
    const token = process.env.BROWSERLESS_API_TOKEN;
    if (!token) return NextResponse.json({ error: "BROWSERLESS_API_TOKEN is not configured." }, { status: 503 });

    const encodedFindings = requestUrl.searchParams.get("a")?.trim() ?? "W10";
    let findings: unknown[] = [];
    try { findings = JSON.parse(decodeBase64Url(encodedFindings)); } catch { findings = []; }

    const endpoint = new URL("https://production-sfo.browserless.io/content");
    endpoint.searchParams.set("token", token);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Cache-Control": "no-cache", "Content-Type": "application/json" },
      body: JSON.stringify({ url: target }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Browserless content failed", response.status, detail.slice(0, 1000));
      return NextResponse.json({ error: `Website preview service returned HTTP ${response.status}.` }, { status: 502 });
    }
    const html = await response.text();
    if (!html.trim()) return NextResponse.json({ error: "Website preview returned empty HTML." }, { status: 502 });
    return new NextResponse(injectPreviewOverlay(html, target, findings), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, max-age=300",
        "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; style-src * data: 'unsafe-inline'; font-src * data:; connect-src *; frame-src *; media-src * data: blob:;"
      },
    });
  } catch (error) {
    console.error("Website preview failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Website preview could not be loaded." }, { status: 400 });
  }
}
