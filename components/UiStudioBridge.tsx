"use client";
import {useEffect,useRef} from 'react';
import {UI_TARGETS,UI_EFFECTS} from '@/lib/uiInventory';
import {UI_DESIGN_TARGET_RULES,targetRule} from '@/lib/uiDesignRegistry';
import {emptyUiDesignRecipe,validateUiDesignRecipe,type UiDesignRecipe} from '@/lib/uiDesign';
import {mountUiDesign} from '@/lib/uiDesignRuntime';
import {findVisibleUiNode,visibleUiNode,revealUiTarget,prepareUiTarget} from '@/lib/uiDesignNavigation';
const entries=[...UI_TARGETS,...UI_EFFECTS];

export function UiStudioBridge({nonce}:{nonce:string}){
 const overlay=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const send=(type:string,payload:Record<string,unknown>={})=>parent.postMessage({channel:'galio-ui-studio',nonce,type,...payload},location.origin);
  const current:{recipe:UiDesignRecipe;selected:string;editing:boolean}={recipe:emptyUiDesignRecipe(),selected:'',editing:true};
  document.querySelector('style[data-ui-design="initial"]')?.remove();
  const runtime=mountUiDesign(current.recipe,message=>send('error',{message}));
  let seq=-1,raf=0,picked:HTMLElement|null=null,hovered:{id:string;node:HTMLElement}|null=null,revealing=false,locating:AbortController|null=null;
  let drag:{id:string;x:number;y:number;ox:number;oy:number;node:HTMLElement;moved:boolean;pointer:number}|null=null;
  const matches=(node:Element)=>{
   const hits:{id:string;node:HTMLElement}[]=[];
   for(let cursor:Element|null=node;cursor&&cursor!==document.body;cursor=cursor.parentElement){
    for(const t of UI_TARGETS)if(t.status==='live'&&t.selector&&cursor.matches(t.selector)&&visibleUiNode(cursor))hits.push({id:t.id,node:cursor});
   }return hits;
  };
  const select=(id:string,node:HTMLElement,request?:number)=>{current.selected=id;picked=node;hovered=null;const t=entries.find(t=>t.id===id);send('select',{id,request,count:t?.selector?[...document.querySelectorAll(t.selector)].filter(visibleUiNode).length:1,ancestors:matches(node).map(h=>h.id)});};
  const locate=async(id:string,request:number)=>{
   locating?.abort();const controller=new AbortController();locating=controller;
   const t=entries.find(t=>t.id===id);if(!t)return;
   current.editing=true;current.selected=id;picked=null;hovered=null;
   try{
    revealing=true;await prepareUiTarget(id,t.group,t.selector??'',controller.signal);
    let node=t.selector?findVisibleUiNode(t.selector):null;const opened=new Set<string>();
    for(let attempt=0;attempt<35&&!controller.signal.aborted;attempt++){
     node=t.selector?findVisibleUiNode(t.selector):null;
     if(node){node.closest('details')?.setAttribute('open','');node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});select(id,node,request);send('located',{id,request});return;}
     revealing=true;await revealUiTarget(id,t.group,controller.signal,opened);await new Promise(r=>setTimeout(r,100));
    }
    if(!controller.signal.aborted)send('missing',{id,request,message:`「${t.title}」在当前状态中未显示。可切换正常操作打开它，再选择组件。`});
   }finally{if(locating===controller)revealing=false;}
  };
  const message=(event:MessageEvent)=>{
   const d=event.data;if(event.origin!==location.origin||event.source!==parent||d?.channel!=='galio-ui-studio'||d.nonce!==nonce)return;
   if(d.type==='ping')send('ready',{screen:new URLSearchParams(location.search).get('screen')});
   if(d.type==='update'&&Number.isSafeInteger(d.seq)&&d.seq>seq){try{seq=d.seq;current.recipe=validateUiDesignRecipe(d.recipe,UI_DESIGN_TARGET_RULES);current.editing=d.editing===true;current.selected=typeof d.selected==='string'?d.selected:'';runtime.update(current.recipe);if(!current.editing){locating?.abort();revealing=false;hovered=null;drag=null;}}catch{send('error',{message:'方案无法预览，请重新选择。'});}}
   if(d.type==='locate'&&typeof d.id==='string')void locate(d.id,Number(d.request)||0);
   if(d.type==='replay'){const t=entries.find(t=>t.id===current.selected);if(t?.selector)document.querySelectorAll<HTMLElement>(t.selector).forEach(n=>n.getAnimations({subtree:true}).forEach(a=>{a.cancel();a.play();}));}
  };
  const down=(e:PointerEvent)=>{
   if(!current.editing||e.button!==0||!(e.target instanceof Element)||e.target.closest('[data-ui-editor]'))return;
   locating?.abort();revealing=false;const hit=matches(e.target)[0];e.preventDefault();e.stopImmediatePropagation();
   if(!hit){send('missing',{message:'此处暂未接入调整，可在左侧选择所属容器。'});return;}
   select(hit.id,hit.node);if(!targetRule(hit.id)?.allowedFields?.includes('offsetX'))return;
   const base=current.recipe.targets[hit.id]??{},p=matchMedia('(max-width:700px)').matches?base.mobile??{}:base;
   drag={id:hit.id,x:e.clientX,y:e.clientY,ox:p.offsetX??0,oy:p.offsetY??0,node:hit.node,moved:false,pointer:e.pointerId};
   try{hit.node.setPointerCapture(e.pointerId);}catch{}
   send('drag-start',{id:hit.id});
  };
  const move=(e:PointerEvent)=>{
   if(drag){e.preventDefault();const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved ||=Math.abs(dx)+Math.abs(dy)>4;if(drag.moved)send('drag',{id:drag.id,x:Math.round(Math.max(-320,Math.min(320,drag.ox+dx))),y:Math.round(Math.max(-320,Math.min(320,drag.oy+dy)))});return;}
   hovered=current.editing&&e.target instanceof Element?matches(e.target)[0]??null:null;
  };
  const up=()=>{if(!drag)return;try{drag.node.releasePointerCapture(drag.pointer);}catch{}send('drag-end',{moved:drag.moved});drag=null;};
  const click=(e:MouseEvent)=>{if(current.editing&&!(revealing&&!e.isTrusted)){e.preventDefault();e.stopImmediatePropagation();}};
  const key=(e:KeyboardEvent)=>{
   if(!current.editing)return;
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();locating?.abort();revealing=false;current.selected='';picked=null;hovered=null;send('deselect');return;}
   if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopImmediatePropagation();send(e.shiftKey?'redo':'undo');return;}
   if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&current.selected){e.preventDefault();e.stopImmediatePropagation();send('nudge',{id:current.selected,x:e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,y:e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0,step:e.shiftKey?10:1});return;}
   if(e.key==='Enter'&&document.activeElement){const hit=matches(document.activeElement)[0];if(hit){locating?.abort();revealing=false;e.preventDefault();e.stopImmediatePropagation();select(hit.id,hit.node);}return;}
   if(e.key!=='Tab'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();e.stopImmediatePropagation();}
  };
  let last='';const paint=()=>{
   const t=entries.find(t=>t.id===current.selected),hover=hovered&&!drag&&visibleUiNode(hovered.node)?hovered:null;
   const node=hover?.node??(picked&&visibleUiNode(picked)&&t?.selector&&picked.matches(t.selector)?picked:t?.selector?findVisibleUiNode(t.selector):null),id=hover?.id??current.selected,box=overlay.current;
   if(box&&node&&current.editing){const r=node.getBoundingClientRect(),label=entries.find(t=>t.id===id)?.title??'',rect=`${r.left},${r.top},${r.width},${r.height},${id},${!!hover}`;
    if(rect!==last){box.style.cssText=`position:fixed;inset:auto;margin:0;pointer-events:none;border:${hover?'1px dashed':'2px solid'} #aa593d;background:transparent;padding:0;overflow:visible;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-shadow:none;border-radius:3px;color:#fff;`;box.textContent=label;box.dataset.labelBelow=String(r.top<28);last=rect;}
    box.hidden=false;if(!box.matches(':popover-open'))box.showPopover?.();
   }else if(box){box.hidden=true;if(box.matches(':popover-open'))box.hidePopover?.();last='';}
   document.documentElement.toggleAttribute('data-ui-selecting',current.editing);raf=requestAnimationFrame(paint);
  };
  const css=document.createElement('style');css.textContent='[data-ui-selecting] *{cursor:crosshair!important}[data-ui-selection]{font:12px/20px system-ui!important;font-size:0!important}[data-ui-selection]::before{content:attr(data-label);position:absolute;left:-2px;bottom:100%;white-space:nowrap;background:#aa593d;color:white;font:12px/20px system-ui;padding:0 6px;border-radius:3px 3px 0 0}[data-ui-selection][data-label-below="true"]::before{bottom:auto;top:100%}';document.head.append(css);
  // A top-layer popover remains visible above native dialogs without intercepting them.
  const labelObserver=new MutationObserver(()=>{if(overlay.current)overlay.current.dataset.label=overlay.current.textContent??'';});if(overlay.current)labelObserver.observe(overlay.current,{childList:true});
  window.addEventListener('message',message);document.addEventListener('pointerdown',down,true);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);window.addEventListener('click',click,true);window.addEventListener('keydown',key,true);raf=requestAnimationFrame(paint);send('ready',{screen:new URLSearchParams(location.search).get('screen')});
  return()=>{locating?.abort();runtime();css.remove();labelObserver.disconnect();cancelAnimationFrame(raf);document.documentElement.removeAttribute('data-ui-selecting');window.removeEventListener('message',message);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);window.removeEventListener('click',click,true);window.removeEventListener('keydown',key,true);};
 },[nonce]);
 return <div ref={overlay} data-ui-editor data-ui-selection popover="manual" aria-hidden="true"/>;
}
