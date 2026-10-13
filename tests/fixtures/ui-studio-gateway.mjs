/** Loopback-only fake database for browser QA. Never used by the application. */
import http from 'node:http';
const empty=()=>({version:1,targets:{}});let state={version:1,revision:0,publishedRevision:0,draft:empty(),published:empty(),previous:null,updatedAt:null,publishedAt:null};
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1'),p=u.pathname.split('/').at(-1);let value=[];let body='';for await(const chunk of req)body+=chunk;
 if(p==='user_entitlements')value=[{plan_id:'admin',source:'qa',starts_at:null,ends_at:null}];
 if(p==='account_profiles')value=[{status:'active',nickname:'UI QA'}];
 if(p==='quota_plans')value=[{id:u.searchParams.get('id')?.replace('eq.','')??'plus',display_name:'Plus',price_cny:20,active:true}];
 if(p==='quota_plan_limits')value=[{metric_key:'learning_points',allowance:500,window_type:'month'}];
 if(p==='account_settings')value=u.searchParams.get('key')==='eq.ui_design_v1'?[{value:state}]:[];
 if(p==='mutate_ui_design_v1'){
  const b=JSON.parse(body);if(b.p_expected_revision!==state.revision)value={status:'conflict',state};else{
   const action=b.p_action,recipe=action==='save'?b.p_recipe:action==='publish'?state.draft:state.previous;
   if(!recipe)value={status:'no-previous',state};else if(JSON.stringify(recipe)===JSON.stringify(action==='save'?state.draft:state.published))value={status:'unchanged',state};else{
    state={...state,revision:state.revision+1,updatedAt:new Date().toISOString()};
    if(action==='save')state.draft=recipe;else{state.previous=state.published;state.published=recipe;state.publishedRevision=state.revision;state.publishedAt=state.updatedAt;}
    value={status:action==='save'?'saved':action==='publish'?'published':'rolled-back',state};
   }
  }
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
}).listen(3392,'127.0.0.1',()=>console.log('UI studio QA gateway 3392'));
