export const runtime = "nodejs";
export const maxDuration = 60;
const CACHE_TTL_MS = 30 * 60 * 1000;
let cachedScan: {expiresAt:number;payload:any}|null = null;

type Provider = "OpenRouter" | "Gemini";
type ModelDef = { provider: Provider; model: string; tier: "free" | "paid"; promptPrice?:number; completionPrice?:number; imageCapable?:boolean; popularityRank?:number };
const STATIC_FALLBACK: ModelDef[] = [
 {provider:"OpenRouter",model:"nvidia/nemotron-3.5-super-vl:free",tier:"free",promptPrice:0,completionPrice:0,imageCapable:true},
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
    body:JSON.stringify({model:item.model,messages:[{role:"user",content:"Reply OK"}],max_tokens:2,temperature:0,provider:{allow_fallbacks:false}}),
    signal:AbortSignal.timeout(7000),cache:"no-store"
   });
   payload = await response.json().catch(()=>({}));
   if (!response.ok && [429,500,502,503,504].includes(response.status)) {
    await new Promise(resolve=>setTimeout(resolve,1200));
    response = await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://uxauditscreenroot.vercel.app","X-Title":"UX Audit Availability Check"},body:JSON.stringify({model:item.model,messages:[{role:"user",content:"Reply OK"}],max_tokens:2,temperature:0,provider:{allow_fallbacks:false}}),signal:AbortSignal.timeout(7000),cache:"no-store"});
    payload = await response.json().catch(()=>({}));
   }
   if (!response.ok) return {...item,ok:false,latencyMs:Date.now()-started,error:`HTTP ${response.status}: ${payload?.error?.message ?? "Provider unavailable"}`};
   const answer = extractText(payload?.choices?.[0]?.message?.content);
   return {...item,ok:Boolean(answer),latencyMs:Date.now()-started,responsePreview:answer.slice(0,30),totalTokens:payload?.usage?.total_tokens ?? null,error:answer ? undefined : "Provider returned no text content"};
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
  const answer = extractText((payload?.candidates?.[0]?.content?.parts ?? []).map((p:any)=>p?.text ?? ""));
  return {...item,ok:Boolean(answer),latencyMs:Date.now()-started,responsePreview:answer.slice(0,30),totalTokens:payload?.usageMetadata?.totalTokenCount ?? null,error:answer ? undefined : "Provider returned no text content"};
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
  const results=await mapLimit(models,10,testModel);
  const working=results.filter((result:any)=>result.ok).map((result:any)=>({...result,...models.find(m=>m.model===result.model)}));
  const failed=results.filter((result:any)=>!result.ok);
  // The audit analyzes screenshots, so the selected model must accept image input.
  const visionWorking=working.filter((m:any)=>m.imageCapable);
  const ranked=[...visionWorking].sort((a:any,b:any)=>((a.promptPrice??0)+(a.completionPrice??0))-((b.promptPrice??0)+(b.completionPrice??0))||a.latencyMs-b.latencyMs);
  const selected=ranked[0]??null;
  const payload={checkedAt:new Date().toISOString(),modelCount:models.length,working,failed,selected,selectionReason:selected?"Cheapest verified image-capable model by listed input + output token pricing; latency breaks ties.": "No verified image-capable model was found among the top 50 models. Audit is disabled rather than using an unverified model.",cacheHit:false,cacheTtlMinutes:30,note:"Tests the first 50 models returned in OpenRouter catalogue order with tiny text-only requests. Only verified models supporting image input can be selected for screenshot audits. Pricing is catalogue pricing; a small charge may apply to paid tests."};
  cachedScan={expiresAt:Date.now()+CACHE_TTL_MS,payload};
  return Response.json(payload,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Model availability scan failed."},{status:503,headers:{"Cache-Control":"no-store"}})}
}
