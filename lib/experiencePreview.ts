import type { AccountPlan, AccountSessionState } from "@/types/account";
import { DEFAULT_STUDY_POLICY } from "./studyPolicy";
import { quotaExhaustedMessage } from "./usagePresentation";
import { addMemberMonths } from "./billingPolicy";

export const PREVIEW_OWNER = "00000000-0000-4000-8000-000000000012";
export type PreviewBalance = "available" | "low" | "empty";
export function previewAccount(plan: AccountPlan, balance: PreviewBalance, now = new Date()): AccountSessionState {
  const shanghai = new Date(now.getTime()+8*3600000);
  const dayEnd = new Date(Date.UTC(shanghai.getUTCFullYear(),shanghai.getUTCMonth(),shanghai.getUTCDate()+1)-8*3600000).toISOString();
  const monthEnd = plan.id==="free" ? new Date(Date.UTC(shanghai.getUTCFullYear(),shanghai.getUTCMonth()+1,1)-8*3600000).toISOString() : addMemberMonths(now.toISOString(),1);
  return { configured:true, authenticated:plan.id!=="guest", plan,
    profile:plan.id==="guest"?null:{userId:PREVIEW_OWNER,email:"",phone:"13800000000",loginMethod:"phone_pin",phoneVerified:false,nickname:"体验账号",avatarUrl:"",englishLevel:"六级",learningGoal:"",status:"active",readingInterests:[]},
    usage:plan.limits.map(limit=>{const remaining=balance==="empty"?0:balance==="low"?Math.max(1,Math.floor(limit.allowance*.04)):limit.allowance;return {metricKey:limit.metricKey,allowance:limit.allowance,remaining:Math.min(limit.allowance,remaining),used:Math.max(0,limit.allowance-remaining),windowEnd:limit.windowType==="day"?dayEnd:monthEnd};}) };
}
class PreviewStorage implements Storage {
  private values=new Map<string,string>();
  get length(){return this.values.size;}
  key(index:number){return [...this.values.keys()][index]??null;}
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){this.values.set(key,String(value));}
  removeItem(key:string){this.values.delete(key);}
  clear(){this.values.clear();}
}
export function experiencePreviewStorage(): Storage | undefined {
  return typeof window==="undefined"?undefined:(window as Window & {__contextPreviewStorage?:Storage}).__contextPreviewStorage;
}
export function navigateExperiencePreview(href: string): boolean {
  if (!experiencePreviewStorage()) return false;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return true;
  const screen = url.pathname === "/" ? (url.searchParams.get("menu") === "account" ? "account" : "home")
    : url.pathname === "/account" || url.pathname === "/account/usage" ? "account"
    : url.pathname === "/billing" ? "billing" : null;
  if (screen) {
    const query = new URLSearchParams(location.search); query.set("screen", screen);
    location.href = (location.pathname==='/admin/ui-studio/frame'?location.pathname:'/admin/experience/frame')+"?" + query.toString();
  } else if (url.pathname === "/study") window.dispatchEvent(new CustomEvent("context-reader-open-study"));
  return true;
}
/** Installs only inside the developer-authorized preview iframe. Unknown APIs fail closed. */
export function installExperiencePreview(account: AccountSessionState) {
  const target=window as Window & {__contextPreviewStorage?:Storage};
  const local=new PreviewStorage(),session=new PreviewStorage();
  const localDescriptor=Object.getOwnPropertyDescriptor(window,"localStorage")!,sessionDescriptor=Object.getOwnPropertyDescriptor(window,"sessionStorage")!;
  const nativeFetch=window.fetch.bind(window);
  target.__contextPreviewStorage=local;
  Object.defineProperty(window,"localStorage",{configurable:true,get:()=>local});
  Object.defineProperty(window,"sessionStorage",{configurable:true,get:()=>session});
  const json=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}}));
  const navigate=(event:MouseEvent)=>{
    const anchor=(event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement|null;
    if(!anchor)return;const url=new URL(anchor.href,location.href);
    if(url.origin===location.origin&&url.pathname===location.pathname&&url.search===location.search&&url.hash)return;
    const screen=url.pathname==="/"?"home":url.pathname==="/account"||url.pathname==="/account/usage"?"account":url.pathname==="/billing"?"billing":null;
    event.preventDefault();event.stopPropagation();
    if(url.origin===location.origin&&screen){const query=new URLSearchParams(location.search);query.set("screen",screen);location.href=location.pathname+"?"+query.toString();}
    else if(url.pathname==="/study")window.dispatchEvent(new CustomEvent("context-reader-open-study"));
  };
  document.addEventListener("click",navigate,true);
  window.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    const method=(init?.method||(input instanceof Request?input.method:"GET")).toUpperCase(),path=url.pathname;
    if(url.origin!==location.origin)return json({error:"体验预览不会发送外部请求。"},403);
    if(method==='GET'&&path.startsWith('/galio/'))return nativeFetch(input,init);
    if(path==="/api/auth/session")return json({account});
    if(path==="/api/admin/session")return json({authenticated:false,accessMode:null});
    if(path==="/api/account/sync")return json({objects:[],results:[],nextOffset:null,snapshotCursor:"",nextCursor:"",hasMore:false,protocol:2});
    if(path==="/api/study/profile")return json({activeSeconds:0,uniqueLookups:0,eligible:false});
    if(path==="/api/study") {
      const body=typeof init?.body==="string"?JSON.parse(init.body):{};
      if(method==="GET"||body.op==="start"||body.op==="prepare")return json({serverNow:new Date().toISOString(),settings:{reviewsPerDay:100,retention:.9,forgotMinutes:5,unsureMinutes:10,pausedUntil:null,reminders:false,includeAnki:false},cards:[],entries:[],today:null,reviews:[],daily:[],policy:DEFAULT_STUDY_POLICY,streak:{current:0,best:0,last_day:null},rewards:[],claims:[]});
    }
    if(path==="/api/account/activity")return json(method==="GET"?{seconds:0,todaySeconds:0,readingDays:0,since:new Date().toISOString()}:{ok:true});
    if(path==="/api/billing"&&method==="GET"){
      const response=await nativeFetch("/api/billing",{credentials:"omit"});const value=await response.json();
      return json({...value,membership:null,orders:[]});
    }
    if(method==="GET"&&(/^\/api\/public-articles(?:\/|$)/.test(path)||/^\/api\/cet(?:\/|$)/.test(path)||path==="/api/connectivity"))return nativeFetch(input,init);
    const metric=path.includes("dictionary")?"guest_dictionary_lookup":path.includes("guest-import")?"guest_text_import":"guest_article_lookup";
    const usage=account.usage.find(u=>u.metricKey===(account.authenticated?"learning_points":metric));
    if(usage&&usage.remaining===0&&!path.startsWith("/api/account")&&!path.startsWith("/api/auth"))return json({error:quotaExhaustedMessage({...usage,authenticated:account.authenticated}),code:"quota_exhausted",quota:{...usage,authenticated:account.authenticated}},429);
    if(path==="/api/usage/guest-import")return json({ok:true,allowed:true});
    return json({error:"这是界面体验预览，生成、保存和支付请返回正式界面操作。",code:"preview_read_only"},403);
  };
  return()=>{document.removeEventListener("click",navigate,true);window.fetch=nativeFetch;Object.defineProperty(window,"localStorage",localDescriptor);Object.defineProperty(window,"sessionStorage",sessionDescriptor);delete target.__contextPreviewStorage;};
}
