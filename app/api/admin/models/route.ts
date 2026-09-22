import {NextResponse} from 'next/server';
import {isAdminRequest} from '@/lib/adminAuth';
import {readJsonBody} from '@/lib/limitedBody';
import {requestExternalOrigin} from '@/lib/requestSecurity';
import {getModelConfig,MODEL_SETTINGS_KEY,modelCredentials} from '@/lib/modelSettings';
import {MODEL_CATALOG,PLAN_IDS,validateModelConfig,type ModelId} from '@/lib/modelCatalog';
import {modelStatuses,probeModel} from '@/lib/modelHealth';
import {withDiscoveryLease,writeDiscoverySetting} from '@/lib/discoveryStore';
export async function GET(request:Request){
 if(!await isAdminRequest())return NextResponse.json({error:'需要管理员权限。'},{status:401});
 try{return NextResponse.json({config:await getModelConfig(),models:new URL(request.url).searchParams.has("config")?[]:await modelStatuses()},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'模型设置读取失败，请重试。'},{status:503});}
}
async function authorize(request:Request){
 if(!await isAdminRequest())return NextResponse.json({error:'需要管理员权限。'},{status:401});
 if(request.headers.get('origin')!==requestExternalOrigin(request))return NextResponse.json({error:'请从本站后台操作。'},{status:403});
 return null;
}
export async function PATCH(request:Request){
 const denied=await authorize(request);if(denied)return denied;
 const p=await readJsonBody<Record<string,unknown>>(request,12000).catch(()=>null);if(!p)return NextResponse.json({error:'设置无效。'},{status:400});
 try{
 let config;await withDiscoveryLease(async()=>{
  const old=await getModelConfig();
  const plans={...old.plans};if(p.planId!==undefined){if(typeof p.planId!=='string'||!PLAN_IDS.includes(p.planId as typeof PLAN_IDS[number]))throw Error('套餐无效。');if(p.planRoute===null)delete plans[p.planId];else plans[p.planId]=p.planRoute as typeof plans[string];}
  config=validateModelConfig({...old,...(p.routes?{routes:p.routes}:{}),...(p.jevEnabled!==undefined?{jevEnabled:p.jevEnabled}:{}),plans});
  // Save defaults without demanding unused keys, but newly selected providers must exist.
  const changed=[...Object.entries(config.routes).flatMap(([k,r])=>JSON.stringify(r)!==JSON.stringify(old.routes[k as keyof typeof old.routes])?[r.primary,r.fallback]:[]),...(p.planId&&p.planRoute?[(p.planRoute as {primary:ModelId}).primary,(p.planRoute as {fallback:ModelId|null}).fallback]:[])];
  if(config.jevEnabled&&!modelCredentials('jev-latest').key)throw Error('请先配置 TypeSafe 官方密钥再启用 Jev。');
  for(const m of changed)if(m&&!modelCredentials(m).key)throw Error('所选模型尚未配置密钥，请先配置并测试。');
  await writeDiscoverySetting(MODEL_SETTINGS_KEY,config);
 });return NextResponse.json({config});
 }catch(e){const message=e instanceof Error?e.message:'';return NextResponse.json({error:/模型|套餐|密钥|主备|图片|抓取/.test(message)?message:'保存失败，请重试。'},{status:message.includes('抓取')?409:400});}
}
let lastProbe=0;
export async function POST(request:Request){
 const denied=await authorize(request);if(denied)return denied;
 const p=await readJsonBody<{model:ModelId}>(request,1024).catch(()=>null);
 if(!p||!MODEL_CATALOG.some(m=>m.id===p.model))return NextResponse.json({error:'请选择有效模型。'},{status:400});
 if(Date.now()-lastProbe<5000)return NextResponse.json({error:'请稍后再测试。'},{status:429});lastProbe=Date.now();
 try{return NextResponse.json({probe:await probeModel(p.model),models:await modelStatuses()});}catch{return NextResponse.json({error:'未配置密钥或测试失败。'},{status:400});}
}
