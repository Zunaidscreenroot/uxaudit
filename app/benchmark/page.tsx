"use client";
import { useEffect, useState } from "react";
import { PageHeading } from "../ui";
type Finding={severity:string;category:string;title:string;recommendation:string;description?:string;evidence?:Array<{detail?:string;element?:string;}>;};
type Report={name:string;url:string;findings:Finding[];error?:string;mode?:"desktop"|"mobile";auditId?:string;qualityStatus?:"ready"|"review";qualityWarnings?:string[];screenshot?:string;screenshotWidth?:number;screenshotHeight?:number;captureMethod?:string;status?:"running"|"complete"|"review"|"failed";};
const initial=[{name:"AU Small Finance Bank",url:"https://www.au.bank.in/"},{name:"HDFC Bank",url:"https://www.hdfc.bank.in/"},{name:"Equitas Small Finance Bank",url:"https://www.equitasbank.com/"}];
const inputStyle={width:"100%",boxSizing:"border-box" as const,border:"1px solid #e1e4eb",borderRadius:8,padding:"11px 12px",fontSize:13,background:"#fff",color:"#242833",outlineColor:"#c7f36b"};
function normalizeUrl(raw:string){const s=raw.trim();if(!s)return "";const u=new URL(/^https?:\/\//i.test(s)?s:"https://"+s);if(!["http:","https:"].includes(u.protocol))throw new Error("Use a public HTTP or HTTPS website.");return u.origin;}
function assessReportQuality(findings:Finding[]){const corpus=findings.map(f=>[f.title,f.description,f.evidence?.map(e=>[e.element,e.detail].filter(Boolean).join(" ")).join(" ")].filter(Boolean).join(" ")).join(" ").toLowerCase();const warnings:string[]=[];if(!findings.length)warnings.push("No findings were returned. Confirm the captured screenshot shows the fully rendered homepage before treating this as a clean result.");if(/security interstitial|performing security verification|security verification (?:is|required|in progress)|verification page|verification challenge|captcha|anti bot challenge|access challenge|verify you are human|checking your browser|cloudflare ray id|one more step to access|access denied/.test(corpus))warnings.push("The evidence may describe a verification or access-block page rather than the intended homepage. Re-capture or verify the site manually before comparing.");if(/(?:empty|blank) (?:blue )?(?:gradient|hero|main content|page|viewport)|(?:main content|hero|page|viewport).{0,55}(?:empty|blank|no visible content)|no visible (?:content|headline|call to action|cta|controls)/.test(corpus))warnings.push("The audit describes an unusually empty or incomplete content area. Verify that scripts, consent flows and lazy-loaded content finished rendering before treating it as a confirmed UX issue.");return{qualityStatus:(warnings.length?"review":"ready") as "review"|"ready",qualityWarnings:warnings};}
function screenshotDocument(dataUrl:string){
 if(!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl))return "";
 const safeSrc=dataUrl.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#111710;color:#dce6d4}body{overflow:auto}img{display:block;width:100%;height:auto;margin:0 auto}p{font:12px/1.5 system-ui,sans-serif;padding:18px}</style></head><body><img src="'+safeSrc+'" alt="Captured full-page website screenshot"></body></html>';
}
function safeOrigin(raw:string){try{return normalizeUrl(raw)}catch{return raw.trim()}}
function tokens(value:string){return new Set((value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(word=>word.length>2))}
function relatedPeerFinding(clientFinding:Finding,peer:Report){
 if(peer.error||peer.qualityStatus!=="ready")return undefined;
 const clientTokens=tokens([clientFinding.title,clientFinding.description,clientFinding.category,clientFinding.evidence?.map(e=>e.detail||e.element||"").join(" ")].filter(Boolean).join(" "));
 let best:Finding|undefined;let bestScore=0;
 for(const finding of peer.findings){
  const sameCategory=(finding.category||"").toLowerCase()===(clientFinding.category||"").toLowerCase();
  const otherTokens=tokens([finding.title,finding.description,finding.category,finding.evidence?.map(e=>e.detail||e.element||"").join(" ")].filter(Boolean).join(" "));
  let overlap=0;clientTokens.forEach(word=>{if(otherTokens.has(word))overlap++;});
  const score=(sameCategory?2:0)+(overlap/Math.max(1,clientTokens.size));
  if(score>bestScore){bestScore=score;best=finding;}
 }
 return bestScore>=0.18?best:undefined;
}
function focusForFinding(finding:Finding){
 const category=(finding.category||"").toLowerCase();
 if(category.includes("navigation"))return "Inspect label clarity, grouping, current-location states, target size and the relationship between Login and acquisition CTAs.";
 if(category.includes("hierarchy"))return "Inspect how the page establishes one clear headline, primary action, supporting proof and secondary actions without competing for attention.";
 if(category.includes("usability")||category.includes("interaction"))return "Inspect actionable labels, touch/keyboard target size, visible focus, feedback and how clearly each control communicates its next state.";
 if(category.includes("content")||category.includes("tone"))return "Inspect the value proposition, plain-language descriptions, scannability and whether supporting claims are tied to a clear next step.";
 if(category.includes("accessibility"))return "Inspect text contrast, readable type, keyboard focus, semantic labels and control size at zoom.";
 if(category.includes("performance"))return "Inspect whether the primary content appears complete, with clear loading or error states instead of blank areas.";
 return "Inspect spacing, hierarchy, consistency and whether the visible component helps users complete the same task with less effort.";
}
function fixPriorities(report:Report|undefined){
 if(!report||report.error||report.qualityStatus!=="ready")return [];
 return [...report.findings].filter(f=>["high","medium"].includes((f.severity||"").toLowerCase())).sort((a,b)=>(a.severity.toLowerCase()==="high"?0:1)-(b.severity.toLowerCase()==="high"?0:1)).slice(0,5);
}
function recurringCategories(reports:Report[]){const groups=new Map<string,{sites:Set<string>;examples:string[]}>();for(const report of reports){if(report.error||report.qualityStatus!=="ready")continue;for(const finding of report.findings){const category=finding.category||"Uncategorized";const group=groups.get(category)||{sites:new Set<string>(),examples:[]};group.sites.add(report.name);if(group.examples.length<4)group.examples.push(report.name+": "+finding.title);groups.set(category,group);}}return Array.from(groups.entries()).filter(([,group])=>group.sites.size>=2).map(([category,group])=>({category,sites:Array.from(group.sites),examples:group.examples})).sort((a,b)=>b.sites.length-a.sites.length);}

export default function BenchmarkPage(){
 const [connection,setConnection]=useState<{connected:boolean;error?:string}|null>(null);const [clientName,setClientName]=useState("Ujjivan Small Finance Bank");const [clientUrl,setClientUrl]=useState("https://www.ujjivansfb.bank.in/");const [auditMode,setAuditMode]=useState<"desktop"|"mobile">("desktop");const [competitors,setCompetitors]=useState(initial);const [busy,setBusy]=useState(false);const [status,setStatus]=useState("");const [error,setError]=useState("");const [reports,setReports]=useState<Report[]>([]);const [activeReportUrl,setActiveReportUrl]=useState("");const [uploadingReportUrl,setUploadingReportUrl]=useState("");
 useEffect(()=>{let cancelled=false;fetch("/api/openrouter-status",{cache:"no-store"}).then(r=>r.json()).then(d=>{if(!cancelled)setConnection(d)}).catch(()=>{if(!cancelled)setConnection({connected:false,error:"Could not check OpenRouter connection"})});return()=>{cancelled=true}},[]);
 async function analyzeUploadedScreenshot(report:Report,file:File){
  if(uploadingReportUrl)return;
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)){
   setError("Please upload a PNG, JPEG or WebP screenshot of the actual "+report.name+" homepage.");
   return;
  }
  if(file.size>15*1024*1024){
   setError("The screenshot must be smaller than 15 MB. Export a compressed PNG, JPEG or WebP and retry.");
   return;
  }
  setError("");
  setUploadingReportUrl(report.url);
  setStatus("Preparing actual-page screenshot for "+report.name+"…");
  setReports(previous=>previous.map(item=>item.url===report.url?{...item,status:"running",error:undefined,qualityStatus:undefined,qualityWarnings:[],findings:[],screenshot:undefined,screenshotWidth:0,screenshotHeight:0,captureMethod:"manual upload"}:item));
  try{
   const screenshot=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("The selected screenshot could not be read. Try exporting it as PNG or JPEG."));
    reader.onload=()=>typeof reader.result==="string"?resolve(reader.result):reject(new Error("The selected screenshot could not be converted to an image."));
    reader.readAsDataURL(file);
   });
   setStatus("Analyzing the uploaded "+report.name+" homepage with the UX audit pipeline…");
   const response=await fetch("/api/audit-screenshot",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
     url:report.url,
     title:"Homepage",
     projectName:report.name+" · manual screenshot",
     screenshot,
     auditMode:report.mode||auditMode,
     viewport:(report.mode||auditMode)==="mobile"?{width:393,height:852}:{width:1440,height:900}
    })
   });
   if(!response.ok){
    const data=await response.json().catch(()=>({}));
    throw new Error(data.error||"The uploaded screenshot audit request failed.");
   }
   if(!response.body)throw new Error("The screenshot audit stream was unavailable.");
   const reader=response.body.getReader();
   const decoder=new TextDecoder();
   let buffer="";
   let result:any=null;
   let streamError="";
   const processFrame=(frame:string)=>{
    const line=frame.split("\n").find(value=>value.startsWith("data: "));
    if(!line)return;
    try{
     const event=JSON.parse(line.slice(6));
     if(event.type==="stage")setStatus(report.name+": "+(event.stage?.detail||event.stage?.label||"Analyzing screenshot…"));
     else if(event.type==="result")result=event.payload;
     else if(event.type==="error")streamError=typeof event.error==="string"?event.error:"Screenshot analysis failed.";
    }catch{
     // Ignore malformed SSE frames while allowing later result frames to be processed.
    }
   };
   while(true){
    const chunk=await reader.read();
    if(chunk.done)break;
    buffer+=decoder.decode(chunk.value,{stream:true});
    const frames=buffer.split("\n\n");
    buffer=frames.pop()||"";
    for(const frame of frames)processFrame(frame);
   }
   if(buffer.trim())processFrame(buffer);
   if(streamError)throw new Error(streamError);
   if(!result?.page)throw new Error("Screenshot analysis finished without a saved report.");
   const findings:Finding[]=Array.isArray(result.page.findings)?result.page.findings:[];
   const quality=assessReportQuality(findings);
   const completed:Report={
    ...report,
    error:undefined,
    mode:report.mode||auditMode,
    auditId:typeof result.auditId==="string"?result.auditId:undefined,
    findings,
    screenshot:typeof result.page.screenshot==="string"?result.page.screenshot:screenshot,
    screenshotWidth:Number(result.page.screenshotWidth)||0,
    screenshotHeight:Number(result.page.screenshotHeight)||0,
    captureMethod:"manual upload",
    status:quality.qualityStatus==="review"?"review":"complete",
    ...quality
   };
   setReports(previous=>previous.map(item=>item.url===report.url?completed:item));
   setActiveReportUrl(report.url);
   setStatus("Manual screenshot audit finished for "+report.name+": "+findings.length+" finding(s). "+(quality.qualityStatus==="review"?"The result still needs capture-quality review.":"Screenshot analysis and report save completed."));
  }catch(cause){
   const message=cause instanceof Error?cause.message:"Could not analyze the uploaded screenshot.";
   setReports(previous=>previous.map(item=>item.url===report.url?{...item,status:"failed",qualityStatus:"review",qualityWarnings:["Manual screenshot analysis did not complete. Verify that the image shows the actual website homepage."],screenshot:undefined,findings:[],error:message,captureMethod:"manual upload"}:item));
   setError(report.name+": "+message);
   setStatus("Manual screenshot analysis failed for "+report.name+".");
  }finally{
   setUploadingReportUrl("");
  }
 }
 async function run(){
  setError("");setReports([]);setBusy(true);
  try{
   const entries=[{name:clientName.trim()||"Client",url:normalizeUrl(clientUrl)},...competitors.filter(x=>x.url.trim()).map(x=>({name:x.name.trim()||new URL(normalizeUrl(x.url)).hostname,url:normalizeUrl(x.url)}))];
   if(!entries[0].url)throw new Error("Enter the client website URL.");
   if(entries.length<2)throw new Error("Add at least one competitor URL to compare against the client.");
   if(new Set(entries.map(x=>x.url)).size!==entries.length)throw new Error("Each website must have a unique URL.");
   const pendingReports:Report[]=entries.map(entry=>({name:entry.name,url:entry.url,findings:[],mode:auditMode,status:"running"}));
   setStatus("Checking paid vision models…");
   const modelCheck=await fetch("/api/model-health/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",cache:"no-store"});
   const modelData=await modelCheck.json().catch(()=>({}));
   const verifiedModels=Array.isArray(modelData.selectedModels)
    ? modelData.selectedModels.filter((m:any)=>m?.provider==="OpenRouter"&&m?.tier==="paid"&&typeof m.model==="string"&&!m.model.endsWith(":free")&&m.model!=="openrouter/auto").slice(0,2).map((m:any)=>({provider:"OpenRouter",model:m.model,tier:"paid"}))
    : [];
   if(!modelCheck.ok||!verifiedModels.length)throw new Error(modelData.error||"No paid image-capable model was verified. Refresh model health and try again.");
   setReports(pendingReports);setActiveReportUrl(entries[0].url);
   const output:Report[]=new Array(entries.length);let nextIndex=0;
   await Promise.all(Array.from({length:Math.min(2,entries.length)},async()=>{
    while(true){
     const index=nextIndex++;if(index>=entries.length)return;
     const entry=entries[index];setStatus("Auditing "+(index+1)+" of "+entries.length+" ("+auditMode+"): "+entry.name);
     try{
      const response=await fetch("/api/audit-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:entry.url,projectName:entry.name,auditMode,verifiedModels})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Audit request failed.");
      const findings:Finding[]=Array.isArray(data.page?.findings)?data.page.findings:[];const quality=assessReportQuality(findings);output[index]={name:entry.name,url:entry.url,mode:auditMode,auditId:typeof data.auditId==="string"?data.auditId:undefined,findings,screenshot:typeof data.page?.screenshot==="string"?data.page.screenshot:undefined,screenshotWidth:Number(data.page?.screenshotWidth)||0,screenshotHeight:Number(data.page?.screenshotHeight)||0,captureMethod:typeof data.page?.captureMethod==="string"?data.page.captureMethod:undefined,status:quality.qualityStatus==="review"?"review":"complete",...quality};
     }catch(e){output[index]={name:entry.name,url:entry.url,mode:auditMode,findings:[],status:"failed",error:e instanceof Error?e.message:"Audit failed"};}
     setReports(entries.map((entry,i)=>output[i]||pendingReports[i]));
    }
   }));
   const completed=output.filter((item)=>Boolean(item)) as Report[];
   setReports(completed);setActiveReportUrl(completed[0]?.url||entries[0].url);
   if(completed.every(x=>x.error))throw new Error("None of the websites could be audited. Check capture access and OpenRouter configuration.");
   const comparable=completed.filter(x=>!x.error&&x.qualityStatus==="ready").length;const review=completed.filter(x=>!x.error&&x.qualityStatus==="review").length;const failed=completed.filter(x=>Boolean(x.error)).length;
   setStatus("Benchmark finished ("+auditMode+"): "+comparable+" site(s) ready for comparison, "+review+" need capture review, "+failed+" failed. Finding counts are not a quality score.");
  }catch(e){setError(e instanceof Error?e.message:"Could not run benchmark.");}
  finally{setBusy(false);}
 }
 const count=(r:Report,severity:string)=>r.findings.filter(f=>f.severity.toLowerCase()===severity).length;
 const comparableReports=reports.filter(r=>!r.error&&r.qualityStatus==="ready");const recurringThemes=recurringCategories(comparableReports);const clientReport=reports.find(r=>r.url===safeOrigin(clientUrl))||reports[0];const clientPriorities=fixPriorities(clientReport);const activeReport=reports.find(r=>r.url===activeReportUrl)||reports[0];const activeIsClient=Boolean(activeReport&&clientReport&&activeReport.url===clientReport.url);
 return <main className="or-app"><aside className="or-sidebar"><a className="or-brand" href="/"><span className="or-brand-mark">u</span><span>ux<span>audit</span></span></a><div className="or-workspace"><span className="or-avatar">SR</span><span><strong>ScreenRoot workspace</strong><small>UX Intelligence</small></span><span className="or-chevron">⌄</span></div><div className="or-side-label">WORKSPACE</div><a className="or-side-link" href="/"><span>⌂</span> Overview</a><a className="or-side-link" href="/site-map"><span>⌘</span> IA &amp; Audit</a><a className="or-side-link active" href="/benchmark"><span>⇄</span> Competitor benchmark</a><a className="or-side-link" href="/knowledge-base"><span>▤</span> Knowledge base</a><a className="or-side-link" href="/coach"><span>✦</span> Coach &amp; Learn</a><div className="or-sidebar-bottom"><div className="or-help-icon">?</div><div><strong>Evidence-led UX</strong><small>Built for senior review</small></div><span className="or-online-dot"/></div></aside>
 <section className="or-main"><header className="or-topbar"><div className="or-breadcrumb"><a href="/" style={{color:"inherit",textDecoration:"none"}}>Workspace</a><span>/</span><strong>Competitor benchmark</strong></div><div className="or-top-actions"><span className={"or-connection "+(connection?.connected?"is-connected":connection?"is-error":"")}><i/>{connection?.connected?"OpenRouter connected":connection?"OpenRouter unavailable":"Connecting to OpenRouter"}</span><span className="or-user-avatar">Z</span></div></header><div className="or-content"><PageHeading eyebrow="COMPETITIVE UX INTELLIGENCE" title="Benchmark the experience." description="Compare the same homepage-level audit workflow across your client and up to three competitors." actions={<a className="or-text-link" href="/">← Back to overview</a>} />
 <section className="or-start-card"><div className="or-start-card-top"><div className="or-step-icon">⇄</div><div><h2>Set up a benchmark</h2><p>Name the client and competitor websites. The benchmark audits every selected homepage at the same viewport. Two sites run concurrently; successful audits are saved to Past Findings.</p></div><span className="or-pill">Up to 4 websites</span></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",margin:"14px 0"}}><strong style={{fontSize:13,color:"#343946",marginRight:4}}>Compare viewport</strong><button type="button" aria-pressed={auditMode==="desktop"} onClick={()=>setAuditMode("desktop")} style={{border:"1px solid "+(auditMode==="desktop"?"#71833c":"#e1e4eb"),background:auditMode==="desktop"?"#eef4d8":"#fff",color:"#242833",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Desktop · 1440 px</button><button type="button" aria-pressed={auditMode==="mobile"} onClick={()=>setAuditMode("mobile")} style={{border:"1px solid "+(auditMode==="mobile"?"#71833c":"#e1e4eb"),background:auditMode==="mobile"?"#eef4d8":"#fff",color:"#242833",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Mobile · 393 × 852 px</button><span style={{fontSize:12,color:"#737987"}}>Audit all selected sites at the same viewport.</span></div><div className="bm-form-grid"><label>Client / project name<input value={clientName} onChange={e=>setClientName(e.target.value)} style={inputStyle}/></label><label>Client homepage URL<input value={clientUrl} onChange={e=>setClientUrl(e.target.value)} placeholder="https://client.com" style={inputStyle}/></label></div><div className="bm-competitor-heading"><div><h3>Competitors</h3><p>Enter only the competitors you want to include.</p></div><span className="or-muted-chip">{competitors.filter(x=>x.url.trim()).length} of 3 added</span></div><div className="bm-competitor-grid">{competitors.map((item,i)=><article className="bm-competitor" key={i}><div className="bm-competitor-index"><span>0{i+1}</span> COMPETITOR</div><label>Brand / institution name<input value={item.name} onChange={e=>setCompetitors(prev=>prev.map((x,j)=>j===i?{...x,name:e.target.value}:x))} style={inputStyle}/></label><label>Homepage URL<input value={item.url} onChange={e=>setCompetitors(prev=>prev.map((x,j)=>j===i?{...x,url:e.target.value}:x))} placeholder="https://competitor.com" style={inputStyle}/></label></article>)}</div><div className="bm-run-row"><button className="bm-run-button" disabled={busy} onClick={run}>{busy?<><span className="or-button-spinner"/> Benchmark running…</>:"Run benchmark"} <span>→</span></button><p>Viewport: {auditMode}. Each site triggers screenshot capture and OpenRouter analysis. Model usage may incur cost.</p></div>{status&&<div className="bm-status" role="status"><i/>{status}</div>}{error&&<div className="bm-error" role="alert">{error}</div>}</section>
 {reports.length>0&&<section className="bm-results">
 <div className="or-section-heading"><div><h2>Benchmark workspace</h2><p>Switch between Ujjivan and each peer. Inspect the captured page alongside its findings and Ujjivan-specific action plan.</p></div><span className="or-muted-chip">{reports.filter(r=>r.status!=="running").length} of {reports.length} processed</span></div>
 <div className="bm-site-tabs" role="tablist" aria-label="Benchmark websites">
  {reports.map((r,i)=>{const active=(activeReport?.url||activeReportUrl)===r.url;const label=r.error||r.status==="failed"?"Capture failed":r.status==="running"?"Auditing…":r.qualityStatus==="review"?"Review required":r.status==="review"?"Review required":"Ready";return <button type="button" role="tab" aria-selected={active} aria-controls="bm-active-site-panel" key={r.url} className={"bm-site-tab"+(active?" active":"") } onClick={()=>setActiveReportUrl(r.url)}>
   <span className={"bm-site-tab-role"+(i===0?" client":"")}>{i===0?"UJJIVAN BASELINE":"COMPETITOR "+i}</span><strong>{r.name}</strong><span className={"bm-site-tab-state "+(r.error||r.status==="failed"?"failed":r.status==="running"?"running":r.qualityStatus==="review"||r.status==="review"?"review":"ready")}>{label}</span>
  </button>})}
 </div>
 {activeReport&&<div className="bm-benchmark-workspace" role="tabpanel" id="bm-active-site-panel">
  <section className="bm-screenshot-panel">
   <div className="bm-screenshot-heading">
    <div><span className="bm-panel-eyebrow">{activeIsClient?"CLIENT BASELINE":"COMPETITOR REFERENCE"}</span><h3>{activeReport.name}</h3><p>{activeReport.mode==="mobile"?"Mobile · 393 × 852 CSS px":"Desktop · 1440 px"} · Full-page capture {activeReport.screenshotWidth&&activeReport.screenshotHeight?"· "+activeReport.screenshotWidth+" × "+activeReport.screenshotHeight+" px":""}</p></div>
    <a className="bm-open-site" href={activeReport.url} target="_blank" rel="noreferrer">Open live site ↗</a>
   </div>
   {activeReport.screenshot?<iframe className="bm-screenshot-iframe" title={"Scrollable screenshot of "+activeReport.name} srcDoc={screenshotDocument(activeReport.screenshot)} sandbox="" loading="lazy"/>:
    <>
     <iframe className="bm-screenshot-iframe bm-live-fallback" title={"Live website frame for "+activeReport.name} src={activeReport.url} sandbox="allow-forms allow-scripts allow-same-origin allow-popups" referrerPolicy="strict-origin-when-cross-origin" loading="lazy"/>
     <div className={"bm-no-capture "+(activeReport.error||activeReport.status==="failed"?"failed":"")}>
      <strong>{activeReport.error||activeReport.status==="failed"?"Screenshot capture unavailable":activeReport.status==="running"?"Capturing and auditing this website…":"No screenshot was included in the audit response."}</strong>
      <p>{activeReport.error||activeReport.qualityWarnings?.join(" ")||"This page does not have a usable screenshot preview. Do not draw a visual benchmark conclusion from this report."} A live embed may also be blocked by the bank’s frame policy.</p>
      <a href={activeReport.url} target="_blank" rel="noreferrer">Open the site directly ↗</a>
      <label className="bm-upload-fallback">
       <span>{uploadingReportUrl===activeReport.url?"Analyzing uploaded screenshot…":"Upload actual homepage screenshot"}</span>
       <small>PNG, JPEG or WebP · maximum 15 MB</small>
       <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||Boolean(uploadingReportUrl)} onChange={event=>{const selectedFile=event.currentTarget.files?.[0];event.currentTarget.value="";if(selectedFile)void analyzeUploadedScreenshot(activeReport,selectedFile);}}/>
      </label>
      <p className="bm-upload-help">Open the official site in your normal browser, capture the real homepage at the selected viewport, then upload it here. Do not upload an access-denied or verification screen.</p>
     </div>
    </>}
   <div className="bm-iframe-footnote">The iframe shows the actual screenshot used for the audit, in a scrollable frame. Use “Open live site” to inspect interactive behaviour; some banking websites block live embedding.</div>
  </section>
  <aside className="bm-benchmark-panel">
   <div className="bm-panel-header"><div><span className="bm-panel-eyebrow">{activeIsClient?"BASELINE FINDINGS":"BENCHMARK READOUT"}</span><h3>{activeIsClient?"Ujjivan audit priorities":"What this peer can teach us"}</h3></div><span className={"bm-quality-pill "+(activeReport.error||activeReport.status==="failed"?"failed":activeReport.qualityStatus==="review"||activeReport.status==="review"?"review":"ready")}>{activeReport.error||activeReport.status==="failed"?"FAILED":activeReport.qualityStatus==="review"||activeReport.status==="review"?"REVIEW REQUIRED":activeReport.status==="running"?"RUNNING":"READY"}</span></div>
   {activeReport.qualityWarnings?.map((warning,j)=><div className="bm-quality-warning" key={j}>{warning}</div>)}
   {activeReport.error&&<div className="bm-report-error">{activeReport.error}</div>}
   {activeReport.status==="running"&&!activeReport.error&&<div className="bm-report-pending">This website is being audited. Its report will populate here when capture and analysis finish.</div>}
   {!activeReport.error&&activeReport.status!=="running"&&<>
    <div className="bm-metric-strip">
     <div><span>High</span><strong>{activeReport.findings.filter(f=>f.severity.toLowerCase()==="high").length}</strong></div>
     <div><span>Medium</span><strong>{activeReport.findings.filter(f=>f.severity.toLowerCase()==="medium").length}</strong></div>
     <div><span>Low</span><strong>{activeReport.findings.filter(f=>f.severity.toLowerCase()==="low").length}</strong></div>
    </div>
    {activeReport.qualityStatus==="review"&&<div className="bm-quality-warning">This capture is not approved as a reliable design reference. Inspect it manually or rerun before using it to support a decision.</div>}
    {activeIsClient?<>
     <section className="bm-panel-section"><h4>Ujjivan issues to resolve</h4><p className="bm-panel-help">Prioritized from Ujjivan’s own screenshot evidence. These actions remain the source of truth for the remediation plan.</p>
      {activeReport.findings.slice(0,6).map((f,i)=><article className="bm-plan-card" key={f.title+"-"+i}><div className="bm-finding-meta"><span className={"bm-severity-label "+f.severity.toLowerCase()}>{f.severity}</span><span>{f.category}</span></div><strong>{f.title}</strong><p>{f.recommendation}</p><small>Reference checklist: {focusForFinding(f)}</small></article>)}
     </section>
    </>:<>
     <section className="bm-panel-section"><h4>Peer audit signals</h4><p className="bm-panel-help">These are issues found on this competitor, not strengths to copy. Use the screenshot to inspect other visible patterns; a missing finding does not prove superiority.</p>
      {activeReport.findings.length?activeReport.findings.slice(0,4).map((f,i)=><article className="bm-peer-card" key={f.title+"-"+i}><div className="bm-finding-meta"><span className={"bm-severity-label "+f.severity.toLowerCase()}>{f.severity}</span><span>{f.category}</span></div><strong>{f.title}</strong><p>{f.description||f.recommendation}</p>{f.evidence?.[0]?.element&&<small><b>Evidence:</b> {f.evidence[0].element}{f.evidence[0].detail?" — "+f.evidence[0].detail:""}</small>}</article>):<p className="bm-panel-empty">No structured findings are available. Do not treat the absence of findings as proof this competitor is better.</p>}
     </section>
     <section className="bm-panel-section bm-client-plan"><h4>How to incorporate learning into Ujjivan</h4><p className="bm-panel-help">Matched against Ujjivan’s own audit findings. Recommendations below resolve Ujjivan issues; peer findings are used as context, not as a quality score.</p>
      {clientPriorities.length?clientPriorities.map((f,i)=>{const peer=relatedPeerFinding(f,activeReport);return <article className="bm-plan-card" key={f.title+"-"+i}>
       <div className="bm-finding-meta"><span className={"bm-severity-label "+f.severity.toLowerCase()}>{f.severity}</span><span>Ujjivan · {f.category}</span></div>
       <strong>{f.title}</strong>
       <p className="bm-plan-label">Implementation for Ujjivan</p><p>{f.recommendation}</p>
       <div className="bm-benchmark-lens"><b>What to inspect in {activeReport.name}</b><p>{focusForFinding(f)}</p>
        {peer?<p className="bm-peer-match"><b>Related peer signal:</b> {peer.title} This is a caution to validate, not a component to copy.</p>:<p className="bm-peer-match">No directly related issue was flagged in this peer’s audit. Inspect the screenshot for a suitable pattern; absence of a finding is not evidence that the design is better.</p>}
       </div>
      </article>}) : <p className="bm-panel-empty">Ujjivan’s baseline report is still running or needs capture review. A reliable Ujjivan-specific action plan will appear when that report is ready.</p>}
     </section>
    </>}
   </>}
   <p className="bm-method-note">Method: compare visible evidence and specific findings, not raw finding counts. Confirm any pattern in the screenshot before adopting it, then validate the Ujjivan change with accessibility checks and user/task metrics.</p>
  </aside>
 </div>}
 <div className="bm-caveat"><strong>Interpretation note</strong><p>Ujjivan is the baseline. Competitor tabs are reference material, not a ranking. Access-blocked or incomplete captures remain visible for diagnosis but should not inform design decisions until reviewed.</p></div>
</section>}</div><footer className="or-footer"><span>UX Audit <span>·</span> Evidence first, recommendations second.</span><div><a href="/knowledge-base">Knowledge base</a><a href="/site-map">IA &amp; Audit</a></div></footer></section></main>;
}
