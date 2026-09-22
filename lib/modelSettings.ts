import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultModelConfig,validateModelConfig,type ModelConfig,type ModelFeature,type ModelId,MODEL_CATALOG } from './modelCatalog';
import { readDiscoverySetting } from './discoveryStore';
export const MODEL_SETTINGS_KEY='ai_model_routes_v1';
const context=new AsyncLocalStorage<{feature:ModelFeature;plan:string;config?:ModelConfig}>();
export function withModelContext<T>(feature:ModelFeature,fn:()=>T,config?:ModelConfig){return context.run({feature,plan:'guest',config},fn);}
export function setModelPlan(plan:string){const c=context.getStore();if(c)c.plan=plan;}
export function environmentModelDefaults(){
 const config=defaultModelConfig();
 const names:Partial<Record<ModelFeature,string>>={lookup:'DEEPSEEK_LOOKUP_MODEL',dictionary:'DEEPSEEK_DICTIONARY_MODEL',translation:'DEEPSEEK_TRANSLATION_MODEL',summary:'DEEPSEEK_SUMMARY_MODEL',question:'DEEPSEEK_LOOKUP_MODEL',classification:'DEEPSEEK_CLASSIFICATION_MODEL'};
 for(const [feature,name] of Object.entries(names)){const id=process.env[name];if(MODEL_CATALOG.some(m=>m.id===id&&m.provider!=='jev'))config.routes[feature as ModelFeature].primary=id as ModelId;}
 for(const route of Object.values(config.routes))if(route.primary===route.fallback||process.env.ZHIPU_FALLBACK_ENABLED==='false')route.fallback=null;
 return config;
}
export async function getModelConfig():Promise<ModelConfig>{
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY)return environmentModelDefaults();
 return validateModelConfig(await readDiscoverySetting(MODEL_SETTINGS_KEY,environmentModelDefaults()));
}
export async function resolveModelRoute(feature:ModelFeature='lookup') {
 const c=context.getStore(); const cfg=c?.config||await getModelConfig();if(c)c.config=cfg;
 return cfg.plans[c?.plan||''] || cfg.routes[c?.feature||feature];
}
export function modelCredentials(model:ModelId){
 const provider=MODEL_CATALOG.find(m=>m.id===model)!.provider;
 const env=provider==='deepseek'?'DEEPSEEK':provider==='zhipu'?'ZHIPU':provider==='mimo'?'MIMO':'TYPESAFE';
 const base=provider==='deepseek'?'https://api.deepseek.com':provider==='zhipu'?'https://open.bigmodel.cn/api/paas/v4':provider==='mimo'?'https://api.xiaomimimo.com/v1':'https://api.typesafe.ai/v1';
 return {provider,key:process.env[env+'_API_KEY']?.trim()||'',url:(process.env[env+'_BASE_URL']||base).replace(/\/$/,'')+(provider==='jev'?'/systemone':'/chat/completions')};
}
// Legacy prompt builders still accept a key; actual credentials are resolved by transport.
export function anyTextKey(){return process.env.DEEPSEEK_API_KEY||process.env.ZHIPU_API_KEY||process.env.MIMO_API_KEY||'';}
export function modelBody(model:ModelId,body:Record<string,unknown>){
 const next:Record<string,unknown>={...body,model,thinking:{type:'disabled'}};delete next['user_id'];
 if(model.startsWith('mimo-')){next['max_completion_tokens']=next['max_tokens'];delete next['max_tokens'];delete next['stream_options'];}
 return next;
}
