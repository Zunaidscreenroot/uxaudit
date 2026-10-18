import { getSql } from "@/lib/neon-db";

export const runtime = "nodejs";
export const maxDuration = 15;

const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const sql = getSql();

    if (id) {
      if (!validId(id)) return Response.json({ error: "Invalid session id." }, { status: 400 });
      const rows = await sql.query(
        "SELECT * FROM ia_sessions WHERE id = $1::uuid AND expires_at > now() LIMIT 1",
        [id],
      );
      return rows[0]
        ? Response.json({ session: rows[0] }, { headers: { "Cache-Control": "no-store" } })
        : Response.json({ error: "Session expired or not found." }, { status: 404 });
    }

    const ids = [...new Set((url.searchParams.get("ids") || "").split(",").filter(validId))].slice(0, 10);
    if (!ids.length) return Response.json({ sessions: [] }, { headers: { "Cache-Control": "no-store" } });

    const placeholders = ids.map((_, index) => "$" + (index + 1) + "::uuid").join(", ");
    const rows = await sql.query(
      "SELECT id, root, title, stage, audited_pages, updated_at, expires_at " +
      "FROM ia_sessions WHERE id IN (" + placeholders + ") AND expires_at > now() " +
      "ORDER BY updated_at DESC",
      ids,
    );
    return Response.json({ sessions: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[uxaudit] ia_session_read_failed", error);
    return Response.json({ error: "Could not load IA session." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!validId(body?.id)) return Response.json({ error: "A valid session id is required." }, { status: 400 });
    if (typeof body.root !== "string" || !/^https?:\/\//i.test(body.root)) {
      return Response.json({ error: "A valid website root is required." }, { status: 400 });
    }

    let root: URL;
    try {
      root = new URL(body.root);
    } catch {
      return Response.json({ error: "A valid website root is required." }, { status: 400 });
    }

    const now = new Date();
    const row = {
      id: body.id,
      root: root.href,
      title: typeof body.title === "string" ? body.title.slice(0, 200) : root.href,
      discovery: body.discovery ?? null,
      selected_urls: Array.isArray(body.selected_urls) ? body.selected_urls.slice(0, 120) : [],
      audited_pages: Array.isArray(body.audited_pages) ? body.audited_pages.slice(0, 120) : [],
      stage: ["discover", "select", "results"].includes(body.stage) ? body.stage : "discover",
      project_name: typeof body.project_name === "string" ? body.project_name.slice(0, 200) : root.hostname,
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    };

    const sql = getSql();
    const rows = await sql.query(
      "INSERT INTO ia_sessions (id, root, title, discovery, selected_urls, audited_pages, stage, project_name, updated_at, expires_at) " +
      "VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10) " +
      "ON CONFLICT (id) DO UPDATE SET root = EXCLUDED.root, title = EXCLUDED.title, " +
      "discovery = EXCLUDED.discovery, selected_urls = EXCLUDED.selected_urls, " +
      "audited_pages = EXCLUDED.audited_pages, stage = EXCLUDED.stage, " +
      "project_name = EXCLUDED.project_name, updated_at = EXCLUDED.updated_at, " +
      "expires_at = EXCLUDED.expires_at RETURNING *",
      [
        row.id,
        row.root,
        row.title,
        row.discovery === null ? null : JSON.stringify(row.discovery),
        JSON.stringify(row.selected_urls),
        JSON.stringify(row.audited_pages),
        row.stage,
        row.project_name,
        row.updated_at,
        row.expires_at,
      ],
    );

    return Response.json({ session: rows[0] || row }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[uxaudit] ia_session_write_failed", error);
    return Response.json({ error: "Could not save IA session." }, { status: 503 });
  }
}
