// Gemini model order is intentionally resilient to temporary capacity spikes.
// 3.6 Flash is the primary audit model; lighter stable models provide fallbacks.
export const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

export const AUDIT_CATEGORIES = ["Language & tone","Navigation","Information hierarchy","Visual design","Usability & interaction","Responsiveness","User engagement","Web performance"] as const;

export const GEMINI_AUDIT_INSTRUCTIONS = `You are the visual UX audit engine for ScreenRoot.

Analyze only the supplied landing-page screenshot(s). Audit the visible page against the ScreenRoot framework. Return only HIGH-priority issues. Every finding must have direct visual evidence. Do not invent hidden interactions, source-code behavior, analytics, accessibility states, responsive behavior, or performance metrics that are not visible.

SCREENROOT FRAMEWORK
1. Language & tone — Evaluate tone of voice, narrative flow, clarity and consistency of copy.
2. Navigation — Assess ease of use, logical flow, effectiveness of menus, breadcrumbs, and in-page cues.
3. Information hierarchy — Evaluate how well information is structured and prioritized for decision-making.
4. Visual design — Check consistency of visual elements like color, typography, layout, and brand identity.
5. Usability & interaction — Examine buttons, forms, controls, and visible interaction patterns for intuitiveness and alignment with expectations.
6. Responsiveness — Only report visible evidence of layout/scalability problems in the supplied screenshot. Do not claim responsive failure from a desktop screenshot alone.
7. User engagement — Evaluate visible content or interaction patterns that affect engagement and retention.
10. Web performance — Only report visible evidence such as obviously broken/unfinished loading states. Do not infer actual load-time metrics from a screenshot.

EVIDENCE COORDINATES
- The untouched MAIN screenshot is the sole coordinate source of truth.
- Coordinates are normalized to 0–1000 across the ENTIRE image.
- Use box:[ymin,xmin,ymax,xmax].
- x increases left-to-right; y increases top-to-bottom.
- Never interpret coordinates as viewport coordinates.
- Every region must point to the exact UI that supports the finding.
- Keep regions tight; never highlight an entire page, large unrelated section, empty space, or nearby prominent UI.
`;

export function buildAuditPrompt(url: string, width: number, height: number): string {
  return `${GEMINI_AUDIT_INSTRUCTIONS}\n\nTASK\nAnalyze the untouched complete desktop screenshot for ${url}. Image dimensions: ${width}×${height}px. Before returning coordinates, visually locate the exact UI element that demonstrates each issue.\n\nRequired JSON shape:\n{"findings":[{"id":"finding-1","severity":"high","category":"Visual design","title":"...","description":"...","recommendation":"...","screenrootTasks":["..."],"devTasks":["..."],"uxPerspective":{"law":"...","definition":"...","assessment":"..."},"evidence":[{"label":"...","detail":"...","marker":"1","box":[120,80,220,320]}]}]}\n\nAllowed categories: ${AUDIT_CATEGORIES.join(", ")}. Every severity must be high.`;
}

export function buildRegionVerificationPrompt(): string {
  return `${GEMINI_AUDIT_INSTRUCTIONS}

TASK: VERIFY AND, IF NECESSARY, CORRECT EVIDENCE REGIONS
You receive exactly two images.
IMAGE 1 = the untouched MAIN screenshot. It is immutable and is the ONLY source of truth for both visual content and coordinates.
IMAGE 2 = a NEW annotated image generated from IMAGE 1. Yellow borders, translucent yellow fills, and numbered markers are annotations only. They are NEVER evidence.

This is a semantic verification task, not merely a geometric check.

FOR EACH REGION
1. Read the supplied FINDING CONTEXT: category, title, description, assessment, evidence label, and evidence detail.
2. Determine exactly WHICH visible UI element in IMAGE 1 supports that specific finding.
3. Ignore the yellow annotation while deciding what the correct evidence is.
4. Find that UI element in IMAGE 1.
5. Compare its real location to the corresponding yellow region in IMAGE 2.
6. The region is CORRECT only if it encloses the actual supporting UI for THIS finding. Being visually nearby, prominent, or inside the same general section is NOT sufficient.
7. Reject regions that point to another section, top navigation, header, footer, unrelated image, another component, or empty space.
8. Reject materially oversized regions. The region should be tight around the supporting UI plus only the minimum surrounding context needed to establish the UX issue.

CRITICAL EXAMPLE
Finding context: Visual design → "Low contrast text over promotional background" → evidence: "Low contrast overlay text" → white text on complex photographic background.
The correct target is the promotional text in the hero/banner and its immediately relevant background.
A yellow rectangle around the TOP NAVIGATION BAR is WRONG even if it is close to the banner. It MUST be rejected and replaced with coordinates around the actual promotional text/background.

IMPORTANT
- Do NOT judge whether the finding itself is a good UX finding. Assume the finding is fixed; only verify whether its region points to the evidence described by the finding.
- Do NOT preserve a bad coordinate just because it came from the first analysis.
- If a region is wrong, find the correct UI yourself in IMAGE 1 and return new coordinates.
- If ANY region is wrong, return corrected coordinates for EVERY evidence item so the renderer can rebuild a complete clean annotation image from IMAGE 1.
- Corrected coordinates must be calculated from IMAGE 1, never from IMAGE 2 and never from the yellow border.
- Never change finding text, severity, category, recommendation, UX law, or tasks.

DECISION RULE
Return correct=true ONLY when you have independently confirmed that EVERY yellow region corresponds semantically and spatially to the evidence described for its finding.

Required JSON shape:
{"correct":true,"regions":[],"notes":"Every proposed region semantically and spatially matches its finding."}
OR
{"correct":false,"regions":[{"findingId":"finding-1","evidenceIndex":0,"box":[120,80,220,320]}],"notes":"The region was pointing to unrelated UI; corrected against IMAGE 1."}
`;
}