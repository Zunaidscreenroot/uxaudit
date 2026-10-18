"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "./ui";

type Connection = { connected?: boolean; provider?: string; label?: string; error?: string };

const groups = [
  {
    label: "WORKSPACE",
    links: [
      { href: "/", label: "Overview", icon: "◫" },
      { href: "/site-map", label: "IA & Audit", icon: "⌘" },
      { href: "/benchmark", label: "Benchmark", icon: "⇄" },
      { href: "/knowledge-base", label: "Past Findings", icon: "▤" },
    ],
  },
  {
    label: "LEARNING & SYSTEM",
    links: [
      { href: "/coach", label: "Coach & Learn", icon: "✳" },
      { href: "/model-health", label: "Model & Costs", icon: "◉" },
      { href: "/model-verification", label: "Model verification", icon: "✓" },
    ],
  },
];

const titles: Record<string, string> = {
  "/": "Overview",
  "/site-map": "Information architecture & audit",
  "/benchmark": "Competitor benchmark",
  "/knowledge-base": "Past Findings",
  "/coach": "Coach & Learn",
  "/ia-remediation": "IA remediation proposal",
  "/model-health": "Model health & cost",
  "/model-verification": "Model verification",
};

export default function ProductShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const [connection, setConnection] = useState<Connection | null>(null);
  const [checking, setChecking] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const title = useMemo(() => titles[pathname] || "UX Audit workspace", [pathname]);

  const refreshConnection = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/openrouter-status", { cache: "no-store" });
      const payload = await response.json();
      setConnection(response.ok ? payload : { connected: false, provider: "OpenRouter", error: payload?.error || "Status endpoint unavailable" });
    } catch (error) {
      setConnection({ connected: false, provider: "OpenRouter", error: error instanceof Error ? error.message : "Connection check failed" });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void refreshConnection(); }, [refreshConnection]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  return (
    <div className="uxd-shell">
      <aside className="uxd-sidebar" aria-label="Product navigation">
        <a href="/" className="uxd-brand" aria-label="UX Audit home" onClick={() => setMobileNavOpen(false)}>
          <span className="uxd-brand-mark">u</span>
          <span className="uxd-brand-copy">ux<span>audit</span><small>UX INTELLIGENCE</small></span>
        </a>

        <div className="uxd-workspace-switcher">
          <span className="uxd-workspace-avatar">SR</span>
          <span className="uxd-workspace-copy"><strong>ScreenRoot workspace</strong><small>Indian BFSI · Product UX</small></span>
          <span className="uxd-workspace-chevron">⌄</span>
        </div>

        {groups.map((group) => (
          <div className="uxd-nav-group" key={group.label}>
            <div className="uxd-nav-label">{group.label}</div>
            {group.links.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <a href={link.href} key={link.href} className={"uxd-nav-link" + (active ? " is-active" : "")} aria-current={active ? "page" : undefined}>
                  <span className="uxd-nav-icon" aria-hidden="true">{link.icon}</span>
                  <span>{link.label}</span>
                  {active && <span className="uxd-nav-active-dot" aria-hidden="true" />}
                </a>
              );
            })}
          </div>
        ))}

        <div className="uxd-sidebar-spacer" />
        <div className="uxd-sidebar-note">
          <span className="uxd-note-icon">✦</span>
          <div><strong>Evidence before opinions</strong><small>Senior-review quality, every run.</small></div>
        </div>
        <div className="uxd-sidebar-user"><span className="uxd-user-mark">Z</span><span><strong>UX workspace</strong><small>Product owner</small></span><span className="uxd-user-more">•••</span></div>
      </aside>

      <div className="uxd-main">
        <header className="uxd-topbar">
          <div className="uxd-breadcrumb"><span>Workspace</span><i>/</i><strong>{title}</strong></div>
          <div className="uxd-topbar-actions">
            <button type="button" className="uxd-status-button" onClick={() => void refreshConnection()} title={connection?.error || "Click to refresh OpenRouter status"} aria-label="Refresh OpenRouter connection status">
              <Badge tone={connection?.connected ? "success" : connection ? "danger" : "neutral"} className="uxd-status-chip">
                <span className="uxd-status-dot" />
                <span>{checking ? "Checking provider…" : connection?.connected ? "OpenRouter connected" : connection ? "Provider unavailable" : "Connecting provider"}</span>
                <span className={"uxd-refresh-icon" + (checking ? " is-spinning" : "")}>↻</span>
              </Badge>
            </button>
            <span className="uxd-topbar-divider" />
            <span className="uxd-topbar-avatar" aria-label="Current workspace user">Z</span>
          </div>
        </header>
        <div className="uxd-page-content" data-route={pathname}>{children}</div>
        <footer className="uxd-footer">
          <span>UX AUDIT <i>·</i> Evidence first, recommendations second.</span>
          <span>Shared product design system <i>·</i> Dark workspace</span>
        </footer>
      </div>
    </div>
  );
}
