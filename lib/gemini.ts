// Direct Gemini models remain as a fallback when OpenRouter is unavailable.
export const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

export const AUDIT_CATEGORIES = ["Language & tone","Navigation","Information hierarchy","Visual design","Usability & interaction","Responsiveness","User engagement","Web performance"] as const;

export const GEMINI_AUDIT_INSTRUCTIONS = `You are the visual UX audit engine for ScreenRoot.

Analyze ONLY the supplied landing-page screenshot. The screenshot is the source of truth. Do not infer or invent facts that cannot be established visually.

SCREENROOT FRAMEWORK
1. Language & tone — Evaluate tone of voice, narrative flow, clarity and consistency of copy.
2. Navigation — Assess ease of use, logical flow, effectiveness of menus, breadcrumbs, and in-page cues.
3. Information hierarchy — Evaluate how well information is structured and prioritized for decision-making.
4. Visual design — Check consistency of visual elements like color, typography, layout, and brand identity.
5. Usability & interaction — Examine visible buttons, forms, controls, and interaction patterns for intuitiveness and alignment with expectations.
6. Responsiveness — Only report a responsive/scalability issue when the supplied screenshot itself visibly demonstrates one. Never infer mobile/tablet failure from a desktop screenshot.
7. User engagement — Evaluate visible content or interaction patterns that affect engagement and retention.
10. Web performance — Only report visible evidence such as obviously broken/unfinished loading states. Never infer load-time metrics from a screenshot.

STRICT FINDING VALIDITY RULES
- Return ONLY HIGH-priority issues that are directly and clearly supported by the screenshot.
- Before writing a finding, independently verify that the claimed problem is actually visible.
- If the screenshot contradicts the proposed problem, DO NOT report it.
- Do not turn a neutral design choice into a UX violation without clear visual evidence.
- For contrast/readability findings, inspect the actual foreground text and the actual background behind that text. Do not claim low contrast merely because a panel uses a saturated color. If the text is clearly white/light on a sufficiently dark or saturated background, do not call it low contrast unless the screenshot visibly supports the claim.
- Do not claim WCAG contrast ratios from a screenshot unless the visible colors provide clear evidence. A screenshot alone is not a precise contrast-measurement instrument.
- Do not use a nearby component as evidence for another component.
- Every finding must have evidence that supports the exact wording of the finding.
- If you cannot identify a tight, exact evidence region, omit the finding.

EVIDENCE COORDINATES
- Coordinates are normalized 0–1000 across the ENTIRE supplied image.
- Use box:[ymin,xmin,ymax,xmax].
- x increases left-to-right; y increases top-to-bottom.
- Never use viewport coordinates.
- Each region must tightly enclose the exact UI that demonstrates the finding.
- Do not highlight an entire section, unrelated prominent UI, empty space, or a nearby element.
`;

export function buildAuditPrompt(url: string, width: number, height: number): string {
  return `${GEMINI_AUDIT_INSTRUCTIONS}\n\nTASK\nAudit the complete desktop landing-page screenshot for ${url}. Image dimensions: ${width}×${height}px.\n\nFor every candidate issue, follow this order before returning it:\n1. State internally what exact visible UI proves the issue.\n2. Check that the screenshot does not contradict the issue.\n3. Locate that exact UI in the screenshot.\n4. Create a tight evidence box around that UI.\n5. If any of those checks fail, omit the finding.\n\nRequired JSON shape:\n{"findings":[{"id":"finding-1","severity":"high","category":"Visual design","title":"...","description":"...","recommendation":"...","screenrootTasks":["..."],"devTasks":["..."],"uxPerspective":{"law":"...","definition":"...","assessment":"..."},"evidence":[{"label":"...","detail":"...","marker":"1","box":[120,80,220,320]}]}]}\n\nAllowed categories: ${AUDIT_CATEGORIES.join(", ")}. Every severity must be high. Return an empty findings array when no high-priority issue is clearly supported.`;
}

export function buildRegionVerificationPrompt(): string {
  return `${GEMINI_AUDIT_INSTRUCTIONS}

TASK: INDEPENDENTLY VERIFY FINDINGS AND THEIR EVIDENCE REGIONS

You receive exactly two images.
IMAGE 1 = the untouched MAIN screenshot. It is immutable and is the ONLY source of truth for visible content and coordinates.
IMAGE 2 = a NEW annotated image generated from IMAGE 1. Yellow borders, yellow fills, and numbered markers are annotations only. They are NEVER evidence.

This is BOTH a finding-validity check and a semantic evidence-region check.

FOR EACH FINDING
1. Read its category, title, description, assessment, evidence label, and evidence detail.
2. In IMAGE 1, independently decide whether the screenshot actually supports the finding as written.
3. If the screenshot contradicts the finding, mark the finding invalid. Do not try to rescue it by moving the region.
4. If the finding is valid, identify the exact visible UI that supports it.
5. Check every proposed evidence region against that exact UI.
6. A region is correct only when it encloses the actual supporting UI for THIS finding. Nearby, prominent, or same-section UI is not sufficient.
7. Reject regions pointing to another section, top navigation, header, footer, unrelated image, another component, or empty space.
8. Reject materially oversized regions. Keep them tight around the supporting UI plus only the minimum context needed.

CRITICAL CONTRAST EXAMPLE
If a finding says "Low contrast EMI result text", inspect the actual EMI number and label in the calculator output card in IMAGE 1. If the EMI text is visibly white/light on a green card and does NOT visibly demonstrate the claimed low-contrast problem, the finding is INVALID and must be removed. Do not move its region to a different green/yellow area just to make the finding appear supported.

CRITICAL REGION EXAMPLE
A finding about calculator output must have a region around the calculator output. A yellow rectangle around the hero/banner, navigation bar, or another green section is WRONG and must be rejected.

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
{"findings":[{"findingId":"finding-1","valid":false,"regions":[],"reason":"The screenshot contradicts the claimed issue; the visible text/background combination does not demonstrate low contrast."}]}

Return one verification object for EVERY finding. Do not omit a finding from the response.`;
}
