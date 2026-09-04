export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"] as const;

export const AUDIT_CATEGORIES = [
  "Language & tone",
  "Navigation",
  "Information hierarchy",
  "Visual design",
  "Usability & interaction",
  "Responsiveness",
  "User engagement",
  "Web performance",
] as const;

export const GEMINI_AUDIT_INSTRUCTIONS = `
You are the visual UX audit engine for ScreenRoot.

CORE RULES
- Analyze only the supplied landing-page screenshot(s).
- Audit the visible page against the ScreenRoot framework categories.
- Do not invent hidden interactions, source-code behavior, analytics, accessibility states, responsive behavior, or performance metrics that are not directly visible.
- Return only HIGH-priority issues. Ignore medium and low issues.
- Prefer 1–5 strong, defensible findings over many weak findings.
- Do not force every framework category to appear.
- Every finding must have direct visual evidence in the screenshot.
- Evidence regions must be tight around the actual UI that demonstrates the issue.
- Never highlight an entire page, large section, unrelated content, or empty space just to provide evidence.

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
- The complete screenshot is the coordinate system.
- Coordinates are normalized to 0–1000.
- Use box:[ymin,xmin,ymax,xmax].
- x increases from left to right; y increases from top to bottom.
- Coordinates are for the entire screenshot, not the current viewport.
- Keep every box as small as possible while still containing the visual evidence.
- For text, the box should tightly contain the problematic text/control and its immediately relevant visual context.
- For a component, include the component itself, not the whole surrounding section.

OUTPUT
Return strict JSON only. No markdown. No commentary.
`;

export function buildAuditPrompt(url: string, width: number, height: number): string {
  return `${GEMINI_AUDIT_INSTRUCTIONS}\n\nTASK\nAnalyze the untouched complete desktop screenshot for ${url}. The image is ${width}×${height}px. Identify only high-priority visual UX issues and give each issue precise evidence coordinates.\n\nRequired JSON shape:\n{"findings":[{"id":"finding-1","severity":"high","category":"Usability & interaction","title":"...","description":"...","recommendation":"...","screenrootTasks":["..."],"devTasks":["..."],"uxPerspective":{"law":"...","definition":"...","assessment":"..."},"evidence":[{"label":"...","detail":"...","marker":"1","box":[120,80,220,320]}]}]}\n\nAllowed categories: ${AUDIT_CATEGORIES.join(", ")}. Every severity must be high. Evidence boxes must use the full-image normalized coordinate system above.`;
}

export function buildRegionVerificationPrompt(): string {
  return `${GEMINI_AUDIT_INSTRUCTIONS}\n\nTASK\nYou are now validating evidence placement. Image 1 is the untouched MAIN screenshot and must never be modified. Image 2 is a NEW annotated screenshot created from Image 1 by drawing the proposed evidence regions.\n\nCompare Image 2 against Image 1. For every proposed region, decide whether it tightly and correctly highlights the UI that supports its finding. Ignore the yellow graphics themselves when judging the underlying UI.\n\nIf every region is correct, return correct=true and keep regions empty.\nIf any region is incorrect, return correct=false and provide corrected coordinates for EVERY region, including regions that were already correct. Corrected coordinates must be based on Image 1 and use the full-image normalized [ymin,xmin,ymax,xmax] coordinate system. Do not change findings, severity, category, or issue text. Only correct evidence placement.\n\nRequired JSON shape:\n{"correct":true,"regions":[],"notes":"All proposed regions tightly match the visible evidence."}\nOR\n{"correct":false,"regions":[{"findingId":"finding-1","evidenceIndex":0,"box":[120,80,220,320]}],"notes":"Explain briefly which placements needed correction."}\n\nBe conservative: a region is correct only when it points to the actual evidence and is not materially oversized or displaced.`;
}
