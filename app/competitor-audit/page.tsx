"use client";

import { useMemo, useState } from "react";
import { PageHeading } from "../ui";

type Page = { url: string; title: string; category: string; depth: number; source: string };
type Site = {
  id: string;
  url: string;
  title: string;
  pages: Page[];
  selected: string[];
  search: string;
  discovered: boolean;
  discovering: boolean;
  error: string;
};
type AuditMode = "desktop" | "mobile";
type Finding = {
  id?: string;
  severity?: string;
  category?: string;
  title?: string;
  description?: string;
  recommendation?: string;
};
type AuditTarget = {
  key: string;
  siteId: string;
  siteTitle: string;
  page: Page;
};
type Report = {
  key: string;
  siteId: string;
  siteTitle: string;
  pageTitle: string;
  url: string;
  auditId?: string;
  status: "complete" | "review" | "failed";
  findings: Finding[];
  error?: string;
  screenshot?: string;
  auditMode: AuditMode;
};

const initialSites: Site[] = [
  { id: "site-1", url: "", title: "", pages: [], selected: [], search: "", discovered: false, discovering: false, error: "" },
  { id: "site-2", url: "", title: "", pages: [], selected: [], search: "", discovered: false, discovering: false, error: "" },
];

function normalizeRoot(raw: string) {
  const input = raw.trim();
  if (!input) throw new Error("Enter a competitor website URL.");
  const parsed = new URL(/^https?:\/\//i.test(input) ? input : "https://" + input);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Enter a valid public HTTP or HTTPS website.");
  if (parsed.username || parsed.password) throw new Error("Website URLs must not contain credentials.");
  return parsed.origin;
}

function pagePath(raw: string) {
  try {
    const u = new URL(raw);
    return u.pathname === "/" ? "Homepage" : u.pathname;
  } catch {
    return raw;
  }
}

function statusLabel(status: Report["status"]) {
  if (status === "failed") return "Audit failed";
  if (status === "review") return "Review required";
  return "Audit complete";
}

export default function CompetitorPageAudit() {
  const [sites, setSites] = useState<Site[]>(initialSites);
  const [auditMode, setAuditMode] = useState<AuditMode>("desktop");
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [pageStatuses, setPageStatuses] = useState<Record<string, string>>({});
  const [resultTargets, setResultTargets] = useState<AuditTarget[]>([]);
  const [activeResultKey, setActiveResultKey] = useState("");
  const [nextSiteNumber, setNextSiteNumber] = useState(3);

  const selectedTargets = useMemo(
    () => sites.flatMap((site) =>
      site.pages
        .filter((page) => site.selected.includes(page.url))
        .map((page) => ({
          key: site.id + "|" + page.url,
          siteId: site.id,
          siteTitle: site.title || (() => { try { return new URL(site.url).hostname; } catch { return "Competitor website"; } })(),
          page,
        })),
    ),
    [sites],
  );

  const activeResultTarget = resultTargets.find((target) => target.key === activeResultKey) || resultTargets[0];
  const activeReport = activeResultTarget ? reports.find((report) => report.key === activeResultTarget.key) : undefined;
  const activeResultStatus = activeResultTarget ? pageStatuses[activeResultTarget.key] : undefined;

  function updateSite(id: string, updater: (site: Site) => Site) {
    setSites((previous) => previous.map((site) => site.id === id ? updater(site) : site));
  }

  function changeSiteUrl(id: string, url: string) {
    updateSite(id, (site) => ({
      ...site,
      url,
      title: "",
      pages: [],
      selected: [],
      search: "",
      discovered: false,
      discovering: false,
      error: "",
    }));
    setReports((previous) => previous.filter((report) => report.siteId !== id));
    setPageStatuses((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(id + "|"))));
  }

  async function discoverSite(id: string) {
    const site = sites.find((item) => item.id === id);
    if (!site || site.discovering || running) return;
    let root = "";
    try {
      root = normalizeRoot(site.url);
    } catch (error) {
      updateSite(id, (current) => ({ ...current, error: error instanceof Error ? error.message : "Enter a valid URL." }));
      return;
    }

    updateSite(id, (current) => ({ ...current, discovering: true, error: "", pages: [], selected: [], discovered: false }));
    setReports((previous) => previous.filter((report) => report.siteId !== id));
    setPageStatuses((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(id + "|"))));

    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: root }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not discover this website's linked pages.");
      const pages: Page[] = Array.isArray(data.pages) ? data.pages : [];
      updateSite(id, (current) => ({
        ...current,
        url: data.root || root,
        title: data.title || new URL(root).hostname,
        pages,
        selected: [],
        search: "",
        discovered: true,
        discovering: false,
        error: pages.length ? "" : "No public linked pages were found. Try another public site root or check whether this website exposes navigation links or a sitemap.",
      }));
    } catch (error) {
      updateSite(id, (current) => ({
        ...current,
        discovering: false,
        discovered: false,
        error: error instanceof Error ? error.message : "Page discovery failed.",
      }));
    }
  }

  function togglePage(siteId: string, url: string) {
    updateSite(siteId, (site) => ({
      ...site,
      selected: site.selected.includes(url)
        ? site.selected.filter((item) => item !== url)
        : [...site.selected, url],
    }));
  }

  function selectVisiblePages(siteId: string, visible: Page[]) {
    updateSite(siteId, (site) => {
      const allVisibleSelected = visible.length > 0 && visible.every((page) => site.selected.includes(page.url));
      const visibleUrls = new Set(visible.map((page) => page.url));
      return {
        ...site,
        selected: allVisibleSelected
          ? site.selected.filter((url) => !visibleUrls.has(url))
          : [...new Set([...site.selected, ...visible.map((page) => page.url)])],
      };
    });
  }

  function addSite() {
    if (sites.length >= 5) return;
    const id = "site-" + Date.now() + "-" + nextSiteNumber;
    setNextSiteNumber((value) => value + 1);
    setSites((previous) => [...previous, {
      id,
      url: "",
      title: "",
      pages: [],
      selected: [],
      search: "",
      discovered: false,
      discovering: false,
      error: "",
    }]);
  }

  function removeSite(id: string) {
    if (sites.length <= 1 || running) return;
    setSites((previous) => previous.filter((site) => site.id !== id));
    setReports((previous) => previous.filter((report) => report.siteId !== id));
    setPageStatuses((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(id + "|"))));
  }

  async function runSelectedAudits() {
    if (running || selectedTargets.length === 0) return;
    setRunning(true);
    setRunStatus("");
    const targets = [...selectedTargets];
    setResultTargets(targets);
    setActiveResultKey(targets[0].key);
    setReports((previous) => previous.filter((report) => !targets.some((target) => target.key === report.key)));
    setPageStatuses((previous) => {
      const next = { ...previous };
      targets.forEach((target) => { next[target.key] = "queued"; });
      return next;
    });
    let completed = 0;
    let review = 0;
    let failed = 0;

    try {
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        const url = target.page.url;
        setRunStatus("Auditing page " + (index + 1) + " of " + targets.length + ": " + target.page.title);
        setPageStatuses((previous) => ({ ...previous, [target.key]: "auditing" }));

        try {
          const response = await fetch("/api/audit-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              projectName: target.siteTitle,
              auditMode,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.page) throw new Error(data.error || "Audit request failed.");

          const findings: Finding[] = Array.isArray(data.page.findings) ? data.page.findings : [];
          const status: Report["status"] = findings.length > 0 ? "complete" : "review";
          if (status === "complete") completed++;
          else review++;

          const report: Report = {
            key: target.key,
            siteId: target.siteId,
            siteTitle: target.siteTitle,
            pageTitle: target.page.title || data.page.title || pagePath(url),
            url: data.page.url || url,
            auditId: data.auditId,
            status,
            findings,
            screenshot: typeof data.page.screenshot === "string" ? data.page.screenshot : undefined,
            auditMode,
          };
          setReports((previous) => [report, ...previous.filter((item) => item.key !== report.key)]);
          setPageStatuses((previous) => ({ ...previous, [target.key]: status }));
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : "Audit failed.";
          const report: Report = {
            key: target.key,
            siteId: target.siteId,
            siteTitle: target.siteTitle,
            pageTitle: target.page.title,
            url,
            status: "failed",
            findings: [],
            error: message,
            auditMode,
          };
          setReports((previous) => [report, ...previous.filter((item) => item.key !== report.key)]);
          setPageStatuses((previous) => ({ ...previous, [target.key]: "failed" }));
        }
      }
      setRunStatus("Finished auditing " + targets.length + " selected page(s): " + completed + " with findings, " + review + " requiring review, " + failed + " failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="ca-shell">
      <div className="ca-wrap">
        <nav className="ca-nav">
          <a className="ca-brand" href="/">UX AUDIT <span>/ COMPETITOR PAGES</span></a>
          <div className="ca-nav-links">
            <a href="/site-map">IA &amp; Audit workspace</a>
            <a href="/benchmark">Benchmarking ↗</a>
          </div>
        </nav>

        <header className="ca-hero">
          <PageHeading
            eyebrow="AUDIT WORKSPACE · COMPETITOR WEBSITES"
            title="Audit the pages that matter."
            description="Discover public pages across competitor websites, select the exact pages you want to inspect, and generate a separate evidence-led audit report for each URL. No comparative scoring or benchmark synthesis is performed here."
            className="ca-shared-heading"
          />
          <div className="ca-viewport">
            <span>Audit viewport</span>
            <button type="button" className={auditMode === "desktop" ? "active" : ""} onClick={() => setAuditMode("desktop")} disabled={running}>Desktop · 1440 px</button>
            <button type="button" className={auditMode === "mobile" ? "active" : ""} onClick={() => setAuditMode("mobile")} disabled={running}>Mobile · 393 × 852</button>
          </div>
        </header>

        <section className="ca-instructions">
          <strong>Workflow</strong>
          <p>Add competitor websites, discover their linked pages, tick pages such as About Us or Pricing, then run the audits. You can choose multiple pages from each website.</p>
        </section>

        <section className="ca-site-grid">
          {sites.map((site, index) => {
            const filteredPages = site.pages.filter((page) => {
              const search = site.search.trim().toLowerCase();
              return !search || (page.title + " " + page.category + " " + page.url).toLowerCase().includes(search);
            });
            const allVisibleSelected = filteredPages.length > 0 && filteredPages.every((page) => site.selected.includes(page.url));
            const picked = site.selected.length;
            return (
              <article className="ca-site-card" key={site.id}>
                <div className="ca-site-heading">
                  <div>
                    <span className="ca-overline">WEBSITE {index + 1}</span>
                    <h2>{site.title || ("Competitor " + (index + 1))}</h2>
                    <p>{site.discovered ? site.pages.length + " linked page(s) discovered" : "Enter a public website to discover its pages."}</p>
                  </div>
                  {sites.length > 1 && <button className="ca-remove" type="button" onClick={() => removeSite(site.id)} disabled={running}>Remove</button>}
                </div>

                <div className="ca-url-row">
                  <input
                    type="text"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://competitor.com"
                    value={site.url}
                    onChange={(event) => changeSiteUrl(site.id, event.target.value)}
                    disabled={running || site.discovering}
                    aria-label={"Website URL for competitor " + (index + 1)}
                  />
                  <button type="button" onClick={() => void discoverSite(site.id)} disabled={running || site.discovering || !site.url.trim()}>
                    {site.discovering ? "Discovering…" : site.discovered ? "Refresh pages" : "Discover pages"}
                  </button>
                </div>

                {site.error && <p className="ca-error" role="alert">{site.error}</p>}

                {site.discovered && site.pages.length > 0 && (
                  <div className="ca-page-picker">
                    <div className="ca-picker-heading">
                      <div>
                        <strong>Select pages to audit</strong>
                        <small>{picked} selected · {site.pages.length} available</small>
                      </div>
                      <button type="button" onClick={() => selectVisiblePages(site.id, filteredPages)} disabled={running}>
                        {allVisibleSelected ? "Clear visible" : "Select visible"}
                      </button>
                    </div>
                    <input
                      className="ca-search"
                      type="search"
                      placeholder="Filter by page name, category, or URL"
                      value={site.search}
                      onChange={(event) => updateSite(site.id, (current) => ({ ...current, search: event.target.value }))}
                      aria-label="Filter discovered pages"
                    />
                    <div className="ca-page-list">
                      {filteredPages.map((page) => {
                        const key = site.id + "|" + page.url;
                        const state = pageStatuses[key];
                        return (
                          <label className={"ca-page-option" + (site.selected.includes(page.url) ? " selected" : "")} key={page.url}>
                            <input
                              type="checkbox"
                              checked={site.selected.includes(page.url)}
                              onChange={() => togglePage(site.id, page.url)}
                              disabled={running}
                            />
                            <span className="ca-page-copy">
                              <strong>{page.title || pagePath(page.url)}</strong>
                              <small>{page.category} · {pagePath(page.url)}</small>
                            </span>
                            {state && <span className={"ca-page-status " + state}>{state === "auditing" ? "Running…" : state === "complete" ? "Done" : state === "review" ? "Review" : "Failed"}</span>}
                          </label>
                        );
                      })}
                      {filteredPages.length === 0 && <p className="ca-empty-filter">No pages match this filter.</p>}
                    </div>
                    <p className="ca-picker-note">Only checked pages are audited. Pages behind a login or blocked by site security may not be available.</p>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <section className="ca-run-panel">
          <div className="ca-run-count">
            <span className="ca-overline">AUDIT QUEUE</span>
            <strong>{selectedTargets.length} page(s) selected</strong>
            <p>Each page is audited independently using the selected viewport. Zero findings are marked for review, not treated as proof that a page is issue-free.</p>
          </div>
          <div className="ca-run-actions">
            <button className="ca-add-site" type="button" onClick={addSite} disabled={running || sites.length >= 5}>+ Add website</button>
            <button className="ca-run-button" type="button" onClick={() => void runSelectedAudits()} disabled={running || selectedTargets.length === 0}>
              {running ? "Auditing selected pages…" : "Run selected page audits"}
              {!running && <span>→</span>}
            </button>
          </div>
          {runStatus && <div className="ca-run-status" role="status">{runStatus}</div>}
        </section>

        {resultTargets.length > 0 && (
          <section className="ca-results">
            <div className="ca-results-heading">
              <div>
                <span className="ca-overline">AUDIT RESULTS</span>
                <h2>Page-by-page findings</h2>
                <p>Choose a page tab to inspect its findings and screenshot evidence. Reports remain separate; this is not a competitor ranking.</p>
              </div>
              <button type="button" className="ca-clear-results" onClick={() => { if (!running) { setReports([]); setPageStatuses({}); setResultTargets([]); setActiveResultKey(""); } }} disabled={running}>Clear reports</button>
            </div>

            <div className="ca-result-tabs" role="tablist" aria-label="Audited pages">
              {resultTargets.map((target) => {
                const report = reports.find((item) => item.key === target.key);
                const state = pageStatuses[target.key] || "queued";
                const active = target.key === (activeResultTarget?.key || activeResultKey);
                const label = report?.pageTitle || target.page.title || pagePath(target.page.url);
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="ca-active-result-panel"
                    id={"ca-tab-" + resultTargets.indexOf(target)}
                    className={"ca-result-tab" + (active ? " active" : "")}
                    key={target.key}
                    onClick={() => setActiveResultKey(target.key)}
                  >
                    <span className="ca-tab-page-title">{label}</span>
                    <span className="ca-tab-site-title">{target.siteTitle}</span>
                    <span className={"ca-tab-state " + state}>
                      {state === "auditing" ? "Running" : state === "queued" ? "Queued" : state === "complete" ? (report?.findings.length || 0) + " findings" : state === "review" ? "Review" : "Failed"}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeResultTarget && (
              <article className="ca-active-report" role="tabpanel" id="ca-active-result-panel" aria-labelledby={"ca-tab-" + resultTargets.findIndex((target) => target.key === activeResultTarget.key)}>
                {!activeReport ? (
                  <div className="ca-report-pending">
                    <span className={"ca-quality " + (activeResultStatus === "failed" ? "failed" : "review")}>
                      {activeResultStatus === "auditing" ? "Audit in progress" : activeResultStatus === "failed" ? "Audit failed" : "Waiting in queue"}
                    </span>
                    <h3>{activeResultTarget.page.title || pagePath(activeResultTarget.page.url)}</h3>
                    <p>{activeResultStatus === "auditing" ? "The page is being captured and analysed. Its findings will appear here when the audit completes." : activeResultStatus === "failed" ? "The audit failed; see the tab status and retry the selected pages." : "This page has not been processed yet. Its own findings will appear here once its audit finishes."}</p>
                    <a className="ca-report-url" href={activeResultTarget.page.url} target="_blank" rel="noreferrer">{activeResultTarget.page.url} ↗</a>
                  </div>
                ) : (
                  <>
                    <div className="ca-report-topline">
                      <span className={"ca-quality " + activeReport.status}>{statusLabel(activeReport.status)}</span>
                      {activeReport.auditId && <span className="ca-audit-id">Saved audit</span>}
                    </div>
                    <h3 className="ca-active-page-title">{activeReport.pageTitle}</h3>
                    <p className="ca-report-site">{activeReport.siteTitle}</p>
                    <a className="ca-report-url" href={activeReport.url} target="_blank" rel="noreferrer">{activeReport.url} ↗</a>
                    {activeReport.status === "failed" ? (
                      <div className="ca-report-error">{activeReport.error || "The audit could not be completed."}</div>
                    ) : (
                      <>
                        <div className="ca-report-stats"><strong>{activeReport.findings.length}</strong><span>finding(s)</span><span>·</span><span>{activeReport.auditMode === "mobile" ? "Mobile" : "Desktop"} audit</span></div>
                        {activeReport.status === "review" && <p className="ca-review-note">No findings were returned. Review the captured page and audit evidence before treating this as a clean result.</p>}
                        {activeReport.findings.length === 0 && activeReport.status !== "review" && <p className="ca-no-findings">No findings were returned for this page.</p>}
                        {activeReport.findings.map((finding, index) => (
                          <div className="ca-finding" key={finding.id || activeReport.key + "-" + index}>
                            <div className="ca-finding-labels">
                              <span className={"ca-severity " + String(finding.severity || "medium").toLowerCase()}>{finding.severity || "Unspecified"}</span>
                              <span>{finding.category || "UX observation"}</span>
                            </div>
                            <strong>{finding.title || "UX finding " + (index + 1)}</strong>
                            {finding.description && <p>{finding.description}</p>}
                            {finding.recommendation && <p className="ca-recommendation"><b>Recommendation:</b> {finding.recommendation}</p>}
                          </div>
                        ))}
                        {activeReport.screenshot && activeReport.screenshot.startsWith("data:image/") && (
                          <details className="ca-evidence">
                            <summary>View captured screenshot evidence</summary>
                            <img src={activeReport.screenshot} alt={"Captured screenshot for " + activeReport.pageTitle} />
                          </details>
                        )}
                      </>
                    )}
                  </>
                )}
              </article>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
