"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AuditPage, AuditResult } from "@/lib/audit";

export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const page = result?.pages[selected] as AuditPage | undefined;

  async function runAudit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setSelected(0);
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Audit failed.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const evidence = useMemo(
    () =>
      page?.findings.flatMap((finding) =>
        finding.evidence.map((item) => ({ ...item, findingId: finding.id })),
      ) ?? [],
    [page],
  );
  const high = page?.findings.filter((f) => f.severity === "high").length ?? 0;
  const medium = page?.findings.filter((f) => f.severity === "medium").length ?? 0;
  const screenshotUrl = page
    ? `/api/screenshot?url=${encodeURIComponent(page.url)}`
    : "";

  return (
    <main className="shell">
      <nav className="nav">
        <div className="brandLockup">
          <div className="brand">UX Audit</div>
          <div className="brandByline">by ScreenRoot</div>
        </div>
        <div className="navMeta">AI-assisted UX review</div>
      </nav>

      <section className="hero">
        <div className="eyebrow">Website experience intelligence</div>
        <h1>Find the friction before your users do.</h1>
        <p className="lede">
          Enter a website and get evidence-backed UX findings, relevant UX laws,
          definitions, and implementation tasks — page by page.
        </p>
        <form className="auditForm" onSubmit={runAudit}>
          <input
            className="urlInput"
            type="text"
            inputMode="url"
            placeholder="https://yourwebsite.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-label="Website URL"
          />
          <button className="auditButton" type="submit" disabled={loading}>
            {loading ? "Analysing…" : "Run audit"}
          </button>
        </form>
        {error && <div className="error">{error}</div>}
      </section>

      {result && page && (
        <section className="results" aria-live="polite">
          <div className="reportHeader">
            <div>
              <div className="muted">AUDIT REPORT</div>
              <h2>{result.pageTitle}</h2>
              <a href={result.url} target="_blank" rel="noreferrer">
                {result.url}
              </a>
            </div>
            <div className="reportScore">
              <span>Site UX score</span>
              <strong>{result.score}</strong>
              <small>/100</small>
            </div>
          </div>
          <p className="reportSummary">{result.summary}</p>

          <div className="pageTabs" role="tablist" aria-label="Audited pages">
            {result.pages.map((item, index) => (
              <button
                key={item.url}
                className={`pageTab ${selected === index ? "active" : ""}`}
                role="tab"
                aria-selected={selected === index}
                onClick={() => setSelected(index)}
              >
                <span>{item.path === "/" ? "Home" : item.pageTitle || item.path}</span>
                <small>{item.score}/100</small>
              </button>
            ))}
          </div>

          <div className="pageHeader">
            <div>
              <div className="muted">
                PAGE {selected + 1} OF {result.pages.length}
              </div>
              <h2>{page.pageTitle}</h2>
              <a href={page.url} target="_blank" rel="noreferrer">
                {page.path}
              </a>
            </div>
            <div className="pageScore">
              <span>Page UX score</span>
              <strong>{page.score}</strong>
              <small>/100</small>
            </div>
          </div>
          <p className="reportSummary">{page.summary}</p>

          <div className="screenshotCard card">
            <div className="sectionHeader">
              <div>
                <div className="muted">VISUAL EVIDENCE</div>
                <h3>High-resolution full-page screenshot & issue markers</h3>
              </div>
              <span className="pill">
                {evidence.length} evidence marker{evidence.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="visualEvidence">
              <div className="screenshotStage">
                <div className="screenshotCanvas">
                  <img
                    src={screenshotUrl}
                    alt={`Full-page screenshot of ${page.url}`}
                    loading="lazy"
                  />
                  {evidence.map((item, index) => (
                    <div
                      key={`${item.findingId}-${item.marker}-${index}`}
                      className="annotation"
                      style={{
                        left: `${item.x}%`,
                        top: `${item.y}%`,
                        width: `${item.width}%`,
                        height: `${item.height}%`,
                      }}
                    >
                      <span>{index + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="evidenceCallouts">
                {evidence.map((item, index) => (
                  <div className="evidenceCallout" key={`${item.findingId}-callout-${index}`}>
                    <span className="marker">{index + 1}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <svg
                className="annotationLines"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {evidence.map((item, index) => (
                  <line
                    key={`${item.findingId}-line-${index}`}
                    x1={(item.x + item.width) * 0.68}
                    y1={item.y + item.height / 2}
                    x2="99"
                    y2={10 + index * (80 / Math.max(evidence.length, 1))}
                  />
                ))}
              </svg>
            </div>
            <div className="evidenceLegend">
              The visual evidence is a high-resolution full-page browser-rendered snapshot.
              Markers connect approximate page regions to the matching finding; coordinates are
              inferred from the document structure and should be treated as directional, not
              pixel-perfect.
            </div>
          </div>

          <div className="summary">
            <div className="card scoreCard">
              <div className="muted">PAGE SUMMARY</div>
              <div className="metric">{page.score}/100</div>
              <p>{page.summary}</p>
            </div>
            <div className="card">
              <div className="muted">High priority</div>
              <div className="metric">{high}</div>
            </div>
            <div className="card">
              <div className="muted">Medium priority</div>
              <div className="metric">{medium}</div>
            </div>
            <div className="card">
              <div className="muted">Findings</div>
              <div className="metric">{page.findings.length}</div>
            </div>
          </div>

          <div className="findings">
            {page.findings.map((finding) => (
              <article className="card finding" key={finding.id}>
                <div className={`severity ${finding.severity}`}>{finding.severity}</div>
                <div className="findingBody">
                  <div className="findingTop">
                    <div>
                      <div className="category">Category: {finding.category}</div>
                      <h3>{finding.title}</h3>
                    </div>
                    <div className="pill">{finding.uxPerspective.law}</div>
                  </div>
                  <p>{finding.description}</p>
                  <div className="detailGrid">
                    <section className="detailBlock">
                      <h4>ScreenRoot / UX tasks</h4>
                      <ul>
                        {finding.screenrootTasks.map((task) => (
                          <li key={task}>{task}</li>
                        ))}
                      </ul>
                    </section>
                    <section className="detailBlock">
                      <h4>Development tasks</h4>
                      <ul>
                        {finding.devTasks.map((task) => (
                          <li key={task}>{task}</li>
                        ))}
                      </ul>
                    </section>
                    <section className="detailBlock lawBlock">
                      <h4>UX law / principle</h4>
                      <div className="lawName">{finding.uxPerspective.law}</div>
                      <p>
                        <strong>Definition:</strong> {finding.uxPerspective.definition}
                      </p>
                      <p>
                        <strong>Assessment:</strong> {finding.uxPerspective.assessment}
                      </p>
                    </section>
                  </div>
                  <p className="recommendation">
                    <strong>Recommended change:</strong> {finding.recommendation}
                  </p>
                  <div className="findingEvidence">
                    <h4>Evidence</h4>
                    {finding.evidence.map((item, index) => (
                      <div className="evidenceItem" key={`${item.marker}-${index}`}>
                        <span className="marker">{item.marker}</span>
                        <div>
                          <strong>{item.label}</strong>
                          <p>{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
