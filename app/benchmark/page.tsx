"use client";
import { useState } from "react";

type Finding={severity:string;category:string;title:string;recommendation:string;};
type Report={name:string;url:string;findings:Finding[];error?:string;};
const initial=[{name:"Competitor 1",url:""},{name:"Competitor 2",url:""},{name:"Competitor 3",url:""}];
function normalizeUrl(raw:string){const s=raw.trim();if(!s)return "";const u=new URL(/^https?:\/\//i.test(s)?s:"https://"+s);if(!["http:","https:"].includes(u.protocol))throw new Error("Use a public HTTP or HTTPS website.");return u.origin;}
export default function BenchmarkPage(){
 const [clientName,setClientName]=useState("Ujjivan Small Finance Bank");
 const [clientUrl,setClientUrl]=useState("https://www.ujjivansfb.in/");
 const [competitors,setCompetitors]=useState(initial);
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState("");
 const [error,setError]=useState("");
 const [reports,setReports]=useState<Report[]>([]);
 async function run(){
  setError("");setReports([]);setBusy(true);
  try{
   const entries=[{name:clientName.trim()||"Client",url:normalizeUrl(clientUrl)},...competitors.filter(x=>x.url.trim()).map(x=>({name:x.name.trim()||new URL(normalizeUrl(x.url)).hostname,url:normalizeUrl(x.url)}))];
   if(!entries[0].url)throw new Error("Enter the client website URL.");
   if(entries.length<2)throw new Error("Add at least one competitor URL to compare against the client.");
   if(new Set(entries.map(x=>x.url)).size!==entries.length)throw new Error("Each website must have a unique URL.");
   const output:Report[]=[];
   for(let i=0;i<entries.length;i++){
    const entry=entries[i];setStatus("Auditing "+(i+1)+" of "+entries.length+": "+entry.name+" — "+entry.url);
    try{
     const response=await fetch("/api/audit-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:entry.url,projectName:entry.name,verifiedModels:[{provider:"OpenRouter",model:"openrouter/auto"}]})});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw new Error(data.error||"Audit request failed.");
     output.push({name:entry.name,url:entry.url,findings:Array.isArray(data.page?.findings)?data.page.findings:[]});
    }catch(e){output.push({name:entry.name,url:entry.url,findings:[],error:e instanceof Error?e.message:"Audit failed"});}
    setReports([...output]);
   }
   if(output.every(x=>x.error))throw new Error("None of the websites could be audited. Check capture access and OpenRouter configuration.");
   setStatus("Benchmark finished. Compare the evidence-backed findings below; counts are not a quality score.");
  }catch(e){setError(e instanceof Error?e.message:"Could not run benchmark.");}
  finally{setBusy(false);}
 }
 const count=(r:Report,severity:string)=>r.findings.filter(f=>f.severity.toLowerCase()===severity).length;
 return <main style={{minHeight:"100vh",background:"#f4f6f9",color:"#172033",fontFamily:"Inter,Arial,sans-serif",padding:"26px clamp(16px,4vw,56px)"}}>
  <div style={{maxWidth:1320,margin:"0 auto"}}>
   <nav style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,borderBottom:"1px solid #dce2ea",paddingBottom:18}}><a href="/" style={{fontSize:20,fontWeight:850,color:"#172033",textDecoration:"none"}}>UX AUDIT</a><div style={{display:"flex",gap:16,fontSize:13}}><a href="/site-map" style={{color:"#34445d"}}>IA & Audit</a><a href="/benchmark" style={{color:"#34445d",fontWeight:800}}>Benchmark</a></div></nav>
   <header style={{padding:"34px 0 24px"}}><div style={{fontSize:11,fontWeight:850,letterSpacing:1.8,color:"#64748b"}}>COMPETITIVE UX INTELLIGENCE</div><h1 style={{fontSize:"clamp(34px,5vw,58px)",letterSpacing:"-2px",lineHeight:1.03,maxWidth:900,margin:"12px 0"}}>Benchmark the experience, not just the visuals.</h1><p style={{maxWidth:820,color:"#647084",fontSize:16,lineHeight:1.7}}>Audit a client and up to three competitors using the same screenshot-based UX workflow. Compare evidence-backed issues by severity and category—without pretending the finding count is a universal UX score.</p></header>
   <section style={{background:"#fff",border:"1px solid #e0e5ec",borderRadius:16,padding:"22px",boxShadow:"0 8px 24px #17203308"}}>
    <h2 style={{fontSize:19,margin:"0 0 16px"}}>1. Client baseline</h2><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:14}}><label style={{display:"grid",gap:7,fontSize:12,fontWeight:750}}>Client / project name<input value={clientName} onChange={e=>setClientName(e.target.value)} style={inputStyle}/></label><label style={{display:"grid",gap:7,fontSize:12,fontWeight:750}}>Client homepage URL<input value={clientUrl} onChange={e=>setClientUrl(e.target.value)} placeholder="https://client.com" style={inputStyle}/></label></div>
    <h2 style={{fontSize:19,margin:"26px 0 14px"}}>2. Competitors</h2><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:14}}>{competitors.map((item,i)=><article key={i} style={{border:"1px solid #e3e8ef",borderRadius:12,padding:14,display:"grid",gap:10}}><div style={{fontSize:12,fontWeight:850,color:"#5f6e83"}}>COMPETITOR {i+1}</div><label style={{display:"grid",gap:6,fontSize:12,fontWeight:700}}>Brand / institution name<input value={item.name} onChange={e=>setCompetitors(prev=>prev.map((x,j)=>j===i?{...x,name:e.target.value}:x))} style={inputStyle}/></label><label style={{display:"grid",gap:6,fontSize:12,fontWeight:700}}>Homepage URL<input value={item.url} onChange={e=>setCompetitors(prev=>prev.map((x,j)=>j===i?{...x,url:e.target.value}:x))} placeholder="https://competitor.com" style={inputStyle}/></label></article>)}</div>
    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginTop:20}}><button disabled={busy} onClick={run} style={{border:0,borderRadius:10,background:busy?"#94a3b8":"#172033",color:"#fff",padding:"13px 18px",fontWeight:800,cursor:busy?"wait":"pointer"}}>{busy?"Benchmark running…":"Run client + competitor benchmark"}</button><span style={{fontSize:12,color:"#647084"}}>Each site triggers a screenshot capture and OpenRouter analysis; model usage may incur cost.</span></div>
    {status&&<p role="status" style={{fontSize:13,color:"#475569",marginBottom:0,marginTop:14}}>{status}</p>}{error&&<p role="alert" style={{fontSize:13,color:"#b42318",marginBottom:0,marginTop:14}}>{error}</p>}
   </section>
   {reports.length>0&&<section style={{marginTop:26}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"end",gap:12,flexWrap:"wrap"}}><div><div style={{fontSize:11,fontWeight:850,letterSpacing:1.4,color:"#64748b"}}>RESULTS</div><h2 style={{fontSize:26,margin:"8px 0"}}>Comparable audit snapshot</h2></div><span style={{fontSize:12,color:"#647084"}}>Directional comparison · not a statistically normalized score</span></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(245px,1fr))",gap:14,marginTop:14}}>{reports.map((r,i)=><article key={r.url} style={{background:"#fff",border:"1px solid #e0e5ec",borderRadius:14,padding:18,minWidth:0}}><div style={{fontSize:11,fontWeight:850,color:i===0?"#3158a6":"#64748b"}}>{i===0?"CLIENT BASELINE":"COMPETITOR "+i}</div><h3 style={{fontSize:19,margin:"8px 0"}}>{r.name}</h3><div style={{fontSize:12,color:"#647084",overflowWrap:"anywhere"}}>{r.url}</div>{r.error?<p style={{color:"#b42318",fontSize:13,lineHeight:1.5}}>{r.error}</p>:<><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,margin:"18px 0"}}>{(["high","medium","low"] as const).map(s=><div key={s} style={{background:"#f7f8fa",borderRadius:9,padding:10}}><div style={{fontSize:11,color:"#647084",textTransform:"capitalize"}}>{s}</div><strong style={{fontSize:24}}>{count(r,s)}</strong></div>)}</div><div style={{fontSize:12,color:"#647084",marginBottom:8}}>{r.findings.length} findings · {new Set(r.findings.map(f=>f.category)).size} issue categories</div>{r.findings.slice(0,5).map((f,j)=><div key={j} style={{padding:"10px 0",borderTop:"1px solid #edf0f4"}}><div style={{fontSize:10,fontWeight:850,color:f.severity==="high"?"#b42318":"#64748b",textTransform:"uppercase"}}>{f.severity} · {f.category}</div><div style={{fontSize:13,fontWeight:750,marginTop:4}}>{f.title}</div><div style={{fontSize:12,color:"#647084",lineHeight:1.5,marginTop:4}}>{f.recommendation}</div></div>)}</>}</article>)}</div>
    <p style={{fontSize:12,color:"#647084",lineHeight:1.7,marginTop:14}}>Fairness note: this first version audits each homepage once. Differences in capture success, content density, and detected issues affect counts. Use the findings as a qualitative comparison, not proof that one institution is objectively better.</p>
   </section>}
  </div>
 </main>
}
const inputStyle={width:"100%",boxSizing:"border-box" as const,border:"1px solid #cbd5e1",borderRadius:8,padding:"11px 12px",fontSize:14,background:"#fff",color:"#172033",outlineColor:"#64748b"};
