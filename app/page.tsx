"use client";
import { FormEvent, useEffect, useState } from "react";
const VERIFICATION_KEY = "uxaudit-fixed-model-verification";
type Model = { model: string; label: string; ok: boolean };
type Verification = { models?: Model[]; selectedModel?: Model | null; verificationRunCostUsd?: number; verificationRunTokens?: number };
export default function Home() {
 const [url, setUrl] = useState("");
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [verification, setVerification] = useState<Verification | null>(null);
 const [verificationError, setVerificationError] = useState("");
 useEffect(() => {
  let cancelled = false;
  (async () => {
   try {
    let data: Verification | null = null;
    try {
     const raw = sessionStorage.getItem(VERIFICATION_KEY);
     if (raw) { const cached = JSON.parse(raw); if (cached.expiresAt > Date.now() && cached.payload?.models?.length === 3) data = cached.payload; }
    } catch {}
    if (!data) {
     const response = await fetch("/api/model-verification", { method: "POST", cache: "no-store" });
     const payload = await response.json();
     if (!response.ok) throw new Error(payload.error || "Model verification failed.");
     data = payload;
     try { sessionStorage.setItem(VERIFICATION_KEY, JSON.stringify({ expiresAt: Date.now() + 30 * 60 * 1000, payload: data })); } catch {}
    }
    if (!cancelled) setVerification(data);
   } catch (e) {
    if (!cancelled) setVerificationError(e instanceof Error ? e.message : "Model verification failed.");
   }
  })();
  return () => { cancelled = true; };
 }, []);
 const verifiedCount = verification?.models?.filter(model => model.ok).length ?? 0;
 const connected = verifiedCount >= 2 && Boolean(verification?.selectedModel);
 function start(e: FormEvent) {
  e.preventDefault(); setError("");
  try {
   const typed = url.trim();
   const parsed = new URL(/^https?:\/\//i.test(typed) ? typed : "https://" + typed);
   if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Enter a valid public website URL.");
   setLoading(true);
   window.location.href = "/site-map?url=" + encodeURIComponent(parsed.origin);
  } catch { setError("Enter a valid website URL, for example https://example.com"); }
 }
 return <main style={{minHeight:"100vh",background:"#f4f5f7",color:"#172033",fontFamily:"Inter,Arial,sans-serif",padding:"28px clamp(18px,5vw,72px)"}}>
  <nav style={{maxWidth:1200,margin:"auto",display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,paddingBottom:22,borderBottom:"1px solid #dfe3e8",flexWrap:"wrap"}}>
   <strong style={{fontSize:22}}>UX AUDIT</strong>
   <a href="/model-verification" style={{color:connected?"#18723d":verifiedCount===1?"#986500":"#34445d",background:connected?"#e9f7ef":"#fff",border:"1px solid "+(connected?"#b6ddc2":"#dfe3e8"),borderRadius:9,padding:"10px 13px",fontSize:13,fontWeight:750,textDecoration:"none"}}>
    {connected ? "● Connected · " + verification?.selectedModel?.label : verificationError ? "● Connection check failed" : verification ? "● Partial connection · " + verifiedCount + "/3 verified" : "Checking 3 configured models…"}
   </a>
  </nav>
  <section style={{maxWidth:1000,margin:"12vh auto 0"}}>
   <div style={{fontSize:11,fontWeight:800,letterSpacing:2,color:"#60708a"}}>IA FIRST · EVIDENCE-LED UX AUDIT</div>
   <h1 style={{fontSize:"clamp(40px,7vw,76px)",letterSpacing:"-3px",lineHeight:1.02,maxWidth:900,margin:"18px 0"}}>Start with the structure.<br/>Audit only what matters.</h1>
   <p style={{fontSize:18,lineHeight:1.7,color:"#667386",maxWidth:760}}>Enter a website URL to discover its pages and map the information architecture. Review structural issues, choose the pages you want, then capture screenshots and audit only that selection.</p>
   <form onSubmit={start} style={{display:"flex",gap:10,marginTop:30,maxWidth:850,flexWrap:"wrap"}}>
    <input type="url" aria-label="Website URL" placeholder="https://example.com" value={url} onChange={e=>setUrl(e.target.value)} required style={{flex:"1 1 380px",padding:"17px 16px",fontSize:15,border:"1px solid #cbd3de",borderRadius:10,background:"white"}}/>
    <button disabled={loading} style={{padding:"16px 24px",border:0,borderRadius:10,background:"#192b49",color:"white",fontWeight:800,fontSize:14,cursor:"pointer"}}>{loading?"Opening…":"Get started →"}</button>
   </form>
   {error&&<p style={{color:"#a21d1d"}}>{error}</p>}
   {verificationError&&<p style={{color:"#9f2828",fontSize:12,marginTop:10}}>Model verification: {verificationError}. Audits require at least two verified configured models.</p>}
   <p style={{fontSize:12,color:"#7a8596",marginTop:14}}>No screenshot upload here. Page discovery starts from the URL; screenshots are reserved for the pages you select later.</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12,marginTop:48}}>
    { [["01","Discover","Build a clickable HTML/CSS page map."],["02","Review & select","Inspect flagged hierarchy and choose specific URLs."],["03","Capture & audit","Run screenshot-based audits only for selected pages."]].map(([n,t,d])=><article key={n} style={{background:"white",border:"1px solid #e0e5ec",borderRadius:12,padding:18}}><span style={{fontSize:12,color:"#72819a",fontWeight:800}}>{n}</span><h2 style={{fontSize:18,margin:"10px 0 6px"}}>{t}</h2><p style={{fontSize:13,color:"#687588",lineHeight:1.55,margin:0}}>{d}</p></article>)}
   </div>
  </section>
 </main>;
}
