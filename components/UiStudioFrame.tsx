"use client";
import {UI_TARGETS,UI_EFFECTS} from '@/lib/uiInventory';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {AccountSessionState} from '@/types/account';
import {AccountProvider,useAccount} from './AccountProvider';
import {HomeOptionMenu} from './HomeOptionMenu';
import {ReaderView} from './ReaderView';
import {StudyPanel} from './StudyPanel';
import {StudyHost} from './StudyHost';
import {BookDictionary} from './BookDictionary';
import {CetLibrary,type CetEntry} from './cet/CetLibrary';
import {CetReader} from './cet/CetReader';
import {AccountUsagePageContent} from './AccountUsagePageContent';
import {BillingPage} from './BillingPage';
import {GuidePageContent} from './GuidePageContent';
import AdminPage from '@/app/admin/page';
import {installUiDesignPreview,UI_PREVIEW_ARTICLE} from '@/lib/uiDesignPreview';
import {UI_DESIGN_TARGET_RULES,targetRule,type UiScene} from '@/lib/uiDesignRegistry';
import {emptyUiDesignRecipe,validateUiDesignRecipe,type UiDesignRecipe} from '@/lib/uiDesign';
import {mountUiDesign} from '@/lib/uiDesignRuntime';

function Bridge({nonce}:{nonce:string}){
 const [recipe,setRecipe]=useState<UiDesignRecipe>(emptyUiDesignRecipe),[selected,setSelected]=useState(''),[editing,setEditing]=useState(true);
 const overlay=useRef<HTMLDivElement>(null),current=useRef({recipe,selected,editing});current.current={recipe,selected,editing};
 const send=(type:string,payload:Record<string,unknown>={})=>parent.postMessage({channel:'galio-ui-studio',nonce,type,...payload},location.origin);
 const runtime=useRef<ReturnType<typeof mountUiDesign>|null>(null);
 useEffect(()=>{runtime.current=mountUiDesign(emptyUiDesignRecipe(),message=>send('error',{message}));return()=>{runtime.current?.();runtime.current=null;};},[]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>runtime.current?.update(recipe),[recipe]);
 useEffect(()=>{
  document.querySelector('style[data-ui-design="initial"]')?.remove();let seq=-1,raf=0;let picked:HTMLElement|null=null;let drag:{id:string;x:number;y:number;ox:number;oy:number;node:HTMLElement;moved:boolean}|null=null;
  const message=(event:MessageEvent)=>{const d=event.data;if(event.origin!==location.origin||event.source!==parent||d?.channel!=='galio-ui-studio'||d.nonce!==nonce)return;
   if(d.type==='update'&&Number.isSafeInteger(d.seq)&&d.seq>seq){try{const next=validateUiDesignRecipe(d.recipe,UI_DESIGN_TARGET_RULES);seq=d.seq;setRecipe(next);setEditing(d.editing===true);setSelected(typeof d.selected==='string'?d.selected:'');}catch{send('error',{message:'方案无法预览，请重新选择。'});}}
   if(d.type==='locate'&&typeof d.id==='string'){const t=[...UI_TARGETS,...UI_EFFECTS].find(t=>t.id===d.id);const node=t?.selector?document.querySelector<HTMLElement>(t.selector):null;if(node&&node.getClientRects().length){setSelected(d.id);node.scrollIntoView({block:'center',behavior:'smooth'});}else send('missing',{message:'这个元素尚未展开。切换到「操作页面」打开对应面板后，再选择它。'});}
   if(d.type==='replay'){const t=[...UI_TARGETS,...UI_EFFECTS].find(t=>t.id===current.current.selected);if(t?.selector)document.querySelectorAll<HTMLElement>(t.selector).forEach(n=>n.getAnimations({subtree:true}).forEach(a=>{a.cancel();a.play();}));}
  };
  const pick=(node:Element)=>{let cursor:Element|null=node;while(cursor&&cursor!==document.body){const t=UI_TARGETS.find(t=>targetRule(t.id)?.editable&&t.selector&&cursor!.matches(t.selector));if(t)return {t,node:cursor as HTMLElement};cursor=cursor.parentElement;}return null;};
  const down=(e:PointerEvent)=>{if(!current.current.editing||e.button!==0||!(e.target instanceof Element)||e.target.closest('[data-ui-editor]'))return;const hit=pick(e.target);e.preventDefault();e.stopImmediatePropagation();if(!hit)return;
   picked=hit.node;setSelected(hit.t.id);send('select',{id:hit.t.id,count:document.querySelectorAll(hit.t.selector).length});if(!targetRule(hit.t.id)?.allowedFields?.includes('offsetX'))return;try{hit.node.setPointerCapture(e.pointerId);}catch{}
   const base=current.current.recipe.targets[hit.t.id]??{},p=matchMedia('(max-width:700px)').matches?base.mobile??{}:base;
   drag={id:hit.t.id,x:e.clientX,y:e.clientY,ox:p.offsetX??0,oy:p.offsetY??0,node:hit.node,moved:false};send('drag-start',{id:hit.t.id});
  };
  const move=(e:PointerEvent)=>{if(!drag)return;e.preventDefault();const x=Math.max(-320,Math.min(320,drag.ox+e.clientX-drag.x)),y=Math.max(-320,Math.min(320,drag.oy+e.clientY-drag.y));drag.moved||=Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>3;send('drag',{id:drag.id,x:Math.round(x),y:Math.round(y)});};
  const up=()=>{if(!drag)return;send('drag-end',{moved:drag.moved});drag=null;};
  const click=(e:MouseEvent)=>{if(current.current.editing){e.preventDefault();e.stopImmediatePropagation();}};
  const key=(e:KeyboardEvent)=>{if(!current.current.editing)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopImmediatePropagation();send(e.shiftKey?'redo':'undo');return;}if(!['Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!e.ctrlKey&&!e.metaKey){e.preventDefault();e.stopImmediatePropagation();return;}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&current.current.selected){e.preventDefault();e.stopImmediatePropagation();send('nudge',{id:current.current.selected,x:e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,y:e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0,step:e.shiftKey?10:1});}};
  let last='';const paint=()=>{const selected=current.current.selected,t=[...UI_TARGETS,...UI_EFFECTS].find(t=>t.id===selected);const nodes=t?.selector?[...document.querySelectorAll<HTMLElement>(t.selector)]:[];const node=picked?.isConnected&&t?.selector&&picked.matches(t.selector)?picked:nodes.find(n=>n.getClientRects().length&&!n.closest('[hidden],[inert]'));const box=overlay.current;
   if(box){if(node&&current.current.editing){const r=node.getBoundingClientRect();const rect=`${r.left},${r.top},${r.width},${r.height}`;if(rect!==last){box.style.cssText=`position:fixed;inset:auto;margin:0;pointer-events:none;border:1px solid #b56345;background:transparent;padding:0;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-shadow:0 0 0 2px #fff9;border-radius:3px;`;last=rect;}box.hidden=false;if(!box.matches(':popover-open'))box.showPopover?.();}else{box.hidden=true;if(box.matches(':popover-open'))box.hidePopover?.();last='';}}
   raf=requestAnimationFrame(paint);
  };
  window.addEventListener('message',message);document.addEventListener('pointerdown',down,true);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);window.addEventListener('click',click,true);window.addEventListener('keydown',key,true);raf=requestAnimationFrame(paint);send('ready',{screen:new URLSearchParams(location.search).get('screen')});
  return()=>{cancelAnimationFrame(raf);window.removeEventListener('message',message);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);window.removeEventListener('click',click,true);window.removeEventListener('keydown',key,true);};
 },[nonce]); // eslint-disable-line react-hooks/exhaustive-deps
 return <div ref={overlay} data-ui-editor popover="manual" aria-hidden="true"/>;
}
function Scene({scene,home}:{scene:UiScene;home:ReactNode}){
 const [entry,setEntry]=useState<CetEntry|null>(null),[study,setStudy]=useState(true);
 const [menu,setMenu]=useState(false);const {account}=useAccount();
 useEffect(()=>{const open=()=>setMenu(true),openStudy=()=>setStudy(true);window.addEventListener('context-reader-open-main-menu',open);window.addEventListener('context-reader-open-study',openStudy);return()=>{window.removeEventListener('context-reader-open-main-menu',open);window.removeEventListener('context-reader-open-study',openStudy);};},[]);
 const back=()=>{const q=new URLSearchParams(location.search);q.set('screen','home');location.href=location.pathname+'?'+q;};
 if(scene==='reader')return <ReaderView article={UI_PREVIEW_ARTICLE} onBack={back} onArticleSaved={()=>{}}/>;
 if(scene==='study')return <><button onClick={()=>setStudy(true)}>继续背词</button><StudyPanel visible={study} onClose={()=>setStudy(false)} onSource={back} notice=""/><HomeOptionMenu open={menu} isAdmin={false} account={account} isOffline={false} localAccount={null} savedArticles={[]} vocabularyEntries={[]} onClose={()=>setMenu(false)} onOpenSavedArticle={()=>{}}/></>;
 if(scene==='dictionary')return <BookDictionary embedded active onBack={back} initialQuery="subtle"/>;
 if(scene==='cet')return entry?<CetReader entry={entry} onOpen={setEntry} onBack={()=>setEntry(null)} onArticleSaved={()=>{}}/>:<CetLibrary onOpen={setEntry}/>;
 if(scene==='account')return <AccountUsagePageContent embedded/>;
 if(scene==='billing')return <BillingPage/>;
 if(scene==='guide')return <GuidePageContent embedded/>;
 if(scene==='admin')return <AdminPage/>;
 return home;
}
export function UiStudioFrame({account,scene,nonce,home}:{account:AccountSessionState;scene:UiScene;nonce:string;home:ReactNode}){
 const [ready,setReady]=useState(false);
 useEffect(()=>{const restore=installUiDesignPreview(account);setReady(true);return restore;},[account]);
 return ready?<AccountProvider><Scene scene={scene} home={home}/>{scene!=='study'&&<StudyHost/>}<Bridge nonce={nonce}/></AccountProvider>:null;
}
