import { queryDb } from "@/lib/db";
import { externalizeImageDataUris, hydrateImageDataUris } from "@/lib/r2-assets";

export const runtime = "nodejs";
export const maxDuration = 15;

const validId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      if (!validId(id)) return Response.json({ error: "Invalid session id." }, { status: 400 });
      const rows = await queryDb(
        "SELECT * FROM public.ia_sessions WHERE id = $1::uuid AND expires_at > now() LIMIT 1",
        [id],
      );
      if (!rows[0]) return Response.json({ error: "Session expired or not found." }, { status: 404 });
      return Response.json({ session: await hydrateImageDataUris(rows[0]) }, { headers: { "Cache-Control": "no-store" } });
    }

    const ids = (url.searchParams.get("ids") || "").split(",").filter(validId).slice(0, 10);
    if (!ids.length) return Response.json({ sessions: [] });
    const placeholders = ids.map((_, index) => `$${index + 1}::uuid`).join(",");
    const rows = await queryDb(
      `SELECT id, root, title, stage, audited_pages, updated_at, expires_at
       FROM public.ia_sessions
       WHERE id IN (${placeholders}) AND expires_at > now()
       ORDER BY updated_at DESC`,
      ids,
    );
    const sessions = await Promise.all(rows.map((row) => hydrateImageDataUris(row)));
    return Response.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load IA session." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!validId(body?.id)) return Response.json({ error: "A valid session id is required." }, { status: 400 });
    if (typeof body.root !== "string" || !/^https?:\/\//i.test(body.root)) {
      return Response.json({ error: "A valid website root is required." }, { status: 400 });
    }

    const now = new Date();
    const discovery = await externalizeImageDataUris(body.discovery ?? null, "ux-audit");
    const auditedPages = await externalizeImageDataUris(
      Array.isArray(body.audited_pages) ? body.audited_pages.slice(0, 120) : [],
      "ux-audit",
    );
    const selectedUrls = Array.isArray(body.selected_urls) ? body.selected_urls.slice(0, 120) : [];
    const row = {
      id: body.id,
      root: body.root,
      title: typeof body.title === "string" ? body.title.slice(0, 200) : body.root,
      discovery,
      selected_urls: selectedUrls,
      audited_pages: auditedPages,
      stage: ["discover", "select", "results"].includes(body.stage) ? body.stage : "discover",
      project_name: typeof body.project_name === "string" ? body.project_name.slice(0, 200) : new URL(body.root).hostname,
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    };
    const rows = await queryDb(
      `INSERT INTO public.ia_sessions
       (id, root, title, discovery, selected_urls, audited_pages, stage, project_name, updated_at, expires_at)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9::timestamptz, $10::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         root = EXCLUDED.root, title = EXCLUDED.title, discovery = EXCLUDED.discovery,
         selected_urls = EXCLUDED.selected_urls, audited_pages = EXCLUDED.audited_pages,
         stage = EXCLUDED.stage, project_name = EXCLUDED.project_name,
         updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at
       RETURNING *`,
      [row.id, row.root, row.title, JSON.stringify(row.discovery), JSON.stringify(row.selected_urls), JSON.stringify(row.audited_pages), row.stage, row.project_name, row.updated_at, row.expires_at],
    );
    const session = rows[0] || row;
    return Response.json({ session: await hydrateImageDataUris(session) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save IA session." }, { status: 503 });
  }
}
