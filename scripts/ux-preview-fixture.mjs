// Loopback-only backend fixture for the developer preview browser regression.
import http from "node:http";
const plans={guest:0,free:0,basic:12,plus:24,max:48};
http.createServer((req,res)=>{
 const url=new URL(req.url,"http://127.0.0.1");
 const plan=(url.searchParams.get("id")||url.searchParams.get("plan_id")||"eq.free").slice(3);
 let data=[];
 if(url.pathname.endsWith("/user_entitlements"))data=[{plan_id:"admin",source:"admin",starts_at:"2026-01-01T00:00:00Z",ends_at:null}];
 if(url.pathname.endsWith("/account_profiles"))data=[{status:"active"}];
 if(url.pathname.endsWith("/quota_plans"))data=[{id:plan,display_name:plan,active:true,price_cny:plans[plan]}];
 if(url.pathname.endsWith("/quota_plan_limits"))data=plan==="guest"?["guest_article_lookup","guest_dictionary_lookup","guest_text_import","guest_url_import"].map((metric_key,i)=>({plan_id:plan,metric_key,allowance:[10,5,2,2][i],window_type:"day"})):[{plan_id:plan,metric_key:"learning_points",allowance:plan==="free"?50:1200,window_type:"month"}];
 res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(data));
}).listen(3212,"127.0.0.1",()=>console.log("UX test fixture on loopback 3212"));
