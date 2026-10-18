export const runtime = "nodejs";
export const maxDuration = 60;
const CACHE_TTL_MS = 30 * 60 * 1000;
let cachedScan: {expiresAt:number;payload:any}|null = null;

type Provider = "OpenRouter" | "Gemini";
type ModelDef = { provider: Provider; model: string; tier: "free" | "paid"; promptPrice?:number; completionPrice?:number; imageCapable?:boolean; popularityRank?:number };
const STATIC_FALLBACK: ModelDef[] = [
 {provider:"OpenRouter",model:"deepseek/deepseek-v4-flash-vision-exp",tier:"paid",imageCapable:true},
 {provider:"OpenRouter",model:"deepseek/deepseek-v4-flash-vision-exp",tier:"paid",imageCapable:true},
];

function extractText(value: any): string {
 if (typeof value === "string") return value.trim();
 if (Array.isArray(value)) return value.map(part => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "").join("").trim();
 return "";
}
async function testModel(item: ModelDef) {
 const started = Date.now();
 try {
  let response: Response;
  let payload: any;
  if (item.provider === "OpenRouter") {
   const key = process.env.OPENROUTER_API_KEY;
   if (!key) return {...item,ok:false,latencyMs:0,error:"OpenRouter API key missing"};
   response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://uxauditscreenroot.vercel.app","X-Title":"UX Audit Availability Check"},
    body:JSON.stringify({model:item.model,messages:[{role:"user",content:"Reply OK"}],max_tokens:2,temperature:0,provider:{allow_fallbacks:false,max_price:{prompt:0.5,completion:2}}}),
    signal:AbortSignal.timeout(7000),cache:"no-store"
   });
   payload = await response.json().catch(()=>({}));
   if (!response.ok && [429,500,502,503,504].includes(response.status)) {
    await new Promise(resolve=>setTimeout(resolve,1200));
    response = await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://uxauditscreenroot.vercel.app","X-Title":"UX Audit Availability Check"},body:JSON.stringify({model:item.model,messages:[{role:"user",content:"Reply OK"}],max_tokens:2,temperature:0,provider:{allow_fallbacks:false,max_price:{prompt:0.5,completion:2}}}),signal:AbortSignal.timeout(7000),cache:"no-store"});
    payload = await response.json().catch(()=>({}));
   }
   if (!response.ok) return {...item,ok:false,latencyMs:Date.now()-started,error:`HTTP ${response.status}: ${payload?.error?.message ?? "Provider unavailable"}`};
   const answer = extractText(payload?.choices?.[0]?.message?.content);
   const usage=payload?.usage??{};const promptTokens=Number(usage.prompt_tokens??0),completionTokens=Number(usage.completion_tokens??0);const estimatedCostUsd=typeof usage.cost==="number"?usage.cost:(promptTokens*(item.promptPrice??0)+completionTokens*(item.completionPrice??0));return {...item,ok:Boolean(answer),latencyMs:Date.now()-started,responsePreview:answer.slice(0,30),promptTokens,completionTokens,totalTokens:usage.total_tokens??(promptTokens+completionTokens),estimatedCostUsd,error:answer ? undefined : "Provider returned no text content"};
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return {...item,ok:false,latencyMs:0,error:"Gemini API key missing"};
  response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${item.model}:generateContent`,{
   method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},
   body:JSON.stringify({contents:[{role:"user",parts:[{text:"OK"}]}],generationConfig:{maxOutputTokens:2,temperature:0}}),
   signal:AbortSignal.timeout(10000),cache:"no-store"
  });
  payload = await response.json().catch(()=>({}));
  if (!response.ok && [429,500,502,503,504].includes(response.status)) {
   await new Promise(resolve=>setTimeout(resolve,1200));
   response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${item.model}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({contents:[{role:"user",parts:[{text:"OK"}]}],generationConfig:{maxOutputTokens:2,temperature:0}}),signal:AbortSignal.timeout(10000),cache:"no-store"});
   payload = await response.json().catch(()=>({}));
  }
  if (!response.ok) return {...item,ok:false,latencyMs:Date.now()-started,error:`HTTP ${response.status}: ${payload?.error?.message ?? "Provider unavailable"}`};
  const answer = extractText((payload?.candidates?.[0]?.content?.parts ?? []).map((p:any)=>p?.text ?? ""));const usage=payload?.usageMetadata??{};const promptTokens=Number(usage.promptTokenCount??0),completionTokens=Number(usage.candidatesTokenCount??0);const estimatedCostUsd=(promptTokens*(item.promptPrice??0)+completionTokens*(item.completionPrice??0));
  return {...item,ok:Boolean(answer),latencyMs:Date.now()-started,responsePreview:answer.slice(0,30),promptTokens,completionTokens,totalTokens:usage.totalTokenCount??(promptTokens+completionTokens),estimatedCostUsd,error:answer ? undefined : "Provider returned no text content"};
 } catch (error) {
  return {...item,ok:false,latencyMs:Date.now()-started,error:error instanceof Error ? error.message : "Model check failed"};
 }
}
async function getPopularModels(): Promise<ModelDef[]> {
 const key=process.env.OPENROUTER_API_KEY;
 if(!key)throw new Error("OPENROUTER_API_KEY is not configured.");
 const response=await fetch("https://openrouter.ai/api/v1/models",{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000),cache:"no-store"});
 const payload:any=await response.json().catch(()=>({}));
 if(!response.ok||!Array.isArray(payload?.data))throw new Error("Could not load the OpenRouter model catalogue.");
 // OpenRouter's catalogue order is popularity-oriented; preserve that order and take its first 50.
 return payload.data.slice(0,50).map((m:any,index:number)=>{
  const modalities:string[] = m?.architecture?.input_modalities??[];
  const promptPrice=Number(m?.pricing?.prompt??0),completionPrice=Number(m?.pricing?.completion??0);
  const free=promptPrice===0&&completionPrice===0;
  return {provider:"OpenRouter" as const,model:String(m.id),tier:free?"free" as const:"paid" as const,promptPrice,completionPrice,imageCapable:modalities.includes("image"),popularityRank:index+1};
 }).filter((m:ModelDef)=>Boolean(m.model));
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]> {
 const output:R[]=[];let cursor=0;
 const workers=Array.from({length:limit},async()=>{while(true){const i=cursor++;if(i>=items.length)return;output[i]=await fn(items[i]);}});
 await Promise.all(workers);return output;
}
export async function POST() {
 if(cachedScan&&cachedScan.expiresAt>Date.now())return Response.json({...cachedScan.payload,cacheHit:true},{headers:{"Cache-Control":"no-store"}});
 try {
  const models=await getPopularModels();
  const auditCandidates=models.filter((m:any)=>m.imageCapable && m.tier==="paid" && !((m as any).audioOnly))
    .sort((a:any,b:any)=>((a.promptPrice??0)+(a.completionPrice??0))-((b.promptPrice??0)+(b.completionPrice??0)) || (a.popularityRank??999)-(b.popularityRank??999))
    .slice(0,8);
  const results=await mapLimit(auditCandidates,3,testModel);
  const working=results.filter((result:any)=>result.ok).map((result:any)=>({...result,...auditCandidates.find(m=>m.model===result.model)}));
  const failed=results.filter((result:any)=>!result.ok);
  // The audit analyzes screenshots, so the selected model must accept image input.
  const visionWorking=working.filter((m:any)=>m.imageCapable);
  const ranked=[...visionWorking].sort((a:any,b:any)=>((a.promptPrice??0)+(a.completionPrice??0))-((b.promptPrice??0)+(b.completionPrice??0))||a.latencyMs-b.latencyMs);
  const selectedModels=ranked.slice(0,3);
  const selected=selectedModels[0]??null;
  const verificationActivity=results.map((r:any)=>({model:r.model,ok:Boolean(r.ok),tokens:Number(r.totalTokens??0),costUsd:Number(r.estimatedCostUsd??0),latencyMs:Number(r.latencyMs??0)}));
  const verificationRunCostUsd=verificationActivity.reduce((sum:number,a:any)=>sum+a.costUsd,0);const verificationRunTokens=verificationActivity.reduce((sum:number,a:any)=>sum+a.tokens,0);
  const payload={checkedAt:new Date().toISOString(),modelCount:models.length,auditCandidateCount:auditCandidates.length,working,failed,selected,selectedModels,verificationActivity,verificationRunCostUsd,verificationRunTokens,selectionReason:selected?"Cheapest verified image-capable model by listed input + output token pricing; latency breaks ties.": "No verified image-capable model was found among the top 50 models. Audit is disabled rather than using an unverified model.",cacheHit:false,cacheTtlMinutes:30,note:"Takes the first 50 catalogue models, then tests at most 8 cheapest paid image-capable candidates using tiny text-only checks with no provider fallback and a price ceiling. Free models and auto-routing are excluded. Up to three verified paid models are retained as primary/fallback candidates. Pricing is catalogue pricing; a small charge may apply to paid verification checks."};
  cachedScan={expiresAt:Date.now()+CACHE_TTL_MS,payload};
  return Response.json(payload,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Model availability scan failed."},{status:503,headers:{"Cache-Control":"no-store"}})}
}
