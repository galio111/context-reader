import { readDiscoverySetting,writeDiscoverySetting } from './discoveryStore';
import { MODEL_CATALOG,type ModelId } from './modelCatalog';
import { modelCredentials,modelBody } from './modelSettings';
import {recordSystemUsageExecution} from './accountStore';
import {estimateDeepSeekCostMicrousd} from './usageCost';
type Observation={at:string;ok:boolean;status:number;latencyMs:number;label:string};
export async function recordModelHealth(model:string,status:number,latencyMs:number){
 const label=status===200?'最近调用成功':status===401||status===403?'密钥或权限错误':status===402?'余额不足':status===429?'限流或繁忙':status===0?'连接失败或超时':'服务异常';
 if(process.env.SUPABASE_SERVICE_ROLE_KEY)await writeDiscoverySetting('ai_model_health_'+model,{at:new Date().toISOString(),ok:status===200,status,latencyMs,label}).catch(()=>undefined);
}
export async function modelStatuses(){
 let balance:unknown=null;
 const ds=modelCredentials('deepseek-flash');
 if(ds.key)try{const r=await fetch(ds.url.replace('/chat/completions','/user/balance'),{headers:{Authorization:`Bearer ${ds.key}`},signal:AbortSignal.timeout(5000)});if(r.ok){const p=await r.json();balance={available:p.is_available,items:p.balance_infos,checkedAt:new Date().toISOString()};}}catch{}
 return Promise.all(MODEL_CATALOG.map(async m=>{
  const configured=!!modelCredentials(m.id).key;
  const observed=process.env.SUPABASE_SERVICE_ROLE_KEY?await readDiscoverySetting<Observation|null>('ai_model_health_'+m.id,null):null;
  const fresh=!!observed&&Date.now()-Date.parse(observed.at)<10*60_000;
  const empty=m.provider==='deepseek'&&(balance as {available?:boolean}|null)?.available===false;
  return {...m,configured,indicator:!configured||empty||(fresh&&!observed!.ok)?'red':fresh&&observed!.ok?'green':'unknown',label:!configured?'未配置密钥':empty?'余额不足':fresh?observed!.label:'尚未验证或结果已过期',observed,balance:m.provider==='deepseek'?balance:null,balanceNote:m.provider==='deepseek'?'接口查询失败时显示未知':'未确认公开余额接口，请在供应商控制台查看'};
 }));
}
export async function probeModel(model:ModelId){
 const c=modelCredentials(model);if(!c.key)throw Error('请先配置该模型密钥。');const start=Date.now();
 try{const response=await fetch(c.url,{method:'POST',headers:{Authorization:`Bearer ${c.key}`,'Content-Type':'application/json'},body:JSON.stringify(c.provider==='jev'?{model,state:'The sky is blue.',questions:{test:{type:'noul',instructions:'The text mentions the sky.'}}}:modelBody(model,{messages:[{role:'user',content:'Reply OK.'}],max_tokens:16})),signal:AbortSignal.timeout(25000)});
 const p=await response.json().catch(()=>null);const valid=response.ok&&(c.provider==='jev'?Number.isFinite(p?.answers?.test?.noul):!!p?.choices?.[0]?.message?.content);
 const usage=c.provider==='jev'?{prompt_tokens:p?.usage?.input_tokens,completion_tokens:p?.usage?.output_tokens}:p?.usage||{};
 await recordSystemUsageExecution({feature:'model_connection_test',route:'/api/admin/models',provider:c.provider,model,promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,estimatedCostMicrousd:estimateDeepSeekCostMicrousd(model,usage),status:valid?'succeeded':'failed'}).catch(()=>undefined);
 await recordModelHealth(model,valid?200:response.ok?502:response.status,Date.now()-start);return {ok:valid,status:response.status};
 }catch{await recordModelHealth(model,0,Date.now()-start);return {ok:false,status:0};}
}
