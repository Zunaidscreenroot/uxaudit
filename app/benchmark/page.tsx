"use client";
import { useEffect, useState } from "react";
import { PageHeading } from "../ui";
type Finding={severity:string;category:string;title:string;recommendation:string;description?:string;evidence?:Array<{detail?:string;element?:string;}>;};
type BenchmarkPattern={title:string;observedPattern:string;screenshotEvidence:string;userBenefitHypothesis:string;ujjivanAdaptation:string;targetArea:string;priority:"High"|"Medium"|"Explore";effort:"Low"|"Medium"|"High";validation:string;tradeoffs:string;};
type BenchmarkInsights={captureValid:boolean;captureReason:string;summary:string;patterns:BenchmarkPattern[];watchouts:string[];};
type VerifiedModel={provider:"OpenRouter";model:string;tier:"paid";};
type Report={name:string;url:string;findings:Finding[];error?:string;mode?:"desktop"|"mobile";auditId?:string;qualityStatus?:"ready"|"review";qualityWarnings?:string[];screenshot?:string;screenshotWidth?:number;screenshotHeight?:number;captureMethod?:string;status?:"running"|"complete"|"review"|"failed";benchmarkInsights?:BenchmarkInsights;benchmarkStatus?:"pending"|"complete"|"review"|"failed";benchmarkError?:string;};
const initial=[{name:"AU Small Finance Bank",url:"https://www.au.bank.in/"},{name:"Equitas Small Finance Bank",url:"https://equitas.bank.in/"},{name:"Suryoday Small Finance Bank",url:"https://suryoday.bank.in/"}];
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
   const baselineUrl=safeOrigin(clientUrl);
   const baseline=report.url===baselineUrl?completed:reports.find(item=>item.url===baselineUrl);
   if(report.url!==baselineUrl&&baseline?.screenshot&&!baseline.error){
    setStatus("Screenshot audit saved. Comparing "+report.name+" with Ujjivan to extract transferable patterns…");
    try{
     const models=await loadVerifiedModels();
     const insights=await createBenchmarkInsights(completed,baseline,models);
     const enriched=applyBenchmarkInsights(completed,insights);
     setReports(previous=>previous.map(item=>item.url===report.url?enriched:item));
     setStatus(insights.captureValid?report.name+": screenshot verified; "+insights.patterns.length+" potential pattern(s) mapped to Ujjivan.":report.name+" screenshot still needs review: "+insights.captureReason);
    }catch(insightError){
     const insightMessage=insightError instanceof Error?insightError.message:"Pattern extraction failed.";
     setReports(previous=>previous.map(item=>item.url===report.url?{...completed,benchmarkStatus:"failed",benchmarkError:insightMessage}:item));
     setStatus("Screenshot audit saved, but pattern extraction failed for "+report.name+".");
    }
   }else{
    setStatus("Manual screenshot audit finished for "+report.name+": "+findings.length+" finding(s) saved. "+(report.url===baselineUrl?"Baseline refreshed. Run the benchmark again to compare peers against this baseline.":quality.qualityStatus==="review"?"The result still needs capture-quality review.":"Screenshot analysis and report save completed."));
   }
  }catch(cause){
   const message=cause instanceof Error?cause.message:"Could not analyze the uploaded screenshot.";
   setReports(previous=>previous.map(item=>item.url===report.url?{...item,status:"failed",qualityStatus:"review",qualityWarnings:["Manual screenshot analysis did not complete. Verify that the image shows the actual website homepage."],screenshot:undefined,findings:[],error:message,captureMethod:"manual upload"}:item));
   setError(report.name+": "+message);
   setStatus("Manual screenshot analysis failed for "+report.name+".");
  }finally{
   setUploadingReportUrl("");
  }
 }

 async function loadVerifiedModels():Promise<VerifiedModel[]>{
  const response=await fetch("/api/model-health/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}",cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  const models:VerifiedModel[]=Array.isArray(data.selectedModels)?data.selectedModels.filter((m:any)=>m?.provider==="OpenRouter"&&m?.tier==="paid"&&typeof m.model==="string"&&!m.model.endsWith(":free")&&m.model!=="openrouter/auto").slice(0,2).map((m:any)=>({provider:"OpenRouter",model:m.model,tier:"paid"})):[];
  if(!response.ok||!models.length)throw new Error(data.error||"No verified paid vision model is available for benchmark analysis.");
  return models;
 }
 async function prepareScreenshotForAnalysis(dataUrl:string):Promise<string>{
  if(dataUrl.length<5*1024*1024)return dataUrl;
  return new Promise((resolve,reject)=>{
   const image=new Image();
   image.onerror=()=>reject(new Error("Could not prepare screenshot for side-by-side pattern analysis."));
   image.onload=()=>{
    try{
     const scale=Math.min(1,1440/image.naturalWidth,8000/image.naturalHeight);
     const canvas=document.createElement("canvas");
     canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
     canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
     const context=canvas.getContext("2d");
     if(!context)throw new Error("Browser image compression is unavailable.");
     context.drawImage(image,0,0,canvas.width,canvas.height);
     resolve(canvas.toDataURL("image/jpeg",0.78));
    }catch(error){reject(error);}
   };
   image.src=dataUrl;
  });
 }
 async function createBenchmarkInsights(peer:Report,baseline:Report,models:VerifiedModel[]):Promise<BenchmarkInsights>{
  if(!baseline.screenshot||!peer.screenshot)throw new Error("Both Ujjivan and competitor screenshots are required for pattern benchmarking.");
  const [baselineScreenshot,competitorScreenshot]=await Promise.all([prepareScreenshotForAnalysis(baseline.screenshot),prepareScreenshotForAnalysis(peer.screenshot)]);
  const response=await fetch("/api/benchmark-insights",{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({
    baselineName:baseline.name,
    competitorName:peer.name,
    competitorUrl:peer.url,
    baselineScreenshot,
    competitorScreenshot,
    baselineFindings:baseline.findings.slice(0,8).map(f=>({category:f.category,title:f.title,evidence:f.evidence?.map(e=>[e.element,e.detail].filter(Boolean).join(": ")).filter(Boolean).join("; ")||f.description||"",recommendation:f.recommendation})),
    verifiedModels:models
   })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Competitor pattern extraction failed.");
  if(typeof data.captureValid!=="boolean"||!Array.isArray(data.patterns))throw new Error("Pattern extraction returned an incomplete result.");
  return data as BenchmarkInsights;
 }
 function applyBenchmarkInsights(report:Report,insights:BenchmarkInsights):Report{
  if(!insights.captureValid){
   const warnings=[...(report.qualityWarnings||[]),insights.captureReason].filter((item,index,all)=>item&&all.indexOf(item)===index);
   return {...report,qualityStatus:"review",qualityWarnings:warnings,benchmarkInsights:insights,benchmarkStatus:"review",benchmarkError:undefined,status:"review"};
  }
  return {...report,qualityStatus:"ready",qualityWarnings:[],benchmarkInsights:insights,benchmarkStatus:insights.patterns.length?"complete":"review",benchmarkError:undefined,status:"complete"};
 }
 async function retryBenchmarkInsights(peer:Report){
  const baseline=reports.find(r=>r.url===safeOrigin(clientUrl))||reports[0];
  if(!baseline?.screenshot||baseline.error){setError("Ujjivan's baseline screenshot is required before extracting competitor patterns.");return;}
  setError("");
  setStatus("Comparing "+peer.name+" with Ujjivan and extracting useful patterns…");
  setReports(previous=>previous.map(r=>r.url===peer.url?{...r,benchmarkStatus:"pending",benchmarkError:undefined}:r));
  try{
   const models=await loadVerifiedModels();
   const insights=await createBenchmarkInsights(peer,baseline,models);
   const updated=applyBenchmarkInsights(peer,insights);
   setReports(previous=>previous.map(r=>r.url===peer.url?updated:r));
   setStatus(insights.captureValid?peer.name+": "+insights.patterns.length+" potential pattern(s) mapped to Ujjivan. Validate them before design adoption.":peer.name+" screenshot needs review: "+insights.captureReason);
  }catch(error){
   const message=error instanceof Error?error.message:"Could not extract benchmark patterns.";
   setReports(previous=>previous.map(r=>r.url===peer.url?{...r,benchmarkStatus:"failed",benchmarkError:message}:r));
   setError(peer.name+": "+message);
   setStatus("Pattern extraction failed. The audit report is still available as secondary context.");
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
   const verifiedModels=await loadVerifiedModels();
   setReports(pendingReports);setActiveReportUrl(entries[0].url);
   const output:Report[]=new Array(entries.length);
   const baselineEntry=entries[0];
   setStatus("Auditing Ujjivan baseline for revamp context…");
   try{
    const baselineResponse=await fetch("/api/audit-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:baselineEntry.url,projectName:baselineEntry.name,auditMode,verifiedModels})});
    const baselineData=await baselineResponse.json().catch(()=>({}));
    if(!baselineResponse.ok)throw new Error(baselineData.error||"Ujjivan baseline audit failed.");
    const baselineFindings:Finding[]=Array.isArray(baselineData.page?.findings)?baselineData.page.findings:[];
    const baselineQuality=assessReportQuality(baselineFindings);
    output[0]={name:baselineEntry.name,url:baselineEntry.url,mode:auditMode,auditId:typeof baselineData.auditId==="string"?baselineData.auditId:undefined,findings:baselineFindings,screenshot:typeof baselineData.page?.screenshot==="string"?baselineData.page.screenshot:undefined,screenshotWidth:Number(baselineData.page?.screenshotWidth)||0,screenshotHeight:Number(baselineData.page?.screenshotHeight)||0,captureMethod:typeof baselineData.page?.captureMethod==="string"?baselineData.page.captureMethod:undefined,status:baselineQuality.qualityStatus==="review"?"review":"complete",...baselineQuality};
   }catch(cause){
    output[0]={name:baselineEntry.name,url:baselineEntry.url,mode:auditMode,findings:[],status:"failed",error:cause instanceof Error?cause.message:"Ujjivan baseline audit failed."};
   }
   setReports(entries.map((entry,i)=>output[i]||pendingReports[i]));
   let nextIndex=1;
   await Promise.all(Array.from({length:Math.min(2,Math.max(0,entries.length-1))},async()=>{
    while(true){
     const index=nextIndex++;if(index>=entries.length)return;
     const entry=entries[index];
     setStatus("Capturing competitor evidence ("+index+" of "+(entries.length-1)+"): "+entry.name+"…");
     try{
      const response=await fetch("/api/benchmark-capture",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:entry.url,auditMode})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||"Competitor screenshot capture failed.");
      if(typeof data.screenshot!=="string")throw new Error("Competitor capture returned no usable screenshot.");
      output[index]={name:entry.name,url:entry.url,mode:auditMode,findings:[],screenshot:data.screenshot,screenshotWidth:Number(data.screenshotWidth)||0,screenshotHeight:Number(data.screenshotHeight)||0,captureMethod:typeof data.captureMethod==="string"?data.captureMethod:undefined,status:"complete",qualityStatus:"review",qualityWarnings:["Competitor screenshot is awaiting visual verification against the real homepage."],benchmarkStatus:"pending"};
     }catch(cause){
      output[index]={name:entry.name,url:entry.url,mode:auditMode,findings:[],status:"failed",qualityStatus:"review",qualityWarnings:["No verified competitor screenshot is available."],error:cause instanceof Error?cause.message:"Competitor screenshot capture failed.",benchmarkStatus:"failed",benchmarkError:"Pattern analysis cannot run without a competitor screenshot."};
     }
     setReports(entries.map((item,i)=>output[i]||pendingReports[i]));
    }
   }));
   let completed=output.filter((item)=>Boolean(item)) as Report[];
   setReports(completed);setActiveReportUrl(completed[0]?.url||entries[0].url);
   const baseline=completed[0];
   const insightIndexes=completed.map((report,index)=>({report,index})).filter(item=>item.index>0&&!item.report.error&&Boolean(item.report.screenshot)).map(item=>item.index);
   if(baseline?.screenshot&&!baseline.error&&insightIndexes.length){
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(2,insightIndexes.length)},async()=>{
     while(true){
      const slot=cursor++;if(slot>=insightIndexes.length)return;
      const index=insightIndexes[slot];const peer=output[index];
      setStatus("Comparing "+peer.name+" with Ujjivan to extract patterns for the revamp…");
      try{
       const insights=await createBenchmarkInsights(peer,baseline,verifiedModels);
       output[index]=applyBenchmarkInsights(peer,insights);
      }catch(cause){
       output[index]={...peer,benchmarkStatus:"failed",benchmarkError:cause instanceof Error?cause.message:"Pattern extraction failed."};
      }
      setReports(output.filter(Boolean) as Report[]);
     }
    }));
   }else if(insightIndexes.length){
    for(const index of insightIndexes)output[index]={...output[index],benchmarkStatus:"failed",benchmarkError:"Ujjivan's baseline screenshot is unavailable, so competitor patterns cannot be compared reliably."};
   }
   completed=output.filter((item)=>Boolean(item)) as Report[];
   setReports(completed);
   const readyPatterns=completed.slice(1).filter(x=>x.benchmarkStatus==="complete"&&x.benchmarkInsights?.captureValid).length;
   const reviewPatterns=completed.slice(1).filter(x=>x.benchmarkStatus==="review"||x.benchmarkStatus==="failed").length;
   const failedCaptures=completed.slice(1).filter(x=>Boolean(x.error)).length;
   setStatus("Benchmark finished: Ujjivan baseline "+(baseline?.error?"needs attention":"ready")+"; "+readyPatterns+" competitor(s) produced screenshot-verified patterns for the revamp; "+reviewPatterns+" need capture/analysis review; "+failedCaptures+" competitor capture(s) failed. Peer issue audits were not run.");
  }catch(e){setError(e instanceof Error?e.message:"Could not run benchmark.");}
  finally{setBusy(false);}
 }
 const count=(r:Report,severity:string)=>r.findings.filter(f=>f.severity.toLowerCase()===severity).length;
 const comparableReports=reports.filter(r=>!r.error&&r.qualityStatus==="ready");const recurringThemes=recurringCategories(comparableReports);const clientReport=reports.find(r=>r.url===safeOrigin(clientUrl))||reports[0];const clientPriorities=fixPriorities(clientReport);const activeReport=reports.find(r=>r.url===activeReportUrl)||reports[0];const activeIsClient=Boolean(activeReport&&clientReport&&activeReport.url===clientReport.url);
 return <main className="or-app"><aside className="or-sidebar"><a className="or-brand" href="/"><span className="or-brand-mark">u</span><span>ux<span>audit</span></span></a><div className="or-workspace"><span className="or-avatar">SR</span><span><strong>ScreenRoot workspace</strong><small>UX Intelligence</small></span><span className="or-chevron">⌄</span></div><div className="or-side-label">WORKSPACE</div><a className="or-side-link" href="/"><span>⌂</span> Overview</a><a className="or-side-link" href="/site-map"><span>⌘</span> IA &amp; Audit</a><a className="or-side-link active" href="/benchmark"><span>⇄</span> Competitor benchmark</a><a className="or-side-link" href="/knowledge-base"><span>▤</span> Knowledge base</a><a className="or-side-link" href="/coach"><span>✦</span> Coach &amp; Learn</a><div className="or-sidebar-bottom"><div className="or-help-icon">?</div><div><strong>Evidence-led UX</strong><small>Built for senior review</small></div><span className="or-online-dot"/></div></aside>
 <section className="or-main"><header className="or-topbar"><div className="or-breadcrumb"><a href="/" style={{color:"inherit",textDecoration:"none"}}>Workspace</a><span>/</span><strong>Competitor benchmark</strong></div><div className="or-top-actions"><span className={"or-connection "+(connection?.connected?"is-connected":connection?"is-error":"")}><i/>{connection?.connected?"OpenRouter connected":connection?"OpenRouter unavailable":"Connecting to OpenRouter"}</span><span className="or-user-avatar">Z</span></div></header><div className="or-content"><PageHeading eyebrow="COMPETITIVE UX INTELLIGENCE" title="Learn from the market." description="Find competitor experience patterns worth adapting, then turn them into evidence-led recommendations for the Ujjivan revamp. Audit issues are secondary context." actions={<a className="or-text-link" href="/">← Back to overview</a>} />
 <section className="or-start-card"><div className="or-start-card-top"><div className="or-step-icon">⇄</div><div><h2>Set up a revamp benchmark</h2><p>Capture Ujjivan and up to three competitor homepages at the same viewport. The primary output is screenshot-grounded design patterns and how to adapt them to Ujjivan. Competitor audit findings are secondary.</p></div><span className="or-pill">Up to 4 websites</span></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",margin:"14px 0"}}><strong style={{fontSize:13,color:"#343946",marginRight:4}}>Compare viewport</strong><button type="button" aria-pressed={auditMode==="desktop"} onClick={()=>setAuditMode("desktop")} style={{border:"1px solid "+(auditMode==="desktop"?"#71833c":"#e1e4eb"),background:auditMode==="desktop"?"#eef4d8":"#fff",color:"#242833",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Desktop · 1440 px</button><button type="button" aria-pressed={auditMode==="mobile"} onClick={()=>setAuditMode("mobile")} style={{border:"1px solid "+(auditMode==="mobile"?"#71833c":"#e1e4eb"),background:auditMode==="mobile"?"#eef4d8":"#fff",color:"#242833",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Mobile · 393 × 852 px</button><span style={{fontSize:12,color:"#737987"}}>Audit all selected sites at the same viewport.</span></div><div className="bm-form-grid"><label>Client / project name<input value={clientName} onChange={e=>setClientName(e.target.value)} style={inputStyle}/></label><label>Client homepage URL<input value={clientUrl} onChange={e=>setClientUrl(e.target.value)} placeholder="https://client.com" style={inputStyle}/></label></div><div className="bm-competitor-heading"><div><h3>Competitors</h3><p>Enter only the competitors you want to include.</p></div><span className="or-muted-chip">{competitors.filter(x=>x.url.trim()).length} of 3 added</span></div><div className="bm-competitor-grid">{competitors.map((item,i)=><article className="bm-competitor" key={i}><div className="bm-competitor-index"><span>0{i+1}</span> COMPETITOR</div><label>Brand / institution name<input value={item.name} onChange={e=>setCompetitors(prev=>prev.map((x,j)=>j===i?{...x,name:e.target.value}:x))} style={inputStyle}/></label><label>Homepage URL<input value={item.url} onChange={e=>setCompetitors(prev=>prev.map((x,j)=>j===i?{...x,url:e.target.value}:x))} placeholder="https://competitor.com" style={inputStyle}/></label></article>)}</div><div className="bm-run-row"><button className="bm-run-button" disabled={busy} onClick={run}>{busy?<><span className="or-button-spinner"/> Benchmark running…</>:"Run benchmark"} <span>→</span></button><p>Viewport: {auditMode}. The benchmark compares actual screenshots and generates Ujjivan-specific design opportunities. Paid model usage may incur cost.</p></div>{status&&<div className="bm-status" role="status"><i/>{status}</div>}{error&&<div className="bm-error" role="alert">{error}</div>}</section>
 {reports.length>0&&<section className="bm-results">
 <div className="or-section-heading"><div><h2>Benchmark workspace</h2><p>Study each competitor’s visible patterns, see why they may help customers, and review exactly how to adapt them to Ujjivan. Issue lists are secondary.</p></div><span className="or-muted-chip">{reports.filter(r=>r.status!=="running").length} of {reports.length} processed</span></div>
 <div className="bm-site-tabs" role="tablist" aria-label="Benchmark websites">
  {reports.map((r,i)=>{const active=(activeReport?.url||activeReportUrl)===r.url;const label=r.error||r.status==="failed"?"Capture failed":r.status==="running"?"Auditing…":r.qualityStatus==="review"?"Review required":r.status==="review"?"Review required":"Ready";return <button type="button" role="tab" aria-selected={active} aria-controls="bm-active-site-panel" key={r.url} className={"bm-site-tab"+(active?" active":"") } onClick={()=>setActiveReportUrl(r.url)}>
   <span className={"bm-site-tab-role"+(i===0?" client":"")}>{i===0?"UJJIVAN BASELINE":"COMPETITOR "+i}</span><strong>{r.name}</strong><span className={"bm-site-tab-state "+(r.error||r.status==="failed"?"failed":r.status==="running"||r.benchmarkStatus==="pending"?"running":r.benchmarkStatus==="complete"?"ready":r.qualityStatus==="review"||r.status==="review"||r.benchmarkStatus==="review"||r.benchmarkStatus==="failed"?"review":"ready")}>{r.benchmarkStatus==="pending"?"Learning patterns…":r.benchmarkStatus==="complete"?"Patterns ready":label}</span>
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
   <div className="bm-panel-header"><div><span className="bm-panel-eyebrow">{activeIsClient?"UJJIVAN BASELINE":"UJJIVAN REVAMP BENCHMARK"}</span><h3>{activeIsClient?"Ujjivan needs and opportunities":"Patterns to adapt—not a competitor score"}</h3></div><span className={"bm-quality-pill "+(activeReport.error||activeReport.status==="failed"||activeReport.benchmarkStatus==="failed"?"failed":activeReport.benchmarkStatus==="pending"?"running":activeReport.benchmarkStatus==="review"||activeReport.qualityStatus==="review"||activeReport.status==="review"?"review":"ready")}>{activeReport.error||activeReport.status==="failed"?"CAPTURE FAILED":activeReport.benchmarkStatus==="pending"?"EXTRACTING PATTERNS":activeReport.benchmarkStatus==="complete"?"PATTERNS READY":activeReport.benchmarkStatus==="review"?"VERIFY EVIDENCE":activeReport.benchmarkStatus==="failed"?"ANALYSIS FAILED":activeReport.qualityStatus==="review"||activeReport.status==="review"?"REVIEW REQUIRED":activeReport.status==="running"?"CAPTURING":"READY"}</span></div>
   {activeReport.qualityWarnings?.map((warning,j)=><div className="bm-quality-warning" key={j}>{warning}</div>)}
   {activeReport.screenshot&&activeReport.qualityStatus==="review"&&<label className="bm-upload-fallback bm-replace-screenshot"><span>Replace questionable screenshot</span><small>Upload a verified capture of the actual homepage to rerun this bank’s audit.</small><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||Boolean(uploadingReportUrl)} onChange={event=>{const selectedFile=event.currentTarget.files?.[0];event.currentTarget.value="";if(selectedFile)void analyzeUploadedScreenshot(activeReport,selectedFile);}}/></label>}
   {activeReport.error&&<div className="bm-report-error">{activeReport.error}</div>}
   {activeReport.status==="running"&&!activeReport.error&&<div className="bm-report-pending">This website is being audited. Its report will populate here when capture and analysis finish.</div>}
   {!activeReport.error&&activeReport.status!=="running"&&<>
    {activeIsClient&&<div className="bm-metric-strip">
     <div><span>High</span><strong>{activeReport.findings.filter(f=>f.severity.toLowerCase()==="high").length}</strong></div>
     <div><span>Medium</span><strong>{activeReport.findings.filter(f=>f.severity.toLowerCase()==="medium").length}</strong></div>
     <div><span>Low</span><strong>{activeReport.findings.filter(f=>f.severity.toLowerCase()==="low").length}</strong></div>
    </div>}
    {activeReport.qualityStatus==="review"&&<div className="bm-quality-warning">This capture is not approved as a reliable design reference. Inspect it manually or rerun before using it to support a decision.</div>}
    {activeIsClient?<>
     <section className="bm-panel-section"><h4>Ujjivan issues to resolve</h4><p className="bm-panel-help">Prioritized from Ujjivan’s own screenshot evidence. These actions remain the source of truth for the remediation plan.</p>
      {activeReport.findings.slice(0,6).map((f,i)=><article className="bm-plan-card" key={f.title+"-"+i}><div className="bm-finding-meta"><span className={"bm-severity-label "+f.severity.toLowerCase()}>{f.severity}</span><span>{f.category}</span></div><strong>{f.title}</strong><p>{f.recommendation}</p><small>Reference checklist: {focusForFinding(f)}</small></article>)}
     </section>
    </>:<>
     <section className="bm-panel-section">
      <h4>Patterns worth considering for Ujjivan</h4>
      <p className="bm-panel-help">Primary benchmark output: what this bank visibly does, why the pattern may help customers, and how Ujjivan could adapt it. These are design hypotheses to validate—not patterns to copy blindly.</p>
      {activeReport.benchmarkStatus==="pending"&&<div className="bm-report-pending">Comparing this screenshot with Ujjivan and extracting transferable design patterns…</div>}
      {activeReport.benchmarkStatus==="failed"&&<div className="bm-quality-warning"><b>Pattern extraction failed.</b><p>{activeReport.benchmarkError||"The screenshot comparison could not be completed."}</p><button type="button" className="bm-open-site" onClick={()=>void retryBenchmarkInsights(activeReport)}>Retry pattern extraction</button></div>}
      {activeReport.benchmarkInsights&&!activeReport.benchmarkInsights.captureValid&&<div className="bm-quality-warning"><b>Screenshot not approved as benchmark evidence.</b><p>{activeReport.benchmarkInsights.captureReason} Upload a verified screenshot of the real homepage before using this bank for design decisions.</p><button type="button" className="bm-open-site" onClick={()=>void retryBenchmarkInsights(activeReport)}>Re-check screenshot</button></div>}
      {activeReport.benchmarkInsights?.captureValid&&<>
       <p>{activeReport.benchmarkInsights.summary}</p>
       {activeReport.benchmarkInsights.patterns.length?activeReport.benchmarkInsights.patterns.map((pattern,i)=><article className="bm-plan-card bm-pattern-card" key={pattern.title+"-"+i}>
        <div className="bm-finding-meta"><span className={"bm-severity-label "+(pattern.priority==="High"?"high":pattern.priority==="Medium"?"medium":"low")}>{pattern.priority} priority</span><span>{pattern.effort} effort</span><span>{pattern.targetArea}</span></div>
        <strong>{i+1}. {pattern.title}</strong>
        <p className="bm-plan-label">What the competitor does</p><p>{pattern.observedPattern}</p>
        <p className="bm-plan-label">Screenshot evidence</p><p>{pattern.screenshotEvidence}</p>
        <p className="bm-plan-label">Why this may help customers</p><p>{pattern.userBenefitHypothesis}</p>
        <div className="bm-benchmark-lens"><b>How Ujjivan could adapt it</b><p>{pattern.ujjivanAdaptation}</p><b>Trade-offs to consider</b><p>{pattern.tradeoffs}</p><b>How to validate it</b><p>{pattern.validation}</p></div>
       </article>):<p className="bm-panel-empty">The screenshots were verified, but no actionable pattern was identified confidently. Inspect the pages manually rather than forcing a recommendation.</p>}
       {activeReport.benchmarkInsights.watchouts.length>0&&<div className="bm-quality-warning"><b>Before adopting</b><ul>{activeReport.benchmarkInsights.watchouts.map((item,i)=><li key={i}>{item}</li>)}</ul></div>}
       <button type="button" className="bm-open-site" onClick={()=>void retryBenchmarkInsights(activeReport)}>Re-run pattern extraction</button>
      </>}
      {!activeReport.benchmarkStatus&&<p className="bm-panel-empty">Run the benchmark to compare this competitor screenshot directly against Ujjivan.</p>}
     </section>
     <details className="bm-panel-section bm-secondary-details">
      <summary style={{cursor:"pointer",fontWeight:650}}>Competitor UX issues (secondary context)</summary>
      <p className="bm-panel-help">These audit observations can reveal risks to avoid, but they are not the main benchmark output and do not tell us what is worth adopting.</p>
      {activeReport.findings.length?activeReport.findings.slice(0,4).map((finding,i)=><article className="bm-peer-card" key={finding.title+"-"+i}><div className="bm-finding-meta"><span className={"bm-severity-label "+finding.severity.toLowerCase()}>{finding.severity}</span><span>{finding.category}</span></div><strong>{finding.title}</strong><p>{finding.description||finding.recommendation}</p>{finding.evidence?.[0]?.element&&<small><b>Evidence:</b> {finding.evidence[0].element}{finding.evidence[0].detail?" — "+finding.evidence[0].detail:""}</small>}</article>):<p className="bm-panel-empty">No structured competitor issues were reported. This does not establish superior design.</p>}
     </details>
    </>}
   </>}
   <p className="bm-method-note">Method: audit Ujjivan to establish redesign needs; capture competitor pages as design evidence, verify both screenshots, and extract transferable patterns with Ujjivan-specific adaptation and validation. Competitor issue audits are not run by default.</p>
  </aside>
 </div>}
 <div className="bm-caveat"><strong>Benchmarking method</strong><p>The primary output is screenshot-grounded competitor patterns and a concrete adaptation for Ujjivan: where it belongs in the revamp, what customer need it may support, trade-offs, and how to validate it. Competitor audit findings and counts are secondary; blocked or unverified captures cannot support design recommendations.</p></div>
</section>}</div><footer className="or-footer"><span>UX Audit <span>·</span> Evidence first, recommendations second.</span><div><a href="/knowledge-base">Knowledge base</a><a href="/site-map">IA &amp; Audit</a></div></footer></section></main>;
}
