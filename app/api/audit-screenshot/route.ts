import { createAuditFromScreenshot, type AuditStage, type AuditResult } from "@/lib/audit";
import { saveAudit } from "@/lib/knowledge-base";
export const runtime="nodejs";
export const maxDuration=60;
function send(c:ReadableStreamDefaultController<Uint8Array>,payload:unknown){c.enqueue(new TextEncoder().encode("data: "+JSON.stringify(payload)+"\n\n"));}
function parseImage(value:unknown):{mime:string;bytes:Buffer}|null{if(typeof value!=="string")return null;const m=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);return m?{mime:"image/"+m[1],bytes:Buffer.from(m[2],"base64")}:null;}
export async function POST(request:Request){
 let body:any;try{body=await request.json()}catch{return Response.json({error:"Invalid screenshot audit request."},{status:400});}
 let target:URL;try{target=new URL(body?.url)}catch{return Response.json({error:"A valid page URL is required."},{status:400});}
 if(!["http:","https:"].includes(target.protocol))return Response.json({error:"Only HTTP/HTTPS URLs can be audited."},{status:400});
 const parsed=parseImage(body?.screenshot);if(!parsed||!parsed.bytes.length)return Response.json({error:"Captured screenshot is missing or invalid."},{status:400});if(parsed.bytes.length>4200000)return Response.json({error:"Screenshot is too large; keep each page image under 4 MB."},{status:413});
 const mode=body.auditMode==="mobile"?"mobile":"desktop";const viewportWidth=mode==="mobile"?393:1440;const viewportHeight=mode==="mobile"?852:900;const title=typeof body.title==="string"&&body.title.trim()?body.title.trim().slice(0,160):(target.pathname==="/"?"Homepage":target.pathname.split("/").filter(Boolean).pop()?.replace(/[-_]/g," ")||target.hostname);const project=typeof body.projectName==="string"&&body.projectName.trim()?body.projectName.trim().slice(0,180):target.hostname;
 const stream=new ReadableStream<Uint8Array>({start(controller){void(async()=>{try{
  const stage=(s:AuditStage)=>send(controller,{type:"stage",stage:s});
  stage({id:"capture",label:"Prepare screenshot",detail:"Validating screenshot evidence for "+title+".",status:"complete"});
  stage({id:"analyse",label:"Analyse screenshot",detail:"Running the current UX Audit vision and reasoning pipeline.",status:"active"});
  let result:AuditResult=await createAuditFromScreenshot(parsed.bytes,title+".jpg",stage);
  let page=result.pages[0];if(!page)throw new Error("The audit pipeline returned no page result.");
  const createdAt=new Date().toISOString();page.clientName=project;page.url=target.href;page.title=title;page.auditMode=mode;page.viewportWidth=viewportWidth;page.viewportHeight=viewportHeight;page.createdAt=createdAt;
  stage({id:"save",label:"Save audit report",detail:"Saving the page audit to the UX Audit knowledge base.",status:"active"});
  const auditId=await saveAudit(result,"URL audit · "+project+" · "+title);
  stage({id:"save",label:"Save audit report",detail:"Audit report saved successfully.",status:"complete"});
  send(controller,{type:"result",payload:{page:result.pages[0],auditId}});
 }catch(e){const message=e instanceof Error?e.message:"AI screenshot analysis failed.";console.error("[uxaudit] audit_screenshot_failed",JSON.stringify({host:target.hostname,error:message}));send(controller,{type:"error",error:message});}finally{controller.close();}})();}});
 return new Response(stream,{headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-transform",Connection:"keep-alive","X-Accel-Buffering":"no"}});
}
