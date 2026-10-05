import "server-only";
import { getAuthenticatedUser } from "@/lib/userAuth";
import { accountFetch } from "@/lib/accountStore";
import { requestExternalOrigin } from "@/lib/requestSecurity";
export async function studyOwner(request: Request) {
 const user=await getAuthenticatedUser();
 if(!user) return null;
 if(request.headers.get("X-Context-Account")&&request.headers.get("X-Context-Account")!==user.id) return null;
 if(request.method!=="GET"&&request.headers.get("origin")!==requestExternalOrigin(request)) return null;
 const rows=await accountFetch<Array<{status:string}>>("account_profiles?user_id=eq."+encodeURIComponent(user.id)+"&select=status&limit=1");
 return rows[0]?.status==="active"?user.id:null;
}
