import { isIP } from "node:net";

export const runtime = "nodejs";
export const maxDuration = 20;

type SitePage = { url: string; title: string; category: string; depth: number; source: "navigation" | "sitemap" };

const DISCOVERY_CACHE_TTL_MS = 3 * 60 * 1000;
const discoveryCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();

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
  const path = url.pathname.toLowerCase();
  const text = (path + " " + title).replace(/[._-]+/g, " ").toLowerCase();
  if (path === "/") return "Home";

  // Match task-oriented BFSI destinations before broader keyword rules.
  if (/interest rate|service charge|service fee|\bfees?\b|\bcharges?\b|\bapr\b|\beblr\b|\bmclr\b|forex|exchange rate|tariff|pricing/.test(text)) return "Rates & Fees";
  if (/credit bureau|dispute|complaint|grievance|ombudsman|recovery agent|customer service|customer care|support|help|contact|branch|atm|locate us|feedback|service request|form center/.test(text)) return "Service & Support";
  if (/\bcard\b|cards|rupay|debit card|credit card|\bupi\b|payment|wallet|transaction|mandate/.test(text)) return "Cards & Payments";
  if (/\bloan\b|loans|\bcredit\b|mortgage|lending|borrow|emi|msme|microfinance|disbursement|overdraft|business loan/.test(text)) return "Loans & Credit";
  if (/saving|\bsavings\b|deposit|fixed deposit|term deposit|recurring deposit|\bfd\b|rd account|fd account/.test(text)) return "Savings & Deposits";
  if (/net banking|internet banking|mobile banking|digital banking|whatsapp banking|phone banking|sms banking|missed call banking|video banking|\bezy\b|api banking|online banking/.test(text)) return "Digital Banking";
  if (/open account|account opening|application|\bkyc\b|onboarding|track .*application|application status|loan tracking|application form/.test(text)) return "Accounts & Applications";
  if (/security|safe banking|fraud|phishing|scam|privacy|data protection|cyber/.test(text)) return "Security & Trust";
  if (/investor|disclosure|policy|compliance|governance|annual report|annual return|stock information|financial results|board of|committee|shareholder|regulatory/.test(text)) return "Investor & Governance";
  if (/blog|news|media|article|insight|press|faq|financial literacy|notice|leaflet|resource|knowledge/.test(text)) return "Insights & Guidance";
  if (/career|job|work with us/.test(text)) return "Careers";
  if (/about|story|leadership|team|mission|vision|who we are|management|company profile/.test(text)) return "About Us";
  if (/\baccount\b|personal banking|business banking|current account|salary account|nri|product|service|branch banking/.test(text)) return "Products & Services";
  return "Other Pages";
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
    const cached = discoveryCache.get(origin);
    if (cached && cached.expiresAt > Date.now()) {
      return Response.json({ ...cached.payload, cacheHit: true }, { headers: { "Cache-Control": "private, max-age=30" } });
    }
    if (cached) discoveryCache.delete(origin);
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
    const sitemapUrls = [new URL("/sitemap.xml", origin).href, new URL("/sitemap_index.xml", origin).href];
    const sitemapContentPromise = Promise.all(sitemapUrls.map(async (sitemapUrl) => {
      try {
        const sm = await fetch(sitemapUrl, { redirect: "follow", signal: AbortSignal.timeout(4500), headers: { "User-Agent": "UXAudit-PageDiscovery/1.0" } });
        if (!sm.ok) return "";
        return (await sm.text()).slice(0, 1_500_000);
      } catch {
        return "";
      }
    }));
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
    for (const xml of await sitemapContentPromise) {
      if (!xml) continue;
      for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
        const candidate = match[1].trim();
        if (/sitemap[^/]*\.xml(?:$|\?)/i.test(candidate)) continue;
        add(candidate, "", "sitemap");
      }
    }
    const result = [...pages.values()].sort((a, b) => a.depth - b.depth || a.category.localeCompare(b.category) || a.title.localeCompare(b.title)).slice(0, 120);
    const payload = { root: origin, title: homeTitle, pages: result, scannedAt: new Date().toISOString(), note: "Discovery checks homepage links and common sitemap files. Pages behind login or not linked in the public site may not be discovered.", cacheHit: false };
    discoveryCache.set(origin, { expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS, payload });
    if (discoveryCache.size > 100) {
      const oldest = discoveryCache.keys().next().value;
      if (oldest) discoveryCache.delete(oldest);
    }
    return Response.json(payload, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not discover pages on this website." }, { status: 502 });
  }
}
