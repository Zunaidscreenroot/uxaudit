"use client";

import { useEffect, useState } from "react";
import { PageHeading } from "../ui";

type Lesson = {
  id: string;
  title: string;
  rule: string;
  rationale?: string;
  scope: string;
  keywords?: string[];
  status: "approved";
  created_at: string;
  approved_at?: string | null;
  usage_count?: number;
  last_used_at?: string | null;
  feedback_kind?: string;
  source_audit_id?: string | null;
  source_finding_title?: string | null;
};
const COACHING_PROMPT = "I’m coaching UX Audit. Convert my Hindi/Hinglish feedback into one concise, reusable UX rule. Preserve my original feedback, classify the correction (false positive, missed issue, severity, duplicate, recommendation, evidence, benchmarking, or other), write the rule in clear English, explain why it matters, set its scope and keywords, and keep any useful before/after example. If this refers to a specific saved audit, include the auditId and finding title. Save as a draft. Activate it only after I explicitly approve it for future audits.";

function dateLabel(value?: string | null) {
  if (!value) return "Not used yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}

export default function CoachPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coach-learning?limit=100", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load the coaching library.");
        if (!cancelled) setLessons(Array.isArray(data.lessons) ? data.lessons : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the coaching library.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(COACHING_PROMPT);
      setCopied(true);
    } catch {
      setError("Clipboard access was blocked. You can copy the coaching instruction from the code-free text below.");
    }
  }

  return (
    <main className="or-app">
      <aside className="or-sidebar">
        <a className="or-brand" href="/"><span className="or-brand-mark">u</span><span>ux<span>audit</span></span></a>
        <div className="or-workspace"><span className="or-avatar">SR</span><span><strong>ScreenRoot workspace</strong><small>UX Intelligence</small></span><span className="or-chevron">⌄</span></div>
        <div className="or-side-label">WORKSPACE</div>
        <a className="or-side-link" href="/"><span>⌂</span> Overview</a>
        <a className="or-side-link" href="/site-map"><span>⌘</span> IA &amp; Audit</a>
        <a className="or-side-link" href="/benchmark"><span>⇄</span> Competitor benchmark</a>
        <a className="or-side-link" href="/knowledge-base"><span>▤</span> Knowledge base</a>
        <a className="or-side-link active" href="/coach"><span>✦</span> Coach &amp; Learn</a>
        <div className="or-sidebar-bottom"><div className="or-help-icon">?</div><div><strong>Evidence-led UX</strong><small>Human-coached standards</small></div><span className="or-online-dot"/></div>
      </aside>

      <section className="or-main">
        <header className="or-topbar"><div className="or-breadcrumb"><a href="/" style={{ color: "inherit", textDecoration: "none" }}>Workspace</a><span>/</span><strong>Coach &amp; Learn</strong></div><div className="or-top-actions"><span className="coach-connection"><i/>ChatGPT coaching via MCP</span><span className="or-user-avatar">Z</span></div></header>
        <div className="or-content coach-content">
          <PageHeading eyebrow="CONTINUOUS IMPROVEMENT" title="Coach the auditor. Improve every run." description="Turn your corrections into reusable rules. ChatGPT helps interpret your feedback; UX Audit stores the lesson and applies approved guidance to future audits." actions={<a className="or-text-link" href="/site-map">Open audit workspace <span>↗</span></a>} />

          <section className="coach-principle">
            <div className="coach-principle-mark">✦</div>
            <div><div className="coach-kicker">THE COACHING LOOP</div><h2>One correction should create a reusable lesson, not another long prompt.</h2><p>Your original Hindi/Hinglish feedback is retained for traceability, but audit runs receive only the short, relevant, approved rule—not the whole conversation.</p></div>
          </section>

          <div className="coach-steps">
            <article><span className="coach-step-no">01</span><div className="coach-step-icon">◉</div><h3>Explain naturally</h3><p>Tell ChatGPT in Hindi, Hinglish, or English what the audit got wrong and what it should have done.</p><small>Voice or text</small></article>
            <article><span className="coach-step-no">02</span><div className="coach-step-icon">⌁</div><h3>Distil the lesson</h3><p>ChatGPT turns your feedback into a clear rule, rationale, scope, keywords, and example while preserving the original.</p><small>Structured memory</small></article>
            <article><span className="coach-step-no">03</span><div className="coach-step-icon">✓</div><h3>Approve &amp; apply</h3><p>The lesson stays in draft until approved. Only approved rules can influence the audit prompt and quality checks.</p><small>Human-controlled</small></article>
            <article><span className="coach-step-no">04</span><div className="coach-step-icon">↗</div><h3>Reuse intelligently</h3><p>Each audit retrieves only a few relevant rules, helping consistency while limiting repeated prompt tokens.</p><small>Relevant context only</small></article>
          </div>

          <section className="coach-how">
            <div><div className="coach-kicker">HOW TO COACH FROM CHATGPT VOICE</div><h2>Talk like you would to a teammate.</h2><p>For example: “Is audit mein tumne har CTA ko high priority bola. Primary CTA aur secondary action ko alag judge karna chahiye. Is rule ko future BFSI audits ke liye save karo.” ChatGPT should summarise the rule, preserve your original feedback, and save it to UX Audit through the authenticated MCP connection.</p><div className="coach-prompt-preview">{COACHING_PROMPT}</div><button className="coach-copy-button" onClick={() => void copyPrompt()}>{copied ? "Instruction copied ✓" : "Copy coaching instruction"} <span>↗</span></button><p className="coach-note">A saved rule is not automatically a model-weight update. UX Audit learns operationally by retrieving the approved rule at the right time, then can be evaluated and refined against later findings.</p></div>
            <div className="coach-guardrails"><div className="coach-kicker">QUALITY GUARDRAILS</div><h3>Learning without poisoning future audits</h3><ul><li><strong>Evidence still wins.</strong> A stored rule cannot justify a finding that the current screenshot does not support.</li><li><strong>Scope stays explicit.</strong> A Ujjivan-specific preference should not silently become a global rule for every website.</li><li><strong>Review before activation.</strong> Unclear or one-off feedback remains a draft until approved.</li><li><strong>Cost stays bounded.</strong> Only the top relevant compact rules are sent to the model, not transcripts or the full learning library.</li></ul></div>
          </section>

          <section className="coach-library">
            <div className="coach-library-head"><div><div className="coach-kicker">KNOWLEDGE BASE · APPROVED RULES</div><h2>Rules currently guiding audits</h2><p>These are the active lessons available to audit runs.</p></div><div className="coach-count"><strong>{loading ? "—" : lessons.length}</strong><span>active rules</span></div></div>
            {loading && <div className="coach-empty">Loading approved lessons…</div>}
            {!loading && error && <div className="coach-error"><strong>Could not load learning rules.</strong><span>{error}</span><small>Check Supabase configuration and confirm the Coach &amp; Learn table migration is available in this deployment.</small></div>}
            {!loading && !error && !lessons.length && <div className="coach-empty"><strong>No approved lessons yet.</strong><span>That is expected for a new learning loop. Use ChatGPT voice or text to save your first coaching lesson, review it, and approve it before it affects audits.</span></div>}
            {!loading && !error && lessons.length > 0 && <div className="coach-rule-grid">{lessons.map((lesson) => <article className="coach-rule-card" key={lesson.id}><div className="coach-rule-top"><span className="coach-approved"><i/>Approved</span><span className="coach-rule-scope">{lesson.scope || "all audits"}</span></div><h3>{lesson.title}</h3><p>{lesson.rule}</p>{lesson.rationale && <div className="coach-rationale"><strong>Why it matters</strong><span>{lesson.rationale}</span></div>}{lesson.source_finding_title && <div className="coach-rationale"><strong>Coaching context</strong><span>Correction from: {lesson.source_finding_title} · {(lesson.feedback_kind || "general").replace(/_/g, " ")}</span></div>}{Array.isArray(lesson.keywords) && lesson.keywords.length > 0 && <div className="coach-tags">{lesson.keywords.slice(0, 8).map((keyword) => <span key={keyword}>{keyword}</span>)}</div>}<div className="coach-rule-meta"><span>Approved {dateLabel(lesson.approved_at)}</span><span>{lesson.usage_count || 0} uses</span></div></article>)}</div>}
          </section>
        </div>
        <footer className="or-footer"><span>UX Audit <span>·</span> ChatGPT coaches. UX Audit executes.</span><div><a href="/knowledge-base">Knowledge base</a><a href="/benchmark">Benchmark</a></div></footer>
      </section>
      <style jsx>{`
        .coach-content{padding-bottom:52px}
        .coach-connection{display:inline-flex;align-items:center;gap:8px;border:1px solid #d7e8d7;background:#f2fbf3;color:#24623b;border-radius:999px;padding:7px 11px;font-size:11px;font-weight:800}
        .coach-connection i,.coach-approved i{width:6px;height:6px;border-radius:50%;background:#2b9955;display:inline-block}
        .coach-principle{display:grid;grid-template-columns:44px 1fr;gap:17px;padding:24px;border:1px solid #dce3d9;background:#f2f7ee;border-radius:16px;margin:28px 0 18px}
        .coach-principle-mark{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:#203e2c;color:#dcf7a5;font-size:21px}
        .coach-kicker{font-size:10px;letter-spacing:.13em;font-weight:900;color:#718071}
        .coach-principle h2,.coach-how h2,.coach-library h2{font-size:22px;letter-spacing:-.04em;line-height:1.2;margin:7px 0 8px;color:#1b2820}
        .coach-principle p,.coach-how p,.coach-library-head p{font-size:13px;line-height:1.65;color:#657064;margin:0;max-width:760px}
        .coach-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0 28px}
        .coach-steps article{position:relative;padding:20px;border:1px solid #e2e5df;background:#fff;border-radius:14px;min-height:190px}
        .coach-step-no{position:absolute;right:16px;top:15px;color:#adb6aa;font-size:10px;font-weight:900}
        .coach-step-icon{width:33px;height:33px;border-radius:10px;background:#f0f3ed;display:grid;place-items:center;color:#2d4a33;font-size:17px;margin-bottom:17px}
        .coach-steps h3{font-size:14px;margin:0 0 8px;color:#252c25}
        .coach-steps p{font-size:12px;line-height:1.6;color:#6b746b;margin:0 0 15px}
        .coach-steps small{font-size:10px;font-weight:800;color:#6d8567;text-transform:uppercase;letter-spacing:.06em}
        .coach-how{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:16px;margin:0 0 34px}
        .coach-how>div{padding:22px;border:1px solid #e1e4dd;background:#fff;border-radius:15px}
        .coach-how h2{margin-bottom:9px}
        .coach-prompt-preview{font-size:12px;line-height:1.6;color:#536056;background:#f5f6f2;border:1px solid #e5e9df;border-radius:10px;padding:13px;margin:15px 0 10px}
        .coach-copy-button{border:0;background:#233e2d;color:white;border-radius:9px;padding:10px 13px;font-size:12px;font-weight:800;cursor:pointer}
        .coach-copy-button span{padding-left:10px}
        .coach-note{font-size:11px!important;margin-top:13px!important}
        .coach-guardrails h3{font-size:16px;margin:8px 0 14px}
        .coach-guardrails ul{padding-left:17px;margin:0;display:grid;gap:12px}
        .coach-guardrails li{font-size:12px;line-height:1.6;color:#657064}
        .coach-guardrails li strong{color:#303b30}
        .coach-library{border-top:1px solid #e1e4dd;padding-top:25px}
        .coach-library-head{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:17px}
        .coach-library h2{margin-bottom:5px}
        .coach-count{min-width:94px;text-align:right;display:grid;gap:2px}
        .coach-count strong{font-size:27px;letter-spacing:-.04em;color:#253d2a}
        .coach-count span{font-size:10px;color:#798276;text-transform:uppercase;font-weight:800;letter-spacing:.06em}
        .coach-rule-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .coach-rule-card{padding:19px;border:1px solid #e2e5df;border-radius:13px;background:#fff}
        .coach-rule-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
        .coach-approved{display:flex;align-items:center;gap:6px;color:#2b7241;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}
        .coach-rule-scope{font-size:10px;color:#536b4f;background:#f0f5ed;border-radius:99px;padding:5px 8px}
        .coach-rule-card h3{font-size:15px;line-height:1.35;margin:15px 0 8px}
        .coach-rule-card>p{font-size:12px;line-height:1.65;color:#4f5c50;margin:0}
        .coach-rationale{display:grid;gap:4px;margin-top:13px;padding-top:12px;border-top:1px solid #edf0ea;font-size:11px;line-height:1.55;color:#667066}
        .coach-rationale strong{color:#354635}
        .coach-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:13px}
        .coach-tags span{font-size:10px;padding:4px 7px;border-radius:6px;background:#f1f3ef;color:#6a7468}
        .coach-rule-meta{border-top:1px solid #edf0ea;margin-top:14px;padding-top:11px;display:flex;justify-content:space-between;gap:10px;color:#90988e;font-size:10px}
        .coach-empty,.coach-error{border:1px dashed #d8ded4;border-radius:12px;padding:24px;background:#fff;color:#687268;display:grid;gap:7px;font-size:12px;line-height:1.6}
        .coach-empty strong,.coach-error strong{color:#354435}
        .coach-error{border-color:#e8c5c1;background:#fff8f7;color:#8e4741}
        .coach-error small{color:#96645f}
        @media(max-width:1050px){.coach-steps{grid-template-columns:repeat(2,minmax(0,1fr))}.coach-how{grid-template-columns:1fr}}
        @media(max-width:640px){.coach-steps,.coach-rule-grid{grid-template-columns:1fr}.coach-library-head{align-items:flex-start}.coach-principle{padding:17px}.coach-rule-top{align-items:flex-start;flex-direction:column}.coach-rule-meta{flex-direction:column}}
      `}</style>
    </main>
  );
}
