export type Severity = "high" | "medium" | "low";

export type Finding = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  recommendation: string;
};

export type AuditResult = {
  url: string;
  score: number;
  summary: string;
  findings: Finding[];
};

export function createAudit(url: string): AuditResult {
  const findings: Finding[] = [
    {
      id: "clear-primary-action",
      severity: "high",
      category: "Conversion",
      title: "Primary action is not immediately obvious",
      description: "Users should be able to identify the most important next step without scanning the page.",
      recommendation: "Strengthen the visual hierarchy around one primary CTA and remove competing actions above the fold.",
    },
    {
      id: "navigation-labels",
      severity: "medium",
      category: "Navigation",
      title: "Navigation labels may create unnecessary cognitive load",
      description: "Broad or ambiguous labels can force users to interpret where a destination will take them.",
      recommendation: "Use familiar, task-oriented labels and group related destinations into predictable categories.",
    },
    {
      id: "content-scannability",
      severity: "medium",
      category: "Content",
      title: "Content could be easier to scan",
      description: "Dense blocks of information increase the effort required to find the key message.",
      recommendation: "Break long sections into short chunks with descriptive headings, bullets, and progressive disclosure.",
    },
    {
      id: "feedback-states",
      severity: "low",
      category: "Interaction",
      title: "System feedback states should be explicit",
      description: "Loading, success, and error feedback should clearly communicate what happened and what users can do next.",
      recommendation: "Define consistent loading, empty, success, and error states for important interactions.",
    },
  ];

  return {
    url,
    score: 74,
    summary: "A solid foundation with clear opportunities to improve hierarchy, navigation clarity, and interaction feedback.",
    findings,
  };
}
