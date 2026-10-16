import { isIP } from "node:net";

export const runtime = "nodejs";
export const maxDuration = 20;

type SitePage = { url: string; title: string; category: string; depth: number; source: "navigation" | "sitemap" };

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (version === 6) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  return false;
}

function classify(url: URL, title = "") {
  const text = (url.pathname + " " + title).toLowerCase();
  if (/about|story|leadership|team|mission|vision|who-we-are/.test(text)) return "About Us";
  if (/contact|support|help|branch|location/.test(text)) return "Contact & Support";
  if (/career|job|work-with-us/.test(text)) return "Careers";
  if (/product|service|saving|deposit|loan|card|account|mortgage|fixed-deposit/.test(text)) return "Products & Services";
  if (/blog|news|media|article|insight|press/.test(text)) return "Insights & News";
  if (/investor|disclosure|policy|compliance|governance/.test(text)) return "Investor & Governance";
  return url.pathname === "/" ? "Home" : "Other Pages";
}

function cleanTitle(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim().slice(0, 120);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const raw = typeof body?.url === "string" ? body.url.trim() : "";
    let root: URL;
    try { root = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return Response.json({ error: "Enter a valid website URL, including its domain." }, { status: 400 }); }
    if (!["http:", "https:"].includes(root.protocol) || isPrivateHost(root.hostname)) return Response.json({ error: "Only public HTTP/HTTPS websites can be scanned." }, { status: 400 });
    root.hash = ""; root.search = ""; root.pathname = "/";
    const origin = root.origin;
    const pages = new Map<string, SitePage>();
    const add = (rawUrl: string, title: string, source: SitePage["source"]) => {
      try {
        const u = new URL(rawUrl, origin);
        if (u.origin !== origin || !["http:", "https:"].includes(u.protocol) || isPrivateHost(u.hostname)) return;
        u.hash = "";
        if (u.pathname.match(/\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|xml|woff2?|ico)$/i)) return;
        if (/logout|signout|delete|remove|\.\./i.test(u.pathname)) return;
        const normalized = u.href.replace(/\/$/, "") || origin;
        if (!pages.has(normalized)) pages.set(normalized, { url: normalized, title: title || (u.pathname === "/" ? "Home" : cleanTitle(u.pathname.split("/").filter(Boolean).pop() || "Home").replace(/[-_]/g, " ")), category: classify(u, title), depth: u.pathname.split("/").filter(Boolean).length, source });
      } catch {}
    };
    add(origin, "Home", "navigation");
    const response = await fetch(origin, { redirect: "follow", signal: AbortSignal.timeout(10000), headers: { "User-Agent": "UXAudit-PageDiscovery/1.0", Accept: "text/html,application/xhtml+xml" } });
    if (!response.ok) throw new Error(`Website returned HTTP ${response.status}`);
    const html = (await response.text()).slice(0, 3_000_000);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const homeTitle = titleMatch ? cleanTitle(titleMatch[1]) : "Home";
    pages.set(origin, { url: origin, title: homeTitle || "Home", category: "Home", depth: 0, source: "navigation" });
    const anchors = [...html.matchAll(/<a\b([^>]*?)href\s*=\s*["']([^"'#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi)];
    for (const match of anchors) {
      const attrs = match[1] + " " + match[3];
      const label = cleanTitle(match[4].replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, " $1 "));
      if (!label && !/aria-label|title=/i.test(attrs)) continue;
      const attrLabel = attrs.match(/(?:aria-label|title)\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      add(match[2], label || attrLabel, "navigation");
    }
    const sitemapUrls = [new URL("/sitemap.xml", origin).href, new URL("/sitemap_index.xml", origin).href];
    for (const sitemapUrl of sitemapUrls) {
      try {
        const sm = await fetch(sitemapUrl, { redirect: "follow", signal: AbortSignal.timeout(4500), headers: { "User-Agent": "UXAudit-PageDiscovery/1.0" } });
        if (!sm.ok) continue;
        const xml = (await sm.text()).slice(0, 1_500_000);
        for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
          const candidate = match[1].trim();
          if (/sitemap[^/]*\.xml(?:$|\?)/i.test(candidate)) continue;
          add(candidate, "", "sitemap");
        }
      } catch {}
    }
    const result = [...pages.values()].sort((a, b) => a.depth - b.depth || a.category.localeCompare(b.category) || a.title.localeCompare(b.title)).slice(0, 120);
    return Response.json({ root: origin, title: homeTitle, pages: result, scannedAt: new Date().toISOString(), note: "Discovery checks homepage links and common sitemap files. Pages behind login or not linked in the public site may not be discovered." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not discover pages on this website." }, { status: 502 });
  }
}
