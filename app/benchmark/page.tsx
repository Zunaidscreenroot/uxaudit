"use client";
import { useEffect, useState } from "react";
import { PageHeading } from "../ui";

type Finding={severity:string;category:string;title:string;recommendation:string;description?:string;evidence?:Array<{detail?:string;element?:string;}>;};
type SitePage={url:string;title:string;category:string;depth:number;source:"navigation"|"sitemap";};
type ConfiguredSite={id:string;name:string;rawUrl:string;};
type Report={name:string;url:string;pageTitle?:string;pageCategory?:string;findings:Finding[];error?:string;mode?:"desktop"|"mobile";auditId?:string;qualityStatus?:"ready"|"review";qualityWarnings?:string[];};
const initial=[{name:"AU Small Finance Bank",url:"https://www.au.bank.in/"},{name:"Equitas Small Finance Bank",url:"https://www.equitasbank.com/"},{name:"Jana Small Finance Bank",url:"https://www.janabank.com/"}];
const inputStyle={width:"100%",boxSizing:"border-box" as const,border:"1px solid #e1e4eb",borderRadius:8,padding:"11px 12px",fontSize:13,background:"#fff",color:"#242833",outlineColor:"#c7f36b"};
function normalizeUrl(raw:string){const s=raw.trim();if(!s)return "";const u=new URL(/^https?:\/\//i.test(s)?s:"https://"+s);if(!["http:","https:"].includes(u.protocol))throw new Error("Use a public HTTP or HTTPS website.");return u.origin;}
function assessReportQuality(findings:Finding[]){const corpus=findings.map(f=>[f.title,f.description,f.evidence?.map(e=>[e.element,e.detail].filter(Boolean).join(" ")).join(" ")].filter(Boolean).join(" ")).join(" ").toLowerCase();const warnings:string[]=[];if(!findings.length)warnings.push("No findings were returned. Confirm the selected page was fully rendered before treating this as a clean result.");if(/security interstitial|performing security verification|security verification (?:is|required|in progress)|verification page|verification challenge|captcha|anti bot challenge|access challenge|verify you are human|checking your browser|cloudflare ray id|one more step to access|access denied/.test(corpus))warnings.push("The evidence may describe a verification or access-block page rather than the intended page. Re-capture or verify the site manually before comparing.");if(/(?:empty|blank) (?:blue )?(?:gradient|hero|main content|page|viewport)|(?:main content|hero|page|viewport).{0,55}(?:empty|blank|no visible content)|no visible (?:content|headline|call to action|cta|controls)/.test(corpus))warnings.push("The audit describes an unusually empty or incomplete content area. Verify scripts, consent flows and lazy-loaded content before treating this as a confirmed UX issue.");return{qualityStatus:(warnings.length?"review":"ready") as "review"|"ready",qualityWarnings:warnings};}
function recurringCategories(reports:Report[]){const groups=new Map<string,{sites:Set<string>;examples:string[]}>();for(const report of reports){if(report.error||report.qualityStatus!=="ready")continue;for(const finding of report.findings){const category=finding.category||"Uncategorized";const group=groups.get(category)||{sites:new Set<string>(),examples:[]};group.sites.add(report.name);if(group.examples.length<4)group.examples.push(report.name+": "+finding.title);groups.set(category,group);}}return Array.from(groups.entries()).filter(([,group])=>group.sites.size>=2).map(([category,group])=>({category,sites:Array.from(group.sites),examples:group.examples})).sort((a,b)=>b.sites.length-a.sites.length);}

export default function BenchmarkPage(){
 const [connection,setConnection]=useState<{connected:boolean;error?:string}|null>(null);
 const [clientName,setClientName]=useState("Ujjivan Small Finance Bank");
 const [clientUrl,setClientUrl]=useState("https://www.ujjivansfb.bank.in/");
 const [auditMode,setAuditMode]=useState<"desktop"|"mobile">("desktop");
 const [competitors,setCompetitors]=useState(initial);
 const [discoveredPages,setDiscoveredPages]=useState<Record<string,SitePage[]>>({});
 const [selectedPages,setSelectedPages]=useState<Record<string,string>>({});
 const [discoveryErrors,setDiscoveryErrors]=useState<Record<string,string>>({});
 const [discovering,setDiscovering]=useState(false);
 const [discoveryStatus,setDiscoveryStatus]=useState("");
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 const [error,setError]=useState("");
 const [reports,setReports]=useState<Report[]>([]);

 useEffect(()=>{let cancelled=false;fetch("/api/openrouter-status",{cache:"no-store"}).then(r=>r.json()).then(d=>{if(!cancelled)setConnection(d)}).catch(()=>{if(!cancelled)setConnection({connected:false,error:"Could not check OpenRouter connection"})});return()=>{cancelled=true}},[]);

 function getConfiguredSites():ConfiguredSite[]{
  return [
   {id:"client",name:clientName.trim()||"Client",rawUrl:clientUrl},
   ...competitors.map((item,index)=>({id:"competitor-"+index,name:item.name.trim()||"Competitor "+(index+1),rawUrl:item.url})).filter(site=>site.rawUrl.trim())
  ];
 }
 function clearPageDiscovery(siteId:string){
  setDiscoveredPages(prev=>{const next={...prev};delete next[siteId];return next;});
  setSelectedPages(prev=>{const next={...prev};delete next[siteId];return next;});
  setDiscoveryErrors(prev=>{const next={...prev};delete next[siteId];return next;});
  setDiscoveryStatus("");
  setReports([]);
 }
 function renderPageSelector(siteId:string,siteName:string){
  const pages=discoveredPages[siteId];
  const discoveryError=discoveryErrors[siteId];
  if(!pages?.length){
   return discoveryError?<div className="bm-quality-warning">{siteName}: could not discover linked pages — {discoveryError} You can still benchmark its homepage.</div>:null;
  }
  const selected=selectedPages[siteId]||pages[0].url;
  const categories=Array.from(new Set(pages.map(page=>page.category||"Other Pages")));
  const selectedPage=pages.find(page=>page.url===selected)||pages[0];
  return <div className="bm-page-picker">
   <label>{siteName} page to compare
    <select value={selected} onChange={event=>{setSelectedPages(prev=>({...prev,[siteId]:event.target.value}));setReports([]);}} style={inputStyle}>
     {categories.map(category=><optgroup label={category} key={category}>{pages.filter(page=>(page.category||"Other Pages")===category).map(page=><option value={page.url} key={page.url}>{page.title} — {new URL(page.url).pathname||"/"}</option>)}</optgroup>)}
    </select>
   </label>
   <small>{selectedPage.category} · {selectedPage.source==="navigation"?"Linked from site navigation":"Found in sitemap"} · {pages.length} linked pages discovered</small>
  </div>;
 }

 async function discoverLinkedPages(){
  setError("");
  setDiscoveryErrors({});
  setDiscoveryStatus("");
  setDiscovering(true);
  try{
   const configured=getConfiguredSites();
   if(!clientUrl.trim())throw new Error("Enter the client website URL first.");
   if(configured.length<2)throw new Error("Add at least one competitor URL before discovering pages.");
   const sites=configured.map(site=>({...site,rootUrl:normalizeUrl(site.rawUrl)}));
   if(sites.some(site=>!site.rootUrl))throw new Error("Enter a valid public URL for every selected website.");
   if(new Set(sites.map(site=>site.rootUrl)).size!==sites.length)throw new Error("Each website must have a unique URL.");
   setDiscoveryStatus("Discovering navigation links and sitemap pages across "+sites.length+" websites…");
   const results=await Promise.all(sites.map(async site=>{
    try{
     const response=await fetch("/api/discover",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:site.rootUrl}),cache:"no-store"});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Page discovery request failed.");
     const pages:Array<SitePage>=Array.isArray(data.pages)?data.pages.filter((page:any)=>page&&typeof page.url==="string"&&typeof page.title==="string").map((page:any)=>({url:page.url,title:page.title||page.url,category:page.category||"Other Pages",depth:Number(page.depth)||0,source:page.source==="sitemap"?"sitemap":"navigation"})):[];
     if(!pages.length)throw new Error("No linked pages were returned.");
     return {id:site.id,name:site.name,pages,error:""};
    }catch(e){return{id:site.id,name:site.name,pages:[] as SitePage[],error:e instanceof Error?e.message:"Page discovery failed"};}
   }));
   const found=results.filter(result=>result.pages.length);
   setDiscoveredPages(prev=>({...prev,...Object.fromEntries(found.map(result=>[result.id,result.pages]))}));
   setDiscoveryErrors(Object.fromEntries(results.filter(result=>result.error).map(result=>[result.id,result.error])));
   setSelectedPages(prev=>{
    const next={...prev};
    for(const result of found){
     if(!result.pages.some(page=>page.url===next[result.id])){
      const home=result.pages.find(page=>page.category==="Home")||result.pages[0];
      next[result.id]=home.url;
     }
    }
    return next;
   });
   setReports([]);
   setDiscoveryStatus("Page discovery complete: "+found.length+" of "+sites.length+" websites returned linked pages. Choose the page on each website below; select the same page type (for example, About Us) for a fair comparison.");
  }catch(e){setError(e instanceof Error?e.message:"Could not discover linked pages.");}
  finally{setDiscovering(false);}
 }

 async function run(){
  setError("");
  setReports([]);
  setBusy(true);
  try{
   const configured=getConfiguredSites();
   if(!clientUrl.trim())throw new Error("Enter the client website URL.");
   if(configured.length<2)throw new Error("Add at least one competitor URL to compare against the client.");
   const roots=configured.map(site=>({...site,rootUrl:normalizeUrl(site.rawUrl)}));
   if(roots.some(site=>!site.rootUrl))throw new Error("Enter a valid public URL for every selected website.");
   if(new Set(roots.map(site=>site.rootUrl)).size!==roots.length)throw new Error("Each website must have a unique URL.");
   const entries=roots.map(site=>{
    const page=discoveredPages[site.id]?.find(item=>item.url===selectedPages[site.id]);
    const url=page?.url||site.rootUrl;
    if(new URL(url).origin!==site.rootUrl)throw new Error("Selected page must belong to the configured website: "+site.name);
    const pathname=new URL(url).pathname;
    const inferredTitle=pathname==="/"?"Homepage":pathname.split("/").filter(Boolean).pop()?.replace(/[-_]/g," ")||"Selected page";
    return {id:site.id,name:site.name,url,rootUrl:site.rootUrl,pageTitle:page?.title||inferredTitle,pageCategory:page?.category||(pathname==="/"?"Home":"Selected page")};
   });
   setStatus("Checking paid vision models…");
   const modelCheck=await fetch("/api/model-health/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",cache:"no-store"});
   const modelData=await modelCheck.json().catch(()=>({}));
   const verifiedModels=Array.isArray(modelData.selectedModels)?modelData.selectedModels.filter((m:any)=>m?.provider==="OpenRouter"&&m?.tier==="paid"&&typeof m.model==="string"&&!m.model.endsWith(":free")&&m.model!=="openrouter/auto").slice(0,2).map((m:any)=>({provider:"OpenRouter",model:m.model,tier:"paid"})):[];
   if(!modelCheck.ok||!verifiedModels.length)throw new Error(modelData.error||"No paid image-capable model was verified. Refresh model health and try again.");
   const output:Report[]=new Array(entries.length);let nextIndex=0;
   await Promise.all(Array.from({length:Math.min(2,entries.length)},async()=>{
    while(true){
     const index=nextIndex++;if(index>=entries.length)return;
     const entry=entries[index];
     setStatus("Auditing "+(index+1)+" of "+entries.length+" ("+auditMode+"): "+entry.name+" — "+entry.pageTitle);
     try{
      const response=await fetch("/api/audit-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:entry.url,projectName:entry.name,auditMode,verifiedModels})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Audit request failed.");
      const findings:Finding[]=Array.isArray(data.page?.findings)?data.page.findings:[];
      const quality=assessReportQuality(findings);
      output[index]={name:entry.name,url:entry.url,pageTitle:entry.pageTitle,pageCategory:entry.pageCategory,mode:auditMode,auditId:typeof data.auditId==="string"?data.auditId:undefined,findings,...quality};
     }catch(e){output[index]={name:entry.name,url:entry.url,pageTitle:entry.pageTitle,pageCategory:entry.pageCategory,mode:auditMode,findings:[],error:e instanceof Error?e.message:"Audit failed"};}
     setReports(output.filter(item=>Boolean(item)) as Report[]);
    }
   }));
   const completed=output.filter(item=>Boolean(item)) as Report[];
   if(completed.every(report=>report.error))throw new Error("None of the websites could be audited. Check capture access and OpenRouter configuration.");
   const qualityPassed=completed.filter(report=>!report.error&&report.qualityStatus==="ready");
   const categoryCounts=new Map<string,number>();
   for(const report of qualityPassed)categoryCounts.set(report.pageCategory||"Unknown", (categoryCounts.get(report.pageCategory||"Unknown")||0)+1);
   const leadingCategory=Array.from(categoryCounts.entries()).sort((a,b)=>b[1]-a[1])[0];
   const comparable=leadingCategory&&leadingCategory[1]>=2?qualityPassed.filter(report=>(report.pageCategory||"Unknown")===leadingCategory[0]):[];
   const review=completed.filter(report=>!report.error&&report.qualityStatus==="review").length;
   const failed=completed.filter(report=>Boolean(report.error)).length;
   const categoryStatus=comparable.length>=2?" Like-for-like group: "+leadingCategory?.[0]+".":" Select the same page type across sites to enable cross-site synthesis.";
   setStatus("Benchmark finished ("+auditMode+"): "+comparable.length+" site(s) ready for like-for-like comparison, "+review+" need capture review, "+failed+" failed."+categoryStatus+" Finding counts are not a quality score.");
  }catch(e){setError(e instanceof Error?e.message:"Could not run benchmark.");}
  finally{setBusy(false);}
 }

 const count=(r:Report,severity:string)=>r.findings.filter(f=>f.severity.toLowerCase()===severity).length;
 const qualityPassedReports=reports.filter(r=>!r.error&&r.qualityStatus==="ready");
 const pageCategoryCounts=new Map<string,number>();
 for(const report of qualityPassedReports)pageCategoryCounts.set(report.pageCategory||"Unknown",(pageCategoryCounts.get(report.pageCategory||"Unknown")||0)+1);
 const leadingPageCategory=Array.from(pageCategoryCounts.entries()).sort((a,b)=>b[1]-a[1])[0];
 const comparableReports=leadingPageCategory&&leadingPageCategory[1]>=2?qualityPassedReports.filter(r=>(r.pageCategory||"Unknown")===leadingPageCategory[0]):[];
 const recurringThemes=recurringCategories(comparableReports);
 const clientReport=reports[0];
 const clientPriorities=clientReport&&!clientReport.error&&clientReport.qualityStatus==="ready"&&comparableReports.some(report=>report.url===clientReport.url)?[...clientReport.findings].filter(f=>["high","medium"].includes(f.severity.toLowerCase())).sort((a,b)=>(a.severity.toLowerCase()==="high"?0:1)-(b.severity.toLowerCase()==="high"?0:1)).slice(0,3):[];

 return <main className="or-app">
  <aside className="or-sidebar">
   <a className="or-brand" href="/"><span className="or-brand-mark">u</span><span>ux<span>audit</span></span></a>
   <div className="or-workspace"><span className="or-avatar">SR</span><span><strong>ScreenRoot workspace</strong><small>UX Intelligence</small></span><span className="or-chevron">⌄</span></div>
   <div className="or-side-label">WORKSPACE</div>
   <a className="or-side-link" href="/"><span>⌂</span> Overview</a>
   <a className="or-side-link" href="/site-map"><span>⌘</span> IA &amp; Audit</a>
   <a className="or-side-link active" href="/benchmark"><span>⇄</span> Competitor benchmark</a>
   <a className="or-side-link" href="/knowledge-base"><span>▤</span> Knowledge base</a>
   <a className="or-side-link" href="/coach"><span>✦</span> Coach &amp; Learn</a>
   <div className="or-sidebar-bottom"><div className="or-help-icon">?</div><div><strong>Evidence-led UX</strong><small>Built for senior review</small></div><span className="or-online-dot"/></div>
  </aside>
  <section className="or-main">
   <header className="or-topbar"><div className="or-breadcrumb"><a href="/" style={{color:"inherit",textDecoration:"none"}}>Workspace</a><span>/</span><strong>Competitor benchmark</strong></div><div className="or-top-actions"><span className={"or-connection "+(connection?.connected?"is-connected":connection?"is-error":"")}><i/>{connection?.connected?"OpenRouter connected":connection?"OpenRouter unavailable":"Connecting to OpenRouter"}</span><span className="or-user-avatar">Z</span></div></header>
   <div className="or-content">
    <PageHeading eyebrow="COMPETITIVE UX INTELLIGENCE" title="Benchmark the experience." description="Select the same type of linked page on your client and competitor websites, then compare the evidence at a matching viewport." actions={<a className="or-text-link" href="/">← Back to overview</a>} />
    <section className="or-start-card">
     <div className="or-start-card-top"><div className="or-step-icon">⇄</div><div><h2>Set up a benchmark</h2><p>Benchmark homepages by default, or discover linked pages and select About Us, Products, Contact, or another page on each site. Two audits run concurrently; successful audits are saved to Past Findings.</p></div><span className="or-pill">Up to 4 websites</span></div>
     <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",margin:"14px 0"}}><strong style={{fontSize:13,color:"#343946",marginRight:4}}>Compare viewport</strong><button type="button" aria-pressed={auditMode==="desktop"} onClick={()=>setAuditMode("desktop")} style={{border:"1px solid "+(auditMode==="desktop"?"#71833c":"#e1e4eb"),background:auditMode==="desktop"?"#eef4d8":"#fff",color:"#242833",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Desktop · 1440 px</button><button type="button" aria-pressed={auditMode==="mobile"} onClick={()=>setAuditMode("mobile")} style={{border:"1px solid "+(auditMode==="mobile"?"#71833c":"#e1e4eb"),background:auditMode==="mobile"?"#eef4d8":"#fff",color:"#242833",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Mobile · 393 × 852 px</button><span style={{fontSize:12,color:"#737987"}}>Every selected page uses the same viewport dimensions.</span></div>
     <div className="bm-form-grid">
      <label>Client / project name<input value={clientName} onChange={event=>{setClientName(event.target.value);setReports([]);}} style={inputStyle}/></label>
      <label>Client website URL<input value={clientUrl} onChange={event=>{setClientUrl(event.target.value);clearPageDiscovery("client");}} placeholder="https://client.com" style={inputStyle}/></label>
     </div>
     {renderPageSelector("client","Client")}
     <div className="bm-competitor-heading"><div><h3>Competitors</h3><p>Discover each site's navigation and sitemap to select a matching page.</p></div><span className="or-muted-chip">{competitors.filter(item=>item.url.trim()).length} of 3 added</span></div>
     <div className="bm-competitor-grid">{competitors.map((item,index)=><article className="bm-competitor" key={index}>
      <div className="bm-competitor-index"><span>0{index+1}</span> COMPETITOR</div>
      <label>Brand / institution name<input value={item.name} onChange={event=>{setCompetitors(prev=>prev.map((x,j)=>j===index?{...x,name:event.target.value}:x));setReports([]);}} style={inputStyle}/></label>
      <label>Website URL<input value={item.url} onChange={event=>{setCompetitors(prev=>prev.map((x,j)=>j===index?{...x,url:event.target.value}:x));clearPageDiscovery("competitor-"+index);}} placeholder="https://competitor.com" style={inputStyle}/></label>
      {renderPageSelector("competitor-"+index,item.name.trim()||"Competitor "+(index+1))}
     </article>)}</div>
     <div className="bm-discovery-row"><button type="button" className="bm-discover-button" disabled={busy||discovering} onClick={discoverLinkedPages}>{discovering?<><span className="or-button-spinner"/> Discovering linked pages…</>:"Discover linked pages"}</button><p>Reads public navigation links and common sitemap files. Page discovery does not run AI audits or incur model inference.</p></div>
     {discoveryStatus&&<div className="bm-status" role="status"><i/>{discoveryStatus}</div>}
     <div className="bm-run-row"><button className="bm-run-button" disabled={busy||discovering} onClick={run}>{busy?<><span className="or-button-spinner"/> Benchmark running…</>:"Run benchmark"} <span>→</span></button><p>The selected page URL—not necessarily the homepage—is audited on each site. Model usage may incur cost.</p></div>
     {status&&<div className="bm-status" role="status"><i/>{status}</div>}
     {error&&<div className="bm-error" role="alert">{error}</div>}
    </section>
    {reports.length>0&&<section className="bm-results">
     <div className="or-section-heading"><div><h2>Selected-page comparison</h2><p>Compare the same page type where possible; treat this as a qualitative snapshot, not a normalized score.</p></div><span className="or-muted-chip">{reports.length} processed</span></div>
     <section className="bm-synthesis">
      <div className="bm-synthesis-top"><div><strong>Cross-site synthesis</strong><p>{comparableReports.length} of {reports.length} reports are eligible for like-for-like qualitative comparison{leadingPageCategory&&leadingPageCategory[1]>=2?" · Page type: "+leadingPageCategory[0]:""}.</p></div><span className="bm-quality-pill ready">Counts are not scores</span></div>
      {comparableReports.length>=2?<div className="bm-synthesis-grid">
       <article><h3>Recurring audit themes</h3>{recurringThemes.length?recurringThemes.slice(0,4).map(theme=><div className="bm-theme" key={theme.category}><strong>{theme.category}</strong><small>Found across: {theme.sites.join(", ")}</small><p>{theme.examples.slice(0,3).join(" · ")}</p></div>):<p>No category-level theme recurs across the selected pages. Review the individual evidence rather than forcing a common pattern.</p>}</article>
       <article><h3>Client priorities</h3>{clientPriorities.length?clientPriorities.map(finding=><div className="bm-theme" key={finding.title}><strong><span className={"bm-severity-label "+finding.severity.toLowerCase()}>{finding.severity}</span> {finding.title}</strong><p>{finding.recommendation}</p></div>):<p>The client page needs capture review, or it has no high/medium findings in the comparable page group. Inspect the evidence before drawing a priority conclusion.</p>}</article>
      </div>:<div className="bm-quality-warning">Cross-site synthesis is paused until at least two capture-verified reports share the same discovered page category. Select the matching page type (for example, About Us) on each website.</div>}
      <p className="bm-synthesis-note">Page type, available content, capture success and site complexity can affect findings. Confirm recommendations against each site's screenshot evidence.</p>
     </section>
     <div className="bm-report-grid">{reports.map((r,i)=><article className="bm-report" key={r.url}>
      <div className="bm-report-top"><span className={i===0?"bm-role client":"bm-role"}>{i===0?"CLIENT BASELINE":"COMPETITOR "+i}</span><span className={"bm-quality-pill "+(r.error?"failed":r.qualityStatus==="review"?"review":"ready")}>{r.error?"FAILED":r.qualityStatus==="review"?"REVIEW REQUIRED":"READY TO COMPARE"}</span><span className="bm-report-index">0{i+1}</span></div>
      <h3>{r.name}</h3><div className="bm-selected-page-label">Selected page: <strong>{r.pageTitle||"Homepage"}</strong>{r.pageCategory?" · "+r.pageCategory:""}</div><a className="bm-url" href={r.url} target="_blank" rel="noreferrer">{r.url} ↗</a>
      {!r.error&&r.qualityWarnings?.map((warning,j)=><div className="bm-quality-warning" key={j}>{warning}</div>)}
      {r.error?<div className="bm-report-error">{r.error}</div>:<><div className="bm-severity-grid">{(["high","medium","low"] as const).map(s=><div key={s} className={"bm-severity "+s}><span>{s}</span><strong>{count(r,s)}</strong></div>)}</div><div className="bm-report-summary">{r.findings.length} findings <span>·</span> {new Set(r.findings.map(f=>f.category)).size} categories</div>{r.findings.slice(0,6).map((f,j)=><div className="bm-finding" key={j}><div><span className={"bm-severity-label "+f.severity.toLowerCase()}>{f.severity}</span><span className="bm-category">{f.category}</span></div><strong>{f.title}</strong><p>{f.recommendation}</p></div>)}</>}
     </article>)}</div>
     <div className="bm-caveat"><strong>Interpretation note</strong><p>The selected URL is audited, and successful audits are saved to Past Findings. Only reports with verified output from the same discovered page category are included in the cross-site synthesis. Finding counts are not a quality score.</p></div>
    </section>}
   </div>
   <footer className="or-footer"><span>UX Audit <span>·</span> Evidence first, recommendations second.</span><div><a href="/knowledge-base">Knowledge base</a><a href="/site-map">IA &amp; Audit</a></div></footer>
  </section>
 </main>;
}
