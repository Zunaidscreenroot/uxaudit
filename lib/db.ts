import { neon } from "@neondatabase/serverless";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Row = Record<string, unknown>;

function connectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const context = getCloudflareContext();
    const value = (context.env as unknown as Record<string, unknown>).DATABASE_URL;
    if (typeof value === "string" && value.trim()) return value;
  } catch {
    // Local development can supply DATABASE_URL through .env.local.
  }
  throw new Error("DATABASE_URL is not configured for the shared Neon database.");
}

/** Use Neon's HTTP serverless driver; do not keep a WebSocket/Pool alive between Worker requests. */
export async function queryDb<T = Row>(query: string, parameters: unknown[] = []): Promise<T[]> {
  const sql = neon(connectionString());
  return await sql.query(query, parameters) as T[];
}
