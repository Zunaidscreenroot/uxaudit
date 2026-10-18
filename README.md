# UX Audit

AI-assisted UX auditing platform for turning website experiences into prioritized, evidence-led findings.

## Capabilities

- Website information-architecture discovery from public navigation and sitemap files
- Desktop and mobile screenshot capture with server-side Chromium
- Evidence-led UX findings, severity, recommendations and screenshot markers
- OpenRouter model connection and cost status
- Saved IA sessions, findings, and improved IA proposals
- Remote MCP server with OAuth authorization for ChatGPT-compatible clients

## Shared UX Brain

UX Audit uses the persistent shared brain hosted by UX Direct, also used by the UX Direct planner and Figma plugin. Coaching is a backend/MCP operation: ChatGPT interprets natural-language or Hindi/Hinglish feedback, saves the original plus a normalized lesson as a draft, and activates it only after explicit approval. There is no Coach & Learn frontend page.

- Shared source-backed guidance and approved reusable rules are retrieved with a bounded context budget before UX reasoning.
- Keyword retrieval is always available; vector retrieval is opt-in when a shared embedding provider is configured.
- Scope defaults distinguish general UX from Indian BFSI and named projects (DMI HFC / Ujjivan SFB).
- Client screenshots and saved client-specific findings remain in **Past findings**. They may be examples for the relevant client/audit, but are never automatically promoted into global product memory.
- Current screenshot evidence remains mandatory; memory does not prove a finding, legal violation, WCAG conformance, or measured business impact.
- UX Audit server-side environment variables: `UX_SHARED_BRAIN_URL=https://uxdirect.netlify.app/api/brain` and `UX_DIRECT_BRAIN_API_KEY`. Keep the key secret; never add either secret material or service-role credentials to browser/extension bundles.

## Remote MCP connection

Production MCP endpoint:

`https://uxaudit-screenroot.vercel.app/api/mcp`

OAuth discovery endpoints (rewritten by Vercel/Next.js to registered API routes):

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`

Available MCP tools include:

- `uxaudit_get_connection_status` — verify server and OpenRouter connectivity without model inference
- `uxaudit_discover_site` — discover public pages and information architecture
- `uxaudit_run_page_audit` — run a desktop or mobile page audit; may incur model API costs
- `uxaudit_get_session_report` and `uxaudit_get_findings` — retrieve saved session results
- `uxaudit_generate_improved_ia` — generate a reviewable IA proposal
- `uxaudit_save_coaching_lesson` — preserve owner feedback (including Hindi/Hinglish) as a scoped draft or explicitly approved rule
- `uxaudit_list_coaching_lessons` and `uxaudit_review_coaching_lesson` — review stored lessons and approve/reject/archive them

For a preview test, use that preview deployment's host and append `/api/mcp`.

## Required Vercel environment variables

- `UXAUDIT_MCP_OAUTH_SECRET`: a secret value of at least 32 characters, available to the target deployment.
- `UXAUDIT_MCP_LOGIN_PASSWORD`: the private password entered on the OAuth consent screen. For branch-isolated testing, scope it to the intended Preview git branch.
- `OPENROUTER_API_KEY`: the server-side OpenRouter inference key.

`UXAUDIT_MCP_ISSUER_URL` is optional. When unset, the server derives the issuer from the request origin. Do not set it to the production hostname on a preview deployment.

The MCP endpoint requires a valid OAuth access token. OAuth uses authorization code flow with PKCE (S256), short-lived access tokens, refresh tokens, and scope checks. The login password is never returned through the MCP API.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The local MCP endpoint is `http://localhost:3000/api/mcp`.

## Roadmap

1. Improve multi-page crawl coverage and interaction-aware discovery
2. Add accessibility and responsive checks
3. Expand interaction-aware audits with screenshot evidence
4. Improve saved project history
5. Refine AI prioritization and recommendations
6. Add report export and shareable audit links
