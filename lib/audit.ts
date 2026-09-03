export type Severity = "high" | "medium" | "low";

export type Evidence = {
  label: string;
  detail: string;
  marker: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Finding = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  recommendation: string;
  screenrootTasks: string[];
  uxPerspective: {
    law: string;
    definition: string;
    assessment: string;
  };
  evidence: Evidence[];
};

export type AuditResult = {
  url: string;
  score: number;
  summary: string;
  pageTitle: string;
  screenshotUrl: string;
  findings: Finding[];
};

function countMatches(html: string, pattern: RegExp) {
  return (html.match(pattern) ?? []).length;
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function makeScreenshotUrl(url: string) {
  return `https://image.thum.io/get/width/1440/crop/1000/${encodeURIComponent(url)}`;
}

export async function createAudit(url: string): Promise<AuditResult> {
  let html = "";
  let pageTitle = url;
  let fetchError = "";

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "ScreenRoot-UX-Audit/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Website returned ${response.status}`);
    html = await response.text();
    pageTitle = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url).slice(0, 120) || url;
  } catch (error) {
    fetchError = error instanceof Error ? error.message : "Unable to fetch the website.";
  }

  const navLinks = countMatches(html, /<nav\b/gi) || countMatches(html, /<a\b[^>]*href/gi);
  const headings = countMatches(html, /<h[1-6]\b/gi);
  const buttons = countMatches(html, /<(button|a)\b[^>]*(class|role)=[^>]*(button|cta)/gi);
  const forms = countMatches(html, /<form\b/gi);
  const images = countMatches(html, /<img\b/gi);
  const imagesWithoutAlt = countMatches(html, /<img\b(?![^>]*\balt\s*=)[^>]*>/gi);
  const inputs = countMatches(html, /<input\b/gi);
  const paragraphs = countMatches(html, /<p\b/gi);

  const findings: Finding[] = [];

  if (navLinks > 8) {
    findings.push({
      id: "navigation-choice-load",
      severity: "high",
      category: "Navigation and wayfinding",
      title: "Navigation presents a high choice load",
      description: `The page exposes approximately ${navLinks} navigation/link targets. A large choice set can make it harder to decide where to go next, especially when labels are similar.`,
      recommendation: "Reduce competing top-level choices, group related destinations, and make the primary journey visually dominant.",
      screenrootTasks: [
        "Review the information architecture and top-level navigation hierarchy.",
        "Consolidate overlapping destinations and rewrite labels around user tasks.",
        "Define one primary navigation path for the highest-value user journeys.",
      ],
      uxPerspective: {
        law: "Hick's Law",
        definition: "The time and effort required to make a decision generally increases as the number of available choices increases.",
        assessment: "Potential violation: the detected number of link choices increases decision effort. Validate with task-based testing before treating this as a definitive usability failure.",
      },
      evidence: [{ label: "Navigation / links", detail: `${navLinks} link targets detected`, marker: 1, x: 6, y: 12, width: 88, height: 12 }],
    });
  }

  if (buttons === 0 || buttons < 1) {
    findings.push({
      id: "primary-action-clarity",
      severity: "high",
      category: "Interaction and conversion",
      title: "A clearly identifiable primary action was not detected",
      description: "The page markup does not expose an obvious CTA/button pattern that can be identified from common button semantics or naming.",
      recommendation: "Establish a single dominant CTA for the page goal and use consistent styling and language for it.",
      screenrootTasks: [
        "Define the primary user task and corresponding CTA.",
        "Create a clear visual hierarchy between primary and secondary actions.",
        "Test CTA comprehension without relying on surrounding explanatory copy.",
      ],
      uxPerspective: {
        law: "Fitts's Law",
        definition: "The time to acquire a target is influenced by its size and distance; larger, well-positioned targets are generally easier and faster to select.",
        assessment: "Potential violation: a missing or weakly signalled primary target can increase interaction effort. Confirm against the rendered interface.",
      },
      evidence: [{ label: "Primary action", detail: "No common CTA/button pattern detected", marker: 2, x: 65, y: 30, width: 28, height: 12 }],
    });
  }

  if (headings < 2 || paragraphs > 12) {
    findings.push({
      id: "content-scannability",
      severity: "medium",
      category: "Content hierarchy and scannability",
      title: "Content hierarchy may not support fast scanning",
      description: `The page contains ${headings} heading elements and approximately ${paragraphs} paragraph blocks. Dense content with weak structural breaks can increase scanning effort.",
      recommendation: "Use descriptive section headings, shorter content blocks, bullets, and progressive disclosure for secondary information.",
      screenrootTasks: [
        "Create a content hierarchy around user questions and tasks.",
        "Break dense copy into scannable sections with descriptive headings.",
        "Prioritise the information users need before optional detail.",
      ],
      uxPerspective: {
        law: "Jakob's Law",
        definition: "Users tend to expect interfaces to work in ways similar to interfaces they already know.",
        assessment: "Potential violation: unconventional or weakly signposted content structure can increase orientation effort. Review against established web patterns.",
      },
      evidence: [{ label: "Content structure", detail: `${headings} headings / ${paragraphs} paragraphs detected`, marker: 3, x: 7, y: 35, width: 86, height: 38 }],
    });
  }

  if (images > 0 && imagesWithoutAlt > 0) {
    findings.push({
      id: "image-accessibility",
      severity: "medium",
      category: "Accessibility",
      title: "Some images appear to lack alternative text",
      description: `${imagesWithoutAlt} of approximately ${images} image elements do not expose an alt attribute in the fetched markup.",
      recommendation: "Add meaningful alternative text to informative images and use empty alt text for purely decorative imagery.",
      screenrootTasks: [
        "Audit image purpose and classify informative versus decorative imagery.",
        "Add concise alt text that communicates the image's relevant meaning.",
        "Validate with keyboard and screen-reader testing.",
      ],
      uxPerspective: {
        law: "WCAG 1.1.1 — Non-text Content",
        definition: "WCAG requires meaningful non-text content to have a text alternative that serves an equivalent purpose, with exceptions for decorative content.",
        assessment: "Potential accessibility failure: missing alt attributes can prevent users of assistive technology from understanding informative images.",
      },
      evidence: [{ label: "Images", detail: `${imagesWithoutAlt} image(s) without an alt attribute`, marker: 4, x: 8, y: 76, width: 84, height: 15 }],
    });
  }

  if (forms > 0 && inputs > 4) {
    findings.push({
      id: "form-complexity",
      severity: "medium",
      category: "Forms and task flow",
      title: "The form may create unnecessary interaction effort",
      description: `The page contains ${forms} form(s) and approximately ${inputs} input controls. Long forms can increase completion effort when every field is presented at once.",
      recommendation: "Remove non-essential fields, group related questions, use sensible defaults, and expose inline validation and clear completion feedback.",
      screenrootTasks: [
        "Audit every field against a clear business or user need.",
        "Group fields by task and consider progressive disclosure.",
        "Design validation, error, loading, and success states with engineering.",
      ],
      uxPerspective: {
        law: "Tesler's Law",
        definition: "Every system has an irreducible amount of complexity; the goal is to manage where that complexity lives rather than simply adding more steps for users.",
        assessment: "Potential violation: exposing avoidable complexity in a form shifts system complexity onto the user.",
      },
      evidence: [{ label: "Form controls", detail: `${inputs} input controls detected`, marker: 5, x: 8, y: 50, width: 84, height: 22 }],
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "baseline-review",
      severity: "low",
      category: "Overall UX",
      title: "No major markup-level heuristic signal detected",
      description: "The first-pass crawler did not find enough evidence to flag a major issue from the available HTML. Visual and task testing can reveal issues that markup alone cannot.",
      recommendation: "Use the screenshot evidence and conduct task-based usability testing to validate the experience.",
      screenrootTasks: [
        "Review the rendered experience across desktop and mobile breakpoints.",
        "Run representative user tasks and record friction points.",
        "Prioritise findings using user impact and implementation effort.",
      ],
      uxPerspective: {
        law: "Jakob's Law",
        definition: "Users tend to expect interfaces to work in ways similar to interfaces they already know.",
        assessment: "No clear violation was detected from markup alone; visual comparison and user testing are still required.",
      },
      evidence: [{ label: "Page overview", detail: "First-pass markup review", marker: 1, x: 5, y: 5, width: 90, height: 88 }],
    });
  }

  const score = Math.max(35, Math.min(98, 100 - findings.reduce((sum, finding) => sum + (finding.severity === "high" ? 16 : finding.severity === "medium" ? 9 : 3), 0)));
  const summary = fetchError
    ? `The website could not be fully fetched (${fetchError}). The report is showing a limited fallback review.`
    : `First-pass analysis of ${pageTitle} found ${findings.length} UX signal${findings.length === 1 ? "" : "s"} across navigation, interaction, content, accessibility, and task flow.`;

  return {
    url,
    score,
    summary,
    pageTitle,
    screenshotUrl: makeScreenshotUrl(url),
    findings,
  };
}
