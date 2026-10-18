"use client";
import { useEffect, useState } from "react";
import { PageHeading } from "../ui";
type Finding={severity:string;category:string;title:string;recommendation:string;};
type Report={name:string;url:string;findings:Finding[];error?:string;mode?:"desktop"|"mobile";auditId?:string;};
const initial=[{name:"AU Small Finance Bank",url:"https://www.aubank.in/"},{name:"Equitas Small Finance Bank",url:"https://www.equitasbank.com/"},{name:"Jana Small Finance Bank",url:"https://www.janabank.com/"}];
const inputStyle={width:"100%",boxSizing:"border-box" as const,border:"1px solid #e1e4eb",borderRadius:8,padding:"11px 12px",fontSize:13,background:"#fff",color:"#242833",outlineColor:"#c7f36b"};
function normalizeUrl(raw:string){const s=raw.trim();if(!s)return "";const u=new URL(/^https?:\/\//i.test(s)?s:"https://"+s);if(!["http:","https:"].includes(u.protocol))throw new Error("Use a public HTTP or HTTPS website.");return u.origin;}

function exportBenchmarkMarkdown(reports:Report[],mode:"desktop"|"mobile"){
 const successful=reports.filter(report=>!report.error);
 const total=successful.reduce((sum,report)=>sum+report.findings.length,0);
 const lines:string[]=[
  "# Benchmarking Studio — UX comparison",
  "",
  `- **Viewport:** ${mode==="mobile"?"Mobile · 393 × 852 CSS px":"Desktop · 1440 px wide"}`,
  `- **Sites processed:** ${reports.length}`,
  `- **Successful audits:** ${successful.length}`,
  `- **Finding observations:** ${total}`,
  `- **Generated:** ${new Date().toISOString()}`,
  "",
  "> Interpretation: this is an evidence-led qualitative snapshot. Finding counts depend on capture quality and page content; they are not a normalized UX quality score or measured business outcome.",
  ""
 ];
 reports.forEach((report,index)=>{
  lines.push(`## ${index===0?"Client baseline":"Competitor "+index} — ${report.name}`,"",`- **URL:** ${report.url}`,`- **Status:** ${report.error?"Failed — "+report.error:"Completed"}`);
  if(!report.error){
   for(const severity of ["high","medium","low"]){
    const n=report.findings.filter(f=>f.severity.toLowerCase()===severity).length;
    lines.push(`- **${severity[0].toUpperCase()+severity.slice(1)} severity:** ${n}`);
   }
   lines.push("");
   report.findings.forEach((finding,i)=>lines.push(`### ${i+1}. [${finding.severity.toUpperCase()}] ${finding.title}`,"",`- **Category:** ${finding.category||"Uncategorized"}`,`- **Recommendation:** ${finding.recommendation}`,""));
  }
  lines.push("");
 });
 const blob=new Blob([lines.join("\n")],{type:"text/markdown;charset=utf-8"});
 const href=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=href;a.download="benchmarking-studio-"+mode+"-"+new Date().toISOString().slice(0,10)+".md";
 document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(href);
}

export default function BenchmarkPage(){
 const [connection,setConnection]=useState<{connected:boolean;error?:string}|null>(null);const [clientName,setClientName]=useState("Ujjivan Small Finance Bank");const [clientUrl,setClientUrl]=useState("https://www.ujjivansfb.bank.in/");const [auditMode,setAuditMode]=useState<"desktop"|"mobile">("desktop");const [competitors,setCompetitors]=useState(initial);const [busy,setBusy]=useState(false);const [status,setStatus]=useState("");const [error,setError]=useState("");const [reports,setReports]=useState<Report[]>([]);
 useEffect(()=>{let cancelled=false;fetch("/api/openrouter-status",{cache:"no-store"}).then(r=>r.json()).then(d=>{if(!cancelled)setConnection(d)}).catch(()=>{if(!cancelled)setConnection({connected:false,error:"Could not check OpenRouter connection"})});return()=>{cancelled=true}},[]);
 async function run(){
  setError("");setReports([]);setBusy(true);
  try{
   const entries=[{name:clientName.trim()||"Client",url:normalizeUrl(clientUrl)},...competitors.filter(x=>x.url.trim()).map(x=>({name:x.name.trim()||new URL(normalizeUrl(x.url)).hostname,url:normalizeUrl(x.url)}))];
   if(!entries[0].url)throw new Error("Enter the client website URL.");
   if(entries.length<2)throw new Error("Add at least one competitor URL to compare against the client.");
   if(new Set(entries.map(x=>x.url)).size!==entries.length)throw new Error("Each website must have a unique URL.");
   setStatus("Checking paid vision models…");
   const modelCheck=await fetch("/api/model-health/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",cache:"no-store"});
   const modelData=await modelCheck.json().catch(()=>({}));
   const verifiedModels=Array.isArray(modelData.selectedModels)
    ? modelData.selectedModels.filter((m:any)=>m?.provider==="OpenRouter"&&m?.tier==="paid"&&typeof m.model==="string"&&!m.model.endsWith(":free")&&m.model!=="openrouter/auto").slice(0,2).map((m:any)=>({provider:"OpenRouter",model:m.model,tier:"paid"}))
    : [];
   if(!modelCheck.ok||!verifiedModels.length)throw new Error(modelData.error||"No paid image-capable model was verified. Refresh model health and try again.");
   const output:Report[]=new Array(entries.length);let nextIndex=0;
   await Promise.all(Array.from({length:Math.min(2,entries.length)},async()=>{
    while(true){
     const index=nextIndex++;if(index>=entries.length)return;
     const entry=entries[index];setStatus("Auditing "+(index+1)+" of "+entries.length+" ("+auditMode+"): "+entry.name);
     try{
      const response=await fetch("/api/audit-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:entry.url,projectName:entry.name,auditMode,verifiedModels})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Audit request failed.");
      output[index]={name:entry.name,url:entry.url,mode:auditMode,auditId:typeof data.auditId==="string"?data.auditId:undefined,findings:Array.isArray(data.page?.findings)?data.page.findings:[]};
     }catch(e){output[index]={name:entry.name,url:entry.url,mode:auditMode,findings:[],error:e instanceof Error?e.message:"Audit failed"};}
     setReports(output.filter((item)=>Boolean(item)) as Report[]);
    }
   }));
   const completed=output.filter((item)=>Boolean(item)) as Report[];
   if(completed.every(x=>x.error))throw new Error("None of the websites could be audited. Check capture access and OpenRouter configuration.");
   const success=completed.filter(x=>!x.error).length;
   setStatus("Benchmark finished: "+success+" of "+entries.length+" sites audited in "+auditMode+" mode. Compare matched evidence; counts are not a quality score.");
  }catch(e){setError(e instanceof Error?e.message:"Could not run benchmark.");}
  finally{setBusy(false);}
 }
 const count=(r:Report,severity:string)=>r.findings.filter(f=>f.severity.toLowerCase()===severity).length;
 const successfulReports=reports.filter(report=>!report.error);
 const totalFindings=successfulReports.reduce((sum,report)=>sum+report.findings.length,0);
 const highSeverityCount=successfulReports.reduce((sum,report)=>sum+count(report,"high"),0);
 const categoryRows=Array.from(new Set(successfulReports.flatMap(report=>report.findings.map(finding=>finding.category.trim()||"Uncategorized"))))
  .map(category=>({category,counts:successfulReports.map(report=>report.findings.filter(finding=>(finding.category.trim()||"Uncategorized")===category).length)}))
  .sort((a,b)=>b.counts.reduce((sum,n)=>sum+n,0)-a.counts.reduce((sum,n)=>sum+n,0));
 const sharedCategories=categoryRows.filter(row=>row.counts.filter(n=>n>0).length>1).length;
 return <main className="or-app"><aside className="or-sidebar"><a className="or-brand" href="/"><span className="or-brand-mark">u</span><span>ux<span>audit</span></span></a><div className="or-workspace"><span className="or-avatar">SR</span><span><strong>ScreenRoot workspace</strong><small>UX Intelligence</small></span><span className="or-chevron">⌄</span></div><div className="or-side-label">WORKSPACE</div><a className="or-side-link" href="/"><span>⌂</span> Overview</a><a className="or-side-link" href="/site-map"><span>⌘</span> IA &amp; Audit</a><a className="or-side-link active" href="/benchmarking-studio"><span>⇄</span> Competitor benchmark</a><a className="or-side-link" href="/knowledge-base"><span>▤</span> Knowledge base</a><a className="or-side-link" href="/coach"><span>✦</span> Coach &amp; Learn</a><div className="or-sidebar-bottom"><div className="or-help-icon">?</div><div><strong>Evidence-led UX</strong><small>Built for senior review</small></div><span className="or-online-dot"/></div></aside>
 <section className="or-main"><header className="or-topbar"><div className="or-breadcrumb"><a href="/" style={{color:"inherit",textDecoration:"none"}}>Workspace</a><span>/</span><strong>Benchmarking Studio</strong></div><div className="or-top-actions"><span className={"or-connection "+(connection?.connected?"is-connected":connection?"is-error":"")}><i/>{connection?.connected?"OpenRouter connected":connection?"OpenRouter unavailable":"Connecting to OpenRouter"}</span><span className="or-user-avatar">Z</span></div></header><div className="or-content"><PageHeading eyebrow="COMPETITIVE UX INTELLIGENCE" title="Benchmarking Studio" description="Run matched desktop or mobile homepage audits across your client and up to three competitors. Compare evidence and recurring issue themes without reducing UX quality to a single score." actions={<><button type="button" className="uxd-button uxd-button-secondary uxd-button-sm" onClick={()=>exportBenchmarkMarkdown(reports,auditMode)} disabled={!reports.length}>Export snapshot ↓</button><a className="or-text-link" href="/">← Overview</a></>} />
 <section className="or-start-card"><div className="or-start-card-top"><div className="or-step-icon">⇄</div><div><h2>Set up a benchmark</h2><p>Name the client and competitor websites. The benchmark audits every selected homepage at the same viewport. Two sites run concurrently; successful audits are saved to Past Findings.</p></div><span className="or-pill">Up to 4 websites</span></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",margin:"14px 0"}}><strong style={{fontSize:13,color:"#343946",marginRight:4}}>Compare viewport</strong><button type="button" aria-pressed={auditMode==="desktop"} onClick={()=>setAuditMode("desktop")} style={{border:"1px solid "+(auditMode==="desktop"?"#71833c":"#e1e4eb"),background:auditMode==="desktop"?"#eef4d8":"#fff",color:"#242833",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Desktop · 1440 px</button><button type="button" aria-pressed={auditMode==="mobile"} onClick={()=>setAuditMode("mobile")} style={{border:"1px solid "+(auditMode==="mobile"?"#71833c":"#e1e4eb"),background:auditMode==="mobile"?"#eef4d8":"#fff",color:"#242833",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Mobile · 393 × 852 px</button><span style={{fontSize:12,color:"#737987"}}>Audit all selected sites at the same viewport.</span></div><div className="bm-form-grid"><label>Client / project name<input value={clientName} onChange={e=>setClientName(e.target.value)} style={inputStyle}/></label><label>Client homepage URL<input value={clientUrl} onChange={e=>setClientUrl(e.target.value)} placeholder="https://client.com" style={inputStyle}/></label></div><div className="bm-competitor-heading"><div><h3>Competitors</h3><p>Enter only the competitors you want to include.</p></div><span className="or-muted-chip">{competitors.filter(x=>x.url.trim()).length} of 3 added</span></div><div className="bm-competitor-grid">{competitors.map((item,i)=><article className="bm-competitor" key={i}><div className="bm-competitor-index"><span>0{i+1}</span> COMPETITOR</div><label>Brand / institution name<input value={item.name} onChange={e=>setCompetitors(prev=>prev.map((x,j)=>j===i?{...x,name:e.target.value}:x))} style={inputStyle}/></label><label>Homepage URL<input value={item.url} onChange={e=>setCompetitors(prev=>prev.map((x,j)=>j===i?{...x,url:e.target.value}:x))} placeholder="https://competitor.com" style={inputStyle}/></label></article>)}</div><div className="bm-run-row"><button className="bm-run-button" disabled={busy} onClick={run}>{busy?<><span className="or-button-spinner"/> Benchmark running…</>:"Run benchmark"} <span>→</span></button><p>Viewport: {auditMode}. Each site triggers screenshot capture and OpenRouter analysis. Model usage may incur cost.</p></div>{status&&<div className="bm-status" role="status"><i/>{status}</div>}{error&&<div className="bm-error" role="alert">{error}</div>}</section>
 {reports.length>0&&<section className="bm-results"><div className="or-section-heading"><div><h2>Comparable audit snapshot</h2><p>Directional comparison, not a statistically normalized score.</p></div><span className="or-muted-chip">{reports.length} processed</span></div><div className="bm-studio-summary" aria-label="Benchmark summary">
 <article><span>Completed sites</span><strong>{successfulReports.length}<small> / {reports.length}</small></strong><small>Successfully analysed in this run</small></article>
 <article><span>High-severity observations</span><strong>{highSeverityCount}</strong><small>Across completed websites</small></article>
 <article><span>Finding themes</span><strong>{categoryRows.length}</strong><small>{sharedCategories} shared across 2+ sites</small></article>
 <article><span>Total observations</span><strong>{totalFindings}</strong><small>Not a normalized UX score</small></article>
 </div><div className="bm-report-grid">{reports.map((r,i)=><article className="bm-report" key={r.url}><div className="bm-report-top"><span className={i===0?"bm-role client":"bm-role"}>{i===0?"CLIENT BASELINE":"COMPETITOR "+i}</span><span className="bm-report-index">0{i+1}</span></div><h3>{r.name}</h3><a className="bm-url" href={r.url} target="_blank" rel="noreferrer">{r.url} ↗</a>{r.error?<div className="bm-report-error">{r.error}</div>:<><div className="bm-severity-grid">{(["high","medium","low"] as const).map(s=><div key={s} className={"bm-severity "+s}><span>{s}</span><strong>{count(r,s)}</strong></div>)}</div><div className="bm-report-summary">{r.findings.length} findings <span>·</span> {new Set(r.findings.map(f=>f.category)).size} categories</div>{r.findings.slice(0,6).map((f,j)=><div className="bm-finding" key={j}><div><span className={"bm-severity-label "+f.severity.toLowerCase()}>{f.severity}</span><span className="bm-category">{f.category}</span></div><strong>{f.title}</strong><p>{f.recommendation}</p></div>)}</>}</article>)}</div>{categoryRows.length>0&&<section className="bm-theme-section"><div className="bm-theme-heading"><div><h3>Theme coverage across sites</h3><p>Finding observations by category. A higher count is not a lower-quality score.</p></div><span className="or-muted-chip">{categoryRows.length} themes</span></div><div className="bm-theme-table-wrap"><table className="bm-theme-table"><thead><tr><th scope="col">Finding theme</th>{successfulReports.map(report=><th scope="col" key={report.url}>{report.name}</th>)}<th scope="col">Sites with theme</th></tr></thead><tbody>{categoryRows.map(row=><tr key={row.category}><th scope="row">{row.category}</th>{row.counts.map((value,index)=><td key={successfulReports[index].url}><span className={"bm-theme-count"+(value>0?" has-findings":"")}>{value}</span></td>)}<td>{row.counts.filter(value=>value>0).length} / {successfulReports.length}</td></tr>)}</tbody></table></div></section>}<div className="bm-caveat"><strong>Interpretation note</strong><p>This first version audits each homepage once. Capture success, content density, and detected issues affect counts. Use findings as a qualitative comparison, not proof that one institution is objectively better.</p></div></section>}
 </div><footer className="or-footer"><span>UX Audit <span>·</span> Evidence first, recommendations second.</span><div><a href="/knowledge-base">Knowledge base</a><a href="/site-map">IA &amp; Audit</a></div></footer></section></main>;
}
