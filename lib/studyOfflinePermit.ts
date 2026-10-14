import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
function signature(value:string){const secret=process.env.ADMIN_SESSION_SECRET;if(!secret)throw new Error("Study signing secret unavailable");return createHmac("sha256",secret).update("study-offline-v1:"+value).digest("base64url");}
export function issueStudyOfflinePermit(owner:string,now=Date.now()){
  const body=Buffer.from(JSON.stringify({owner,issued:now})).toString("base64url");return body+"."+signature(body);
}
export function verifyStudyOfflinePermit(token:string,owner:string,at:string,now=Date.now()){
  try{const [body,mac,...extra]=token.split(".");if(extra.length||!body||!mac)return false;
    const expected=Buffer.from(signature(body)),actual=Buffer.from(mac);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return false;
    const data=JSON.parse(Buffer.from(body,"base64url").toString());const time=Date.parse(at);
    return data.owner===owner&&Number.isFinite(time)&&time>=data.issued-300000&&time<=now+300000;
  }catch{return false;}
}
