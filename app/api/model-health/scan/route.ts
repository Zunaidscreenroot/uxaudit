export const runtime = "nodejs";
export const maxDuration = 20;

type Provider = "OpenRouter" | "Gemini";
type ModelDef = { provider: Provider; model: string; tier: "free" | "paid" };
const MODELS: ModelDef[] = [
 {provider:"OpenRouter",model:"nvidia/nemotron-3.5-super-vl:free",tier:"free"},
 {provider:"OpenRouter",model:"dots-studio/dots-3-note-preview:free",tier:"free"},
 {provider:"OpenRouter",model:"nvidia/nemotron-3.5-content-safety:free",tier:"free"},
 {provider:"OpenRouter",model:"deepseek/deepseek-v4.1-flash",tier:"paid"},
 {provider:"OpenRouter",model:"xiaomi/mimo-v2.6-flash",tier:"paid"},
 {provider:"OpenRouter",model:"deepseek/deepseek-v4-flash-0731",tier:"paid"},
 {provider:"OpenRouter",model:"deepseek/deepseek-v4-flash",tier:"paid"},
 {provider:"OpenRouter",model:"google/gemini-3.8-flash",tier:"paid"},
 {provider:"OpenRouter",model:"google/gemma-4-26b-a4b-it:free",tier:"free"},
 {provider:"OpenRouter",model:"openai/gpt-oss-20b",tier:"paid"},
 {provider:"OpenRouter",model:"xiaomi/mimo-v2.6-pro",tier:"paid"},
 {provider:"OpenRouter",model:"anthropic/claude-haiku-5.5:batch",tier:"paid"},
 {provider:"OpenRouter",model:"deepseek/deepseek-v4-flash-vision-exp",tier:"paid"},
 {provider:"Gemini",model:"gemini-3.5-flash-lite",tier:"free"},
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
    body:JSON.stringify({model:item.model,messages:[{role:"user",content:"OK"}],max_tokens:2,temperature:0,provider:{allow_fallbacks:true}}),
    signal:AbortSignal.timeout(10000),cache:"no-store"
   });
   payload = await response.json().catch(()=>({}));
   if (!response.ok && [429,500,502,503,504].includes(response.status)) {
    await new Promise(resolve=>setTimeout(resolve,1200));
    response = await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://uxauditscreenroot.vercel.app","X-Title":"UX Audit Availability Check"},body:JSON.stringify({model:item.model,messages:[{role:"user",content:"OK"}],max_tokens:2,temperature:0,provider:{allow_fallbacks:true}}),signal:AbortSignal.timeout(10000),cache:"no-store"});
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
export async function POST() {
 const results = [];\n for (const model of MODELS) { results.push(await testModel(model)); await new Promise(resolve=>setTimeout(resolve,250)); }
 const working = results.filter(result => result.ok);
 return Response.json({
  checkedAt:new Date().toISOString(),
  working,
  failed:results.filter(result => !result.ok),
  note:"Automatic text-only availability checks; no screenshots. Each request caps generated output at two tokens and retries transient provider errors once. Paid model checks may incur a small charge."
 },{headers:{"Cache-Control":"no-store"}});
}
