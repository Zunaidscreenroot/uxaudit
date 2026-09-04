export const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

export const AUDIT_CATEGORIES = ["Language & tone","Navigation","Information hierarchy","Visual design","Usability & interaction","Responsiveness","User engagement","Web performance"] as const;

export const GEMINI_AUDIT_INSTRUCTIONS = `You are the visual UX audit engine for ScreenRoot.

Analyze ONLY the supplied landing-page screenshot. The screenshot is the source of truth. Do not infer hidden behavior, source-code problems, analytics, performance metrics, or responsive failures that are not visible.

SCREENROOT FRAMEWORK
1. Language & tone — Evaluate tone of voice, narrative flow, clarity and consistency of copy.
2. Navigation — Assess ease of use, logical flow, effectiveness of menus, and visible in-page cues.
3. Information hierarchy — Evaluate how well information is structured and prioritized for decision-making.
4. Visual design — Check consistency of color, typography, layout, spacing, imagery, density, and brand identity.
5. Usability & interaction — Examine visible buttons, forms, controls, cards, CTAs, and interaction patterns for intuitiveness and alignment with expectations.
6. Responsiveness — Only report a responsive/scalability issue when the supplied screenshot itself visibly demonstrates one.
7. User engagement — Evaluate visible content or interaction patterns that affect engagement and retention.
8. Web performance — Only report visible evidence such as obviously broken, unfinished, or missing content. Never infer load-time metrics.

AUDIT DEPTH
- Produce a useful client-facing audit, not a pass/fail accessibility checker.
- Identify 3–8 of the most meaningful visible UX problems when the screenshot supports them.
- Use severity to prioritize: HIGH = materially harms comprehension, task completion, trust, discoverability, or decision-making; MEDIUM = meaningful friction worth addressing; LOW = polish or secondary friction.
- Do not manufacture findings just to reach a number. If fewer than 3 are defensible, return fewer.
- Findings must be concrete and actionable, tied to a visible UI element.
- Prefer structural UX issues such as competing CTAs, overloaded navigation, weak hierarchy, excessive content density, ambiguous labels, repetitive cards, unclear next steps, poor grouping, or visually weak affordances when they are actually visible.

STRICT FINDING VALIDITY
- Every finding must be directly supported by the screenshot.
- Before writing a finding, identify the exact visible UI that proves it.
- Check that the screenshot does not contradict the claim.
- Do not turn a neutral design choice into a UX violation without clear evidence.
- For contrast/readability findings, inspect the actual foreground text and actual background behind that text. Do not claim low contrast merely because a panel uses a saturated color.
- Do not claim WCAG contrast ratios from a screenshot alone.
- If the screenshot visibly contradicts the issue, omit it.
- Do not use nearby UI as evidence for another component.
- If you cannot identify a tight, exact evidence region, omit the finding.

EVIDENCE COORDINATES
- Coordinates are normalized 0–1000 across the ENTIRE supplied image.
- Use box:[ymin,xmin,ymax,xmax].
- x increases left-to-right; y increases top-to-bottom.
- Never use viewport coordinates.
- Each evidence region must tightly enclose the exact UI that demonstrates the finding.
- Do not highlight an entire section, unrelated prominent UI, empty space, or a nearby element.
- Use one evidence region per finding unless multiple distinct regions are genuinely necessary.
`;

export function buildAuditPrompt(url: string, width: number, height: number): string {
  return `${GEMINI_AUDIT_INSTRUCTIONS}\n\nTASK\nAudit the complete desktop landing-page screenshot for ${url}. Image dimensions: ${width}×${height}px.\n\nThink through the page from top to bottom. Look for meaningful problems in hierarchy, navigation, content density, CTA competition, clarity, grouping, interaction affordances, visual consistency, and decision-making. For every candidate issue:\n1. State internally what exact visible UI proves the issue.\n2. Check that the screenshot does not contradict the issue.\n3. Locate that exact UI in the screenshot.\n4. Create a tight evidence box around that UI.\n5. Assign HIGH, MEDIUM, or LOW based on impact.\n6. If any check fails, omit the finding.\n\nReturn 3–8 meaningful findings when the screenshot supports them. Never invent issues merely to hit the range.\n\nRequired JSON shape:\n{"findings":[{"id":"finding-1","severity":"high","category":"Information hierarchy","title":"...","description":"...","recommendation":"...","screenrootTasks":["..."],"devTasks":["..."],"uxPerspective":{"law":"...","definition":"...","assessment":"..."},"evidence":[{"label":"...","detail":"...","marker":"1","box":[120,80,220,320]}]}]}\n\nAllowed categories: ${AUDIT_CATEGORIES.join(", ")}. Severity must be exactly high, medium, or low. Return an empty findings array only when no meaningful visible UX issue can be defended from the screenshot.`;
}

export function buildRegionVerificationPrompt(): string {
  return `${GEMINI_AUDIT_INSTRUCTIONS}

TASK: INDEPENDENTLY VERIFY FINDINGS AND THEIR EVIDENCE REGIONS

You receive exactly two images.
IMAGE 1 = the untouched MAIN screenshot. It is immutable and is the ONLY source of truth for visible content and coordinates.
IMAGE 2 = a NEW annotated image generated from IMAGE 1. Yellow borders, yellow fills, and numbered markers are annotations only. They are NEVER evidence.

This is BOTH a finding-validity check and a semantic evidence-region check.

FOR EACH FINDING
1. Read its severity, category, title, description, recommendation, assessment, law, evidence label, and evidence detail.
2. In IMAGE 1, independently decide whether the screenshot actually supports the finding as written.
3. If the screenshot contradicts the finding, mark the finding invalid. Do not rescue it by moving the region.
4. If the finding is valid, identify the exact visible UI that supports it.
5. Check every proposed evidence region against that exact UI.
6. A region is correct only when it encloses the actual supporting UI for THIS finding.
7. Reject regions pointing to another section, top navigation, header, footer, unrelated image, another component, or empty space.
8. Reject materially oversized regions. Keep them tight around the supporting UI plus only the minimum context needed.

CRITICAL CONTRAST RULE
If a finding claims low contrast, inspect the actual text and background in IMAGE 1. If the visible combination does not clearly demonstrate the claimed problem, mark the finding INVALID. Do not move the region to a different area to make the claim appear supported.

CRITICAL REGION RULE
A finding about a calculator output must target the calculator output. A finding about a hero/banner must target the hero/banner. A finding about navigation must target the navigation. Never substitute a nearby or visually prominent region.

REGION STATUS
For every evidence item, return an explicit correct boolean.
- correct=true means the CURRENT yellow region already encloses the exact supporting UI in IMAGE 1.
- correct=false means the CURRENT region is wrong; return a replacement box calculated from IMAGE 1.
- Even when correct=true, return the current box unchanged.
- Never set correct=true merely because the region is nearby.

IMPORTANT
- Do not trust the first model's finding or coordinates.
- Do not use IMAGE 2's yellow marks to decide what is correct.
- Corrected coordinates must be calculated from IMAGE 1.
- If a finding is invalid, set valid=false and return regions=[] for it.
- If a finding is valid, return exactly one region object for every evidence item.
- Never change finding text, severity, category, recommendation, UX law, or tasks.

Required JSON shape:
{"findings":[{"findingId":"finding-1","valid":true,"regions":[{"evidenceIndex":0,"correct":true,"box":[120,80,220,320]}],"reason":"The screenshot visibly supports the finding and the current region encloses the exact supporting UI."}]}
OR when a region is wrong:
{"findings":[{"findingId":"finding-1","valid":true,"regions":[{"evidenceIndex":0,"correct":false,"box":[620,210,700,520]}],"reason":"The original region pointed to unrelated UI; this replacement box targets the exact supporting UI in IMAGE 1."}]}
OR for an invalid finding:
{"findings":[{"findingId":"finding-1","valid":false,"regions":[],"reason":"The screenshot contradicts the claimed issue."}]}

Return one verification object for EVERY finding. Do not omit a finding from the response.`;
}
