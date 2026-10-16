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
type CatalogItem = { id?:string; context_length?:number; pricing?:{prompt?:string;completion?:string}; architecture?:{input_modalities?:string[]} };
async function getJson(url:string,headers:Record<string,string>) {
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(8000),cache:"no-store"});
 const payload=await response.json().catch(()=>({})); return {response,payload};
}
export async function GET() {
 const orKey=process.env.OPENROUTER_API_KEY, gemKey=process.env.GEMINI_API_KEY;
 let orConnected=false, orError:string|null=null, catalog=new Map<string,CatalogItem>();
 if(orKey) try { const {response,payload}=await getJson("https://openrouter.ai/api/v1/models",{Authorization:`Bearer ${orKey}`});
 if(response.ok&&Array.isArray(payload?.data)){orConnected=true;catalog=new Map((payload.data as CatalogItem[]).filter(m=>typeof m.id==="string").map(m=>[m.id!,m]));}
 else orError=`OpenRouter catalogue HTTP ${response.status}`; } catch {orError="Could not reach OpenRouter catalogue.";}
 let gemConnected=false, gemError:string|null=null, gemModels=new Set<string>();
 if(gemKey) try { const {response,payload}=await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",{"x-goog-api-key":gemKey});
 if(response.ok&&Array.isArray(payload?.models)){gemConnected=true;gemModels=new Set(payload.models.map((m:{name?:string})=>(m.name??"").replace(/^models\//,"")));}
 else gemError=`Gemini catalogue HTTP ${response.status}`; } catch {gemError="Could not reach Gemini catalogue.";}
 const models=MODELS.map(item=>{
 const ci=item.provider==="OpenRouter"?catalog.get(item.model):undefined;
 const configured=item.provider==="OpenRouter"?Boolean(orKey):Boolean(gemKey);
 const connected=item.provider==="OpenRouter"?orConnected:gemConnected;
 const listed=item.provider==="OpenRouter"?catalog.has(item.model):gemModels.has(item.model);
 return {...item,configured,providerConnected:connected,listed,status:!configured?"key_missing":!connected?"connection_error":!listed?"not_listed":"available_to_test",
 contextLength:ci?.context_length??null,inputModalities:ci?.architecture?.input_modalities??null,
 pricingPerMillion:ci?.pricing?{promptUsd:Number(ci.pricing.prompt??0)*1e6,completionUsd:Number(ci.pricing.completion??0)*1e6}:null};
 });
 return Response.json({checkedAt:new Date().toISOString(),keys:{openRouter:Boolean(orKey),gemini:Boolean(gemKey)},
 providers:{openRouter:{connected:orConnected,error:orError},gemini:{connected:gemConnected,error:gemError}},models,
 note:"Connection refresh checks provider credentials and model catalogues only; it does not run inference or spend generation tokens. 'Available to test' is not proof a model can generate. Test model sends a tiny text-only request."},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:Request) {
 try {
 const body=await request.json().catch(()=>({})); const model=typeof body?.model==="string"?body.model:""; const provider=body?.provider as Provider;
 if(!MODELS.some(m=>m.model===model&&m.provider===provider))return Response.json({error:"Choose a model from the configured list."},{status:400});
 const started=Date.now();
 if(provider==="OpenRouter"){
 const key=process.env.OPENROUTER_API_KEY;if(!key)return Response.json({error:"OPENROUTER_API_KEY is not configured."},{status:503});
 let response:Response|undefined,result:any={},attempts=0;
 for(let attempt=0;attempt<2;attempt++){
  attempts=attempt+1;
  try {
   response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://uxauditscreenroot.vercel.app","X-Title":"UX Audit Model Connection Test"},
    body:JSON.stringify({model,messages:[{role:"user",content:"Reply with exactly: OK"}],max_tokens:8,temperature:0,provider:{allow_fallbacks:true}}),signal:AbortSignal.timeout(12000),cache:"no-store"});
   result=await response.json().catch(()=>({}));
   if(response.ok||![429,500,502,503,504].includes(response.status)||attempt===1)break;
   await new Promise(resolve=>setTimeout(resolve,700));
  } catch(err) {
   if(attempt===1) throw err;
   await new Promise(resolve=>setTimeout(resolve,700));
  }
 }
 if(!response)throw new Error("OpenRouter did not return a response.");
 if(!response.ok)return Response.json({model,provider,status:"error",latencyMs:Date.now()-started,attempts,upstreamStatus:response.status,error:`Provider HTTP ${response.status}: ${result?.error?.message??"The model provider is temporarily unavailable. Try again shortly."}`,note:"Transient 429/5xx errors were retried once. No screenshot was sent."});
 const rawContent=result?.choices?.[0]?.message?.content; const content=typeof rawContent==="string"?rawContent:Array.isArray(rawContent)?rawContent.map((part:any)=>typeof part==="string"?part:part?.text??"").join(""):""; const usage=result?.usage??{};
 return Response.json({model,provider,status:content.trim()?"connected":"no_response",latencyMs:Date.now()-started,responsePreview:content.slice(0,80),
 usage:{promptTokens:usage.prompt_tokens??null,completionTokens:usage.completion_tokens??null,totalTokens:usage.total_tokens??null,costUsd:usage.cost??null},
 attempts,note:"One short text-only prompt was sent. Paid models may incur a small charge; no screenshot is used."},{headers:{"Cache-Control":"no-store"}});
 }
 const key=process.env.GEMINI_API_KEY;if(!key)return Response.json({error:"GEMINI_API_KEY is not configured."},{status:503});
 const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},
 body:JSON.stringify({contents:[{role:"user",parts:[{text:"Reply with exactly: OK"}]}],generationConfig:{maxOutputTokens:8,temperature:0}}),signal:AbortSignal.timeout(12000),cache:"no-store"});
 const result=await response.json().catch(()=>({}));if(!response.ok)return Response.json({model,provider,status:"error",latencyMs:Date.now()-started,error:`HTTP ${response.status}: ${result?.error?.message??"Provider request failed"}`});
 const content=(result?.candidates?.[0]?.content?.parts??[]).map((p:{text?:string})=>p.text??"").join(""),usage=result?.usageMetadata??{};
 return Response.json({model,provider,status:content.trim()?"connected":"no_response",latencyMs:Date.now()-started,responsePreview:content.slice(0,80),
 usage:{promptTokens:usage.promptTokenCount??null,completionTokens:usage.candidatesTokenCount??null,totalTokens:usage.totalTokenCount??null,costUsd:null},
 note:"One short text-only prompt was sent; Gemini billing depends on your account and model."},{headers:{"Cache-Control":"no-store"}});
 } catch(error){return Response.json({error:error instanceof Error?error.message:"Model test failed."},{status:500});}
}
