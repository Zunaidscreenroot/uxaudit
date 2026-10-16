import { getMcpIssuer } from "@/lib/mcp-oauth";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const issuer = getMcpIssuer(request);
  return Response.json({
    resource: issuer + "/api/mcp", authorization_servers: [issuer], bearer_methods_supported: ["header"],
    scopes_supported: ["audit:read", "audit:run", "ia:generate", "offline_access"],
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
