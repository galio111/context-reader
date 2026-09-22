export const MODEL_CATALOG = [
  {id:'deepseek-flash', label:'DeepSeek Flash', provider:'deepseek', vision:true},
  {id:'deepseek-v4-pro', label:'DeepSeek Pro', provider:'deepseek', vision:false},
  {id:'glm-4.5-air', label:'智谱 GLM-4.5-Air', provider:'zhipu', vision:false},
  {id:'mimo-v2.6-flash', label:'小米 MiMo V2.6 Flash', provider:'mimo', vision:true},
  {id:'jev-latest', label:'Jev（文字判断）', provider:'jev', vision:false},
] as const;
export type ModelId = typeof MODEL_CATALOG[number]['id'];
export const MODEL_FEATURES = {lookup:'划词解释',dictionary:'单独查词',translation:'全文翻译',summary:'文章摘要',question:'句子追问',classification:'文章分类与难度',editorial:'自动精选综合审核',editorialVision:'自动精选图片检查'} as const;
export type ModelFeature=keyof typeof MODEL_FEATURES;
export type ModelRoute={primary:ModelId;fallback:ModelId|null};
export type ModelConfig={version:1; routes:Record<ModelFeature,ModelRoute>;plans:Record<string,ModelRoute>;jevEnabled:boolean};
export const PLAN_IDS=['guest','free','basic','plus','max','admin'] as const;
export function defaultModelConfig():ModelConfig {
 return {version:1,routes:Object.fromEntries(Object.keys(MODEL_FEATURES).map(k=>[k,{primary:'deepseek-flash',fallback:k.startsWith('editorial')?null:'glm-4.5-air'}])) as ModelConfig['routes'],plans:{},jevEnabled:false};
}
export function validateModelConfig(value:unknown):ModelConfig {
 const p=value as ModelConfig;if(!p||p.version!==1||typeof p.jevEnabled!=='boolean'||!p.routes||!p.plans)throw Error('模型设置格式无效。');
 const route=(r:ModelRoute,vision=false):ModelRoute=>{
  if(!r||!MODEL_CATALOG.some(m=>m.id===r.primary&&m.provider!=='jev'&&(!vision||m.vision))||!(r.fallback===null||MODEL_CATALOG.some(m=>m.id===r.fallback&&m.provider!=='jev'&&(!vision||m.vision)))||r.primary===r.fallback)throw Error('主备模型不能相同；图片检查需选择支持图片的模型。');
  return {primary:r.primary,fallback:r.fallback};
 };
 const routes=Object.fromEntries(Object.keys(MODEL_FEATURES).map(k=>[k,route(p.routes[k as ModelFeature],k==='editorialVision')])) as ModelConfig['routes'];
 const plans:ModelConfig['plans']={};for(const [k,v] of Object.entries(p.plans)){if(!PLAN_IDS.includes(k as typeof PLAN_IDS[number]))throw Error('套餐无效。');plans[k]=route(v);}
 return {version:1,routes,plans,jevEnabled:p.jevEnabled};
}
