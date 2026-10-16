"use client";
import { FormEvent, useState } from "react";

type Page = {url:string;title:string;category:string;depth:number;source:string};
type Discovery = {root:string;title:string;pages:Page[];note:string};
type AuditMode = "desktop" | "mobile";
type Viewport = {width:number;height:number};

export default function SiteMapPage() {
  const [url,setUrl]=useState(""); const [data,setData]=useState<Discovery|null>(null);
  const [selected,setSelected]=useState<string[]>([]); const [loading,setLoading]=useState(false);
  const [error,setError]=useState(""); const [showAudit,setShowAudit]=useState(false);
  const [auditMode,setAuditMode]=useState<AuditMode>("desktop"); const [planMessage,setPlanMessage]=useState("");
  const viewport:Viewport = auditMode === "mobile" ? {width:393,height:852} : {width:1440,height:900};
  async function copySelectedUrls() {
    try { await navigator.clipboard.writeText(selected.join("\\n")); setPlanMessage(`Copied ${selected.length} selected page URLs.`); }
    catch { setPlanMessage("Clipboard access failed. Check browser permissions and try again."); }
  }
  async function copyAuditPlan() {
    if (!data || !selected.length) return;
    const plan = {
      schema: "uxaudit-page-audit-plan/v1",
      website: data.root,
      auditMode,
      viewport: { ...viewport, unit: "CSS px" },
      pages: selected.map(pageUrl => {
        const page = data.pages.find(p => p.url === pageUrl);
        return { url: pageUrl, title: page?.title || pageUrl, category: page?.category || "Other Pages" };
      })
    };
    try { await navigator.clipboard.writeText(JSON.stringify(plan, null, 2)); setPlanMessage(`Copied an audit plan for ${selected.length} pages in ${auditMode} mode (${viewport.width} × ${viewport.height}).`); }
    catch { setPlanMessage("Clipboard access failed. Check browser permissions and try again."); }
  }
  async function discover(e:FormEvent) {
    e.preventDefault();setLoading(true);setError("");setData(null);setShowAudit(false);
    try { const r=await fetch("/api/discover",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Discovery failed");setData(d);setSelected(d.pages.slice(0,8).map((p:Page)=>p.url)); }
    catch(e){setError(e instanceof Error?e.message:"Could not discover website pages.");}finally{setLoading(false);}
  }
  const groups=data?.pages.reduce((a:Record<string,Page[]>,p)=>{(a[p.category] ||= []).push(p);return a;},{})||{};
  const issues=data?[
    ...((data.pages.filter(p=>p.depth>=3).length)?[`${data.pages.filter(p=>p.depth>=3).length} URLs are at least three levels deep. Review whether high-value pages can be moved closer to the top level.`]:[]),
    ...((data.pages.filter(p=>p.category==="About Us").length>=4)?[`${data.pages.filter(p=>p.category==="About Us").length} About Us-related URLs were found. Review overlap and possible consolidation.`]:[]),
    ...((data.pages.filter(p=>p.category==="Other Pages").length)?[`${data.pages.filter(p=>p.category==="Other Pages").length} URLs could not be confidently categorised from their path/title.`]:[]),
    ...((data.pages.length>50)?[`The discovery found ${data.pages.length} URLs. Prioritise major user journeys before auditing all pages.`]:[])
  ]:[];
  return <main className="shell"><nav className="nav"><a className="brand" href="/">UX Audit</a><div className="navActions"><a className="connectionLink" href="/">Screenshot UX audit</a><a className="connectionLink" href="/model-health">Connection status</a></div></nav>
  <section className="hero"><div className="eyebrow">STEP 01 · INFORMATION ARCHITECTURE</div><h1>Map the website before auditing it.</h1><p className="lede">Discover pages from the public homepage and common sitemap files, review the draft site map, select the pages to audit, then choose a desktop or mobile viewport.</p>
  <form className="siteDiscoverForm" onSubmit={discover}><input aria-label="Website URL" type="url" placeholder="https://example.com" value={url} onChange={e=>setUrl(e.target.value)} required/><button className="auditButton" disabled={loading}>{loading?"Discovering pages…":"Discover pages"}</button></form>{error&&<p className="error">{error}</p>}
  {data&&<div className="siteMapPanel"><div className="siteMapTop"><div><div className="reportKicker">DRAFT SITE MAP</div><h2>{data.title||data.root}</h2><p>{data.pages.length} discovered URLs · {data.root}</p></div><button className="uploadButton" onClick={()=>setShowAudit(!showAudit)} type="button">{showAudit?"Hide IA review":"Audit Information Architecture"}</button></div>
  <div className="siteMapStats">{Object.entries(groups).map(([name,pages])=><span key={name}><strong>{pages.length}</strong> {name}</span>)}</div>
  {showAudit&&<div className="iaReview"><h3>Initial Information Architecture review</h3>{issues.length?<ul>{issues.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p>No obvious nesting or grouping warning detected from discovered URL/title signals. Review labels and page coverage manually.</p>}<p>These are heuristic signals only; they do not inspect full page content or prove that pages can be consolidated.</p></div>}
  <div className="siteMapToolbar"><strong>Select pages for UX audit</strong><span>{selected.length} selected</span><button type="button" onClick={()=>setSelected(data.pages.map(p=>p.url))}>Select all</button><button type="button" onClick={()=>setSelected([])}>Clear</button></div>
  <div className="siteMapTree">{Object.entries(groups).map(([category,pages])=><section className="siteMapGroup" key={category}><h3>{category} <span>{pages.length}</span></h3>{pages.map(p=><label className="siteMapPage" key={p.url}><input type="checkbox" checked={selected.includes(p.url)} onChange={()=>setSelected(old=>old.includes(p.url)?old.filter(x=>x!==p.url):[...old,p.url])}/><span className="siteMapPageName"><strong>{p.title||p.url}</strong><small>{p.url}</small></span><span className="pageDepth">{p.depth===0?"Home":`Level ${p.depth+1}`}</span><span className="pageSource">{p.source}</span></label>)}</section>)}</div>
  <section className="viewportPicker" aria-labelledby="viewportPickerTitle">
    <div className="viewportPickerIntro">
      <div className="reportKicker">STEP 02 · AUDIT VIEWPORT</div>
      <h3 id="viewportPickerTitle">Which device experience do you want to audit?</h3>
      <p>Select the view after choosing pages. The viewport choice is included in the audit plan.</p>
    </div>
    <div className="viewportSwitcher" role="group" aria-label="Choose audit viewport">
      <button type="button" className={`viewportChoice ${auditMode === "desktop" ? "active" : ""}`} aria-pressed={auditMode === "desktop"} onClick={()=>{setAuditMode("desktop");setPlanMessage("");}}>
        <span className="viewportChoiceIcon" aria-hidden="true">▱</span><span className="viewportChoiceText"><strong>Desktop</strong><small>1440 × 900 CSS px</small></span><span className="viewportChoiceCheck" aria-hidden="true">{auditMode === "desktop" ? "✓" : ""}</span>
      </button>
      <button type="button" className={`viewportChoice ${auditMode === "mobile" ? "active" : ""}`} aria-pressed={auditMode === "mobile"} onClick={()=>{setAuditMode("mobile");setPlanMessage("");}}>
        <span className="viewportChoiceIcon mobileViewportIcon" aria-hidden="true">▯</span><span className="viewportChoiceText"><strong>Mobile</strong><small>393 × 852 CSS px</small></span><span className="viewportChoiceCheck" aria-hidden="true">{auditMode === "mobile" ? "✓" : ""}</span>
      </button>
    </div>
    <p className="viewportHelp">{auditMode === "mobile" ? "Mobile selected · Use 393 × 852 CSS pixels as the reference viewport for page capture and mobile-specific UX checks." : "Desktop selected · Use 1440 × 900 CSS pixels as the reference viewport for desktop-specific UX checks."}</p>
  </section>
  <div className="selectedPagesFooter"><div><strong>{selected.length} pages selected</strong><p>The audit plan contains your selected page URLs and the chosen viewport. Automatic website screenshots and multi-page AI audit execution are not yet connected to this page-selection workflow.</p></div><div className="selectedPageActions"><button className="uploadButton" disabled={!selected.length} onClick={()=>void copySelectedUrls()} type="button">Copy selected URLs</button><button className="auditButton" disabled={!selected.length} onClick={()=>void copyAuditPlan()} type="button">Copy audit plan</button></div></div>{planMessage&&<p className="planMessage" role="status" aria-live="polite">{planMessage}</p>}<p className="uploadHint">{data.note}</p></div>}
  </section></main>;
}
