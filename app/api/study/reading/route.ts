import { NextResponse } from "next/server";
import { studyOwner } from "@/lib/studyAuth";
import { studyRpc } from "@/lib/studyStore";
import { readJsonBody } from "@/lib/limitedBody";
export async function POST(request:Request) {
 try {
  const user=await studyOwner(request);if(!user)return NextResponse.json({error:"请登录后继续。"},{status:401});
  const b=await readJsonBody<{seconds:unknown;words:unknown;article:unknown;evidenceVersion?:unknown;id?:unknown}>(request,4096);
  if(!Number.isInteger(b.seconds)||Number(b.seconds)<0||Number(b.seconds)>30||!Array.isArray(b.words)||b.words.length>30||!b.words.every(w=>typeof w==="string"&&w.length<=80)||typeof b.article!=="string"||b.article.length>160)return NextResponse.json({error:"阅读记录格式无效。"},{status:400});
  if(b.evidenceVersion===3 && (typeof b.id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.id)))return NextResponse.json({error:"阅读记录标识无效。"},{status:400});
  if(b.evidenceVersion===3)await studyRpc("reading_tick_v3",{p_user:user,p_seconds:b.seconds,p_words:b.words,p_article:b.article,p_id:b.id});
  else await studyRpc(b.evidenceVersion===2?"reading_tick_v2":"reading_tick",{p_user:user,p_seconds:b.seconds,p_words:b.words,p_article:b.article});
  return NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
 }catch{return NextResponse.json({error:"阅读证据暂未保存。"},{status:503});}
}
