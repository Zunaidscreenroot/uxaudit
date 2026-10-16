export const runtime = "nodejs";
export const maxDuration = 15;

type KeyInfo = { label?:string; limit?:number|null; limit_remaining?:number|null; usage?:number; usage_daily?:number; usage_weekly?:number; usage_monthly?:number; is_free_tier?:boolean };
type Activity = { model?:string; provider_name?:string; prompt_tokens?:number; completion_tokens?:number; reasoning_tokens?:number; requests?:number; usage?:number; date?:string };

async function getJson(url:string,key:string) {
 const response=await fetch(url,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(7000),cache:"no-store"});
 const payload=await response.json().catch(()=>({}));
 return {response,payload};
}
export async function GET() {
 const apiKey=process.env.OPENROUTER_API_KEY;
 const managementKey=process.env.OPENROUTER_MANAGEMENT_KEY;
 const budgetRaw=Number(process.env.DAILY_BUDGET_INR??"100");
 const dailyBudgetInr=Number.isFinite(budgetRaw)&&budgetRaw>0?budgetRaw:100;
 let provider:any={connected:false,keyConfigured:Boolean(apiKey),managementKeyConfigured:Boolean(managementKey),usageUsd:null,usageDailyUsd:null,limitUsd:null,remainingUsd:null,freeTier:null,creditsUsd:null,creditsUsedUsd:null,activity:[],activityError:null,creditsError:null,error:null};
 if(apiKey) {
  try {
   const {response,payload}=await getJson("https://openrouter.ai/api/v1/key",apiKey);
   if(!response.ok) provider.error=`OpenRouter key status returned HTTP ${response.status}`;
   else {
    const data=(payload?.data??payload) as KeyInfo;
    provider={...provider,connected:true,label:data.label??null,usageUsd:typeof data.usage==="number"?data.usage:null,usageDailyUsd:typeof data.usage_daily==="number"?data.usage_daily:null,usageWeeklyUsd:typeof data.usage_weekly==="number"?data.usage_weekly:null,usageMonthlyUsd:typeof data.usage_monthly==="number"?data.usage_monthly:null,limitUsd:typeof data.limit==="number"?data.limit:null,remainingUsd:typeof data.limit_remaining==="number"?data.limit_remaining:null,freeTier:typeof data.is_free_tier==="boolean"?data.is_free_tier:null,error:null};
   }
  } catch { provider.error="Could not reach OpenRouter key-status API."; }
 }
 if(managementKey) {
  try {
   const {response,payload}=await getJson("https://openrouter.ai/api/v1/credits",managementKey);
   if(response.ok) {const d=payload?.data??{};provider.creditsTotalUsd=typeof d.total_credits==="number"?d.total_credits:null;provider.creditsUsedUsd=typeof d.total_usage==="number"?d.total_usage:null;provider.creditsUsd=typeof d.total_credits==="number"&&typeof d.total_usage==="number"?d.total_credits-d.total_usage:null;}
   else provider.creditsError=`Credits API HTTP ${response.status}`;
  } catch {provider.creditsError="Could not reach OpenRouter credits API.";}
  try {
   const {response,payload}=await getJson("https://openrouter.ai/api/v1/activity",managementKey);
   if(response.ok&&Array.isArray(payload?.data)) {
    provider.activity=payload.data.slice(0,100).map((item:Activity)=>({model:item.model??"Unknown model",providerName:item.provider_name??"Unknown provider",date:item.date??null,requests:item.requests??0,promptTokens:item.prompt_tokens??0,completionTokens:item.completion_tokens??0,reasoningTokens:item.reasoning_tokens??0,totalTokens:(item.prompt_tokens??0)+(item.completion_tokens??0)+(item.reasoning_tokens??0),usageUsd:item.usage??0}));
    provider.activityLast30Days=provider.activity.reduce((sum:number,item:any)=>sum+Number(item.usageUsd||0),0);
    provider.activityTokensLast30Days=provider.activity.reduce((sum:number,item:any)=>sum+Number(item.totalTokens||0),0);
   } else provider.activityError=`Activity API HTTP ${response.status}`;
  } catch {provider.activityError="Could not reach OpenRouter activity API.";}
 }
 return Response.json({checkedAt:new Date().toISOString(),dailyBudgetInr,dailySpendInr:null,dailyRemainingInr:null,dailySpendTracking:"not_available",tokenTracking:"provider_activity_available",provider,note:"OpenRouter reports key-level daily usage and account activity for completed UTC days. The account activity is not necessarily exclusive to UX Audit if the management key/account is shared. Per-request UX Audit spend is not available until its own ledger is added."},{headers:{"Cache-Control":"no-store"}});
}
