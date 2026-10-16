export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 const key=(process.env.OPENROUTER_API_KEY??"").trim();
 if(!key)return Response.json({connected:false,provider:"OpenRouter",error:"OPENROUTER_API_KEY is not configured on the server."},{status:503,headers:{"Cache-Control":"no-store"}});
 try{
  const response=await fetch("https://openrouter.ai/api/v1/key",{headers:{authorization:"Bearer "+key},signal:AbortSignal.timeout(8000),cache:"no-store"});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)return Response.json({connected:false,provider:"OpenRouter",error:response.status===401?"OpenRouter rejected or did not receive the configured API key. Re-save OPENROUTER_API_KEY in Netlify Deploy Preview environment variables and redeploy.":"OpenRouter key check returned HTTP "+response.status+"."},{status:503,headers:{"Cache-Control":"no-store"}});
  return Response.json({connected:true,provider:"OpenRouter",label:typeof payload?.data?.label==="string"?payload.data.label:undefined,checkedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({connected:false,provider:"OpenRouter",error:e instanceof Error?e.message:"Could not reach OpenRouter."},{status:503,headers:{"Cache-Control":"no-store"}})}
}
