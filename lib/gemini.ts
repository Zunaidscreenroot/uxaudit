export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"] as const;

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

TASK: VERIFY EVIDENCE REGIONS
You receive exactly two images.
IMAGE 1 = the untouched MAIN screenshot. It is immutable and is the ONLY source of truth for where evidence exists.
IMAGE 2 = a NEW annotated image generated from IMAGE 1. Yellow borders and markers are annotations only. They are NEVER evidence.

For EACH evidence item:
1. Read its finding title, description, category and evidence label.
2. Ignore the yellow annotation completely.
3. Look at IMAGE 1 and locate the exact UI element that actually supports the finding.
4. Compare that location with the yellow region in IMAGE 2.
5. Reject the region if it is displaced to another page section, top navigation, header, footer, unrelated image, nearby component, or empty space.
6. Reject it if it is materially oversized. Keep the region tightly around the supporting UI.
7. Do not accept a region merely because it is close to the correct area or visually prominent.

CRITICAL EXAMPLE
Finding: "Low contrast text over promotional background".
Correct evidence: the white promotional text in the hero/banner and its immediately relevant background.
WRONG evidence: a yellow rectangle around the TOP NAVIGATION BAR. That region MUST be rejected and replaced with coordinates around the actual promotional text/background in the hero.

If ANY region is wrong, return correct=false and corrected coordinates for EVERY evidence item. Calculate every corrected coordinate from IMAGE 1, never from IMAGE 2 or from the yellow border.
If ALL regions are correct, return correct=true and regions=[].

Required JSON shape:
{"correct":true,"regions":[],"notes":"All proposed regions tightly match the supporting UI."}
OR
{"correct":false,"regions":[{"findingId":"finding-1","evidenceIndex":0,"box":[120,80,220,320]}],"notes":"The proposed region was displaced and has been corrected against IMAGE 1."}

Only change evidence coordinates. Do not change finding text, category, severity, recommendation, UX law, or tasks.
`;
}
