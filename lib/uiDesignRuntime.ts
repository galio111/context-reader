import {UI_TARGETS,UI_DESIGN_TARGET_RULES} from './uiDesignRegistry';
import {validateUiDesignRecipe,type UiDesignRecipe,type UiVisualPatch} from './uiDesign';
const fonts={system:'system-ui,"PingFang SC","Microsoft YaHei",sans-serif',serif:'Georgia,"Noto Serif CJK SC",SimSun,serif',mono:'"Cascadia Code",Consolas,"Microsoft YaHei",monospace'};
export function uiPatchCss(p:UiVisualPatch){
 const d:string[]=[];const put=(k:string,v:string|number|undefined)=>{if(v!==undefined)d.push(`${k}:${v}!important`);};
 put('--ui-accent',p.accent);put('background-color',p.background);put('color',p.textColor);
 if(p.accent){put('--pc-accent',p.accent);put('--gm-color',p.accent);}
 if(p.font)put('font-family',fonts[p.font]);
 const px={fontSize:'font-size',radius:'border-radius',padding:'padding',gap:'gap',width:'width',maxWidth:'max-width'} as const;
 for(const [key,prop] of Object.entries(px)){const v=p[key as keyof typeof px];if(v!==undefined)put(prop,v+'px');}
 if(p.offsetX!==undefined||p.offsetY!==undefined)put('translate',`${p.offsetX??0}px ${p.offsetY??0}px`);
 put('order',p.order);put('opacity',p.opacity);
 if(p.motion&&p.motion!=='none')put('animation',`ui-design-${p.motion} ${p.motionDuration??600}ms cubic-bezier(.2,.7,.2,1) both`);
 if(p.motion==='none')put('animation','none');return d.join(';');
}
export function compileUiDesign(input:UiDesignRecipe){
 const recipe=validateUiDesignRecipe(input,UI_DESIGN_TARGET_RULES),desktop:string[]=[],mobile:string[]=[],reduced:string[]=[];
 for(const [id,p] of Object.entries(recipe.targets)){
  const selector=id==='site-background'?'body':UI_TARGETS.find(t=>t.id===id)?.selector;if(!selector)continue;
  const scope=`html:not([data-ui-studio-host]) :is(${selector}):is(${selector}):is(${selector})`;const {mobile:m,...base}=p;
  const {offsetX:x,offsetY:y,width:w,maxWidth:mw,order:o,...shared}=base;
  desktop.push(`${scope}{${uiPatchCss(shared)}}`);
  if(x!==undefined||y!==undefined||w!==undefined||mw!==undefined||o!==undefined)desktop.push(`@media(min-width:701px){${scope}{${uiPatchCss({offsetX:x,offsetY:y,width:w,maxWidth:mw,order:o})}}}`);
  if(m)mobile.push(`${scope}{${uiPatchCss(m)}}`);
  if(p.motion||m?.motion)reduced.push(`${scope}{animation:none!important}`);
 }
 return desktop.join('\n')+`\n@media(max-width:700px){${mobile.join('\n')}}@keyframes ui-design-fade{from{opacity:0}to{opacity:1}}@keyframes ui-design-rise{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}@keyframes ui-design-scale{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}@media(prefers-reduced-motion:reduce){${reduced.join('\n')}}`;
}
export interface GalioItem{id:string;title:string;category:string;module:string;variant:string;source?:{name:string;url:string};summary?:string;defaultDuration?:number}
export interface GalioHandle{ready:Promise<unknown>;update:(v:Record<string,unknown>)=>void;destroy:()=>void;replay:()=>void}
export interface GalioSdk{loadComponentCatalog:()=>Promise<GalioItem[]>;createComponent:(node:HTMLElement,item:GalioItem,input:Record<string,unknown>,options?:{enhance:boolean})=>GalioHandle}
let sdk:Promise<GalioSdk>|undefined,catalog:Promise<GalioItem[]>|undefined;
export function loadGalio(){const path='/galio/sdk/components.js';return sdk??=import(/* webpackIgnore: true */ path) as Promise<GalioSdk>;}
export function loadGalioCatalog(){return catalog??=loadGalio().then(m=>m.loadComponentCatalog());}
export function galioOptions(p:UiVisualPatch){return {...p,material:p.material??'original',fontSize:p.fontSize??16,reducedMotion:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches,font:p.font==='serif'?'reading':p.font??'system',accent:p.accent??'#292c30',radius:p.radius??12,duration:p.motionDuration??800};}
export function mountUiDesign(recipe:UiDesignRecipe,onError?:(message:string)=>void){
 let disposed=false,scanning=false,scanAgain=false;const handles=new Map<HTMLElement,{key:string;componentId?:string;handle:GalioHandle}>();let timer:ReturnType<typeof setTimeout>|undefined;
 const style=document.createElement('style');style.dataset.uiDesign='runtime';style.textContent=compileUiDesign(recipe);document.head.append(style);
 async function scan(){
  if(disposed)return;if(scanning){scanAgain=true;return;}scanning=true;
  try{const entries=Object.entries(recipe.targets);const needs=entries.some(([,p])=>Object.hasOwn(p,'componentId')||Object.hasOwn(p,'material')||p.mobile?.componentId||p.mobile?.material)?entries:[];
   if(!needs.length){handles.forEach(h=>h.handle.destroy());handles.clear();return;}const [module,items]=await Promise.all([loadGalio(),loadGalioCatalog()]);if(disposed)return;
   const desired=new Map<HTMLElement,{p:UiVisualPatch;key:string;component:GalioItem|undefined}>();
   for(const [id,base] of needs.sort(([a],[b])=>Number(!a.startsWith('global.'))-Number(!b.startsWith('global.')))){const target=UI_TARGETS.find(t=>t.id===id);if(!target?.selector)continue;
    const p={...base,...(matchMedia('(max-width:700px)').matches?base.mobile:{})};
    for(const node of document.querySelectorAll<HTMLElement>(target.selector)){
     if(!node.matches('button,a,[role="button"]')||node.closest('[data-ui-editor]'))continue;
     const combined={...desired.get(node)?.p,...p};desired.set(node,{p:combined,key:JSON.stringify(galioOptions(combined)),component:items.find(c=>c.id===combined.componentId)});
    }
   }
   for(const [node,{p,key,component}] of desired){
     const prior=handles.get(node);if(prior&&prior.componentId===component?.id&&(!component||node.querySelector('.gc-decoration'))){if(prior.key!==key){prior.handle.update(galioOptions(p));prior.key=key;}continue;}prior?.handle.destroy();
     if(component){const handle=module.createComponent(node,component,galioOptions(p),{enhance:true});handles.set(node,{key,componentId:component.id,handle});void handle.ready.catch(()=>onError?.('这个样式未能加载，请重试。'));}
     else{const path='/galio/sdk/materials.js';const materials=await import(/* webpackIgnore: true */ path) as {mountMaterial:(n:HTMLElement,i:{category:string},o:Record<string,unknown>,e:boolean)=>{destroy:()=>void;update:(v:Record<string,unknown>)=>void}};if(disposed)return;
      if(!document.querySelector('link[data-ui-materials]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/galio/studio/components/materials.css';link.dataset.uiMaterials='';document.head.append(link);}
      const h=materials.mountMaterial(node,{category:'buttons'},galioOptions(p),true);handles.set(node,{key,handle:{...h,ready:Promise.resolve(),replay(){}}});}
   }
   for(const [node,h] of handles)if(!node.isConnected||!desired.has(node)){h.handle.destroy();handles.delete(node);}
  }finally{scanning=false;if(scanAgain&&!disposed){scanAgain=false;schedule();}}
 }
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{void scan().catch(()=>onError?.('组件样式暂时无法加载。'));},80);};
 const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('resize',schedule);const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');motionQuery.addEventListener('change',schedule);schedule();
 const dispose=()=>{disposed=true;clearTimeout(timer);observer.disconnect();window.removeEventListener('resize',schedule);motionQuery.removeEventListener('change',schedule);style.remove();handles.forEach(h=>h.handle.destroy());handles.clear();};
 dispose.update=(next:UiDesignRecipe)=>{recipe=next;style.textContent=compileUiDesign(next);schedule();};return dispose;
}
