import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { accountFetch } from "@/lib/accountStore";
import { getStudyPolicy } from "@/lib/studyStore";
import { readJsonBody } from "@/lib/limitedBody";
import { validateStudyPolicy } from "@/lib/studyPolicy";
import { requestExternalOrigin } from "@/lib/requestSecurity";
export async function GET() {
 if(!await isAdminRequest())return NextResponse.json({error:"无管理员权限。"},{status:401});
 try{return NextResponse.json({policy:await getStudyPolicy()},{headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({error:"复习配置暂时不可用。"},{status:503});}
}
export async function POST(request:Request) {
 if(!await isAdminRequest())return NextResponse.json({error:"无管理员权限。"},{status:401});
 if(request.headers.get("origin")!==requestExternalOrigin(request))return NextResponse.json({error:"请在本站修改配置。"},{status:403});
 try{
  const policy=validateStudyPolicy(await readJsonBody<unknown>(request,8192));
  await accountFetch("study_policy?id=eq.true",{method:"PATCH",body:JSON.stringify({policy})});
  await accountFetch("admin_audit_logs",{method:"POST",body:JSON.stringify({admin_label:"verified-admin",action:"study_policy",target_type:"study",target_id:"policy",after_value:policy})});
  return NextResponse.json({policy});
 }catch{return NextResponse.json({error:"设置未保存，请检查数值范围并重试。"},{status:400});}
}
