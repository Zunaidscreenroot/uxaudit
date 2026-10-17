# UX Audit

AI-assisted UX auditing platform for turning website experiences into prioritized, actionable findings.

## Current capabilities

- Next.js + TypeScript application
- Website information-architecture discovery from public navigation and common sitemap files
- Desktop and mobile website screenshot capture with server-side Chromium
- Evidence-led UX findings, severity, recommendations and screenshot markers
- OpenRouter model connection and cost status
- Knowledge-base persistence for saved audits

## Remote MCP connection

The application exposes a stateless Streamable HTTP MCP endpoint at:

`https://uxaudit-screenroot.vercel.app/api/mcp`

Available tools:

- `get_connection_status` — check MCP and OpenRouter connectivity without running inference.
- `discover_website` — discover a website's public pages and information architecture.
- `audit_website_page` — capture and audit one public page using OpenRouter, then save the report.

For a preview deployment, replace the host with that deployment's Vercel URL and append `/api/mcp`.

### Authentication

Set `UXAUDIT_MCP_API_KEY` in the Vercel project environment to require the header `Authorization: Bearer <key>` on MCP requests. If this variable is unset, the MCP endpoint is public. Because page audits can incur model API costs, configure a key before exposing the endpoint to external clients.

The endpoint also requires the existing `OPENROUTER_API_KEY` to perform AI audits. Audit persistence uses the same Supabase server credentials as the web application.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The local MCP endpoint is `http://localhost:3000/api/mcp`.

## Roadmap

1. Improve multi-page crawl coverage and interaction-aware discovery
2. Add accessibility and responsive checks
3. Add heuristic analysis with screenshot evidence
4. Persist projects and audit history in Supabase
5. Improve AI prioritization and recommendations
6. Add report export and shareable audit links
