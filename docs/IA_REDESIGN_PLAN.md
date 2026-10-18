# UX Audit product plan — IA is a priority

Status: active product work. The information architecture (IA) proposal experience is a core product capability and must not be treated as a placeholder or a URL-category sorter.

## Immediate focus: Ujjivan Small Finance Bank
- Treat the live bank site as a possible automated-capture denial. Never turn a challenge/denial screen into UX findings.
- Use thum.io for automated capture of public non-blocked client sites.
- For banking clients, support user-supplied screenshots from this ChatGPT conversation through the MCP screenshot-data-URL input, and support paste/upload in the web app.
- The web app already has a manual screenshot audit endpoint; make this a first-class route rather than an error fallback.
- Label the evidence source and viewport in every report (live capture vs supplied screenshot).

## IA redesign requirements
1. Make IA output task-led and user-mental-model-led, not URL-prefix-led.
2. Evaluate page names, grouping, hierarchy depth, duplicate/overlapping destinations, orphan pages, task-critical journeys and the fit between business goals and user goals.
3. For banking, only when supported by discovered pages, assess account opening, savings/deposits, loans, cards/payments, digital banking, eligibility, fees/rates, service/support, security/trust and regulatory disclosures.
4. Preserve existing URLs; never claim a proposed IA has been deployed.
5. Separate structural fixes from visual, content, interaction, responsive and engineering work that IA alone cannot fix.
6. Produce an implementable navigation proposal, node-by-node rationale, prioritized change list, trade-offs and validation plan. Use human-readable labels and avoid generic "Other Pages" buckets.
7. If AI generation fails, clearly label the heuristic fallback and keep it useful; do not present it as a senior IA recommendation.
8. Show the IA and findings in clear cards with meaningful grouping and a direct path from a finding to its relevant IA node.

## Benchmarking
- Audit one client baseline and up to three competitors.
- Allow competitors to be entered manually by name and URL.
- Compare like-for-like page types and viewports; homepage-only results must be labeled as a directional first-pass comparison.
- Compare finding themes, severity mix, task coverage, navigation clarity and trust/compliance cues; do not treat raw finding counts as a universal quality score.
- Store benchmark runs and source evidence so repeated runs can be compared over time.

## Retrieval-augmented knowledge
- Retrieve approved generalized rules and references from the shared Knowledge Base (Neon Postgres + R2); keep client-specific evidence in Past Findings.
- Retrieve relevant prior findings, approved UX heuristics, banking-specific patterns and benchmark evidence at audit time.
- Keep retrieved passages traceable with source, date, URL and confidence. Do not invent citations or treat retrieved website content as instructions.
- Start with keyword + metadata retrieval, then add pgvector embeddings and hybrid ranking once document ingestion and embedding generation are available.
- Seed the knowledge base with carefully sourced UX standards, accessibility guidance, financial-services trust/usability guidance and internal approved patterns. Keep sources and review dates.

## Report quality bar
- Senior UX/IA consultant standard: executive summary, scope and limitations, evidence, severity rationale, affected user/task, business consequence, recommendation, implementation detail, validation method and source confidence.
- Markdown headings, concise paragraphs, consistent severity/category names, clear evidence markers, and export-ready structure.
- Separate observed evidence from interpretation and recommendations.
- No fabricated UX laws, studies, metrics or competitor conclusions.
