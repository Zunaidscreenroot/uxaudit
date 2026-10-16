import { POST as handleMcpPost } from "../../app/api/mcp/route";

export default async function mcpFunction(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("UX Audit MCP supports POST requests only.", {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  // Reuse the same OAuth validation, scoped tool registry, and audit service calls
  // as the Next.js endpoint. This keeps authorization and business logic in one place.
  return handleMcpPost(request);
}

export const config = {
  path: "/mcp",
  rateLimit: {
    windowSize: 60,
    windowLimit: 40,
    aggregateBy: ["ip", "domain"],
  },
};
