"use client";
import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {documentPageTargets,currentDocumentPage,jumpDocumentPage,type DocumentPageTarget} from '@/lib/documentPageNavigation';
import styles from './DocumentReader.module.css';

export function DocumentPageNavigation({root,iframe,documentId,word,revision,onJump,afterJump}:{root:RefObject<HTMLDivElement|null>;iframe:RefObject<HTMLIFrameElement|null>;documentId:string;word:boolean;revision:string;onJump:()=>void;afterJump?:()=>void}){
 const targets=useRef<DocumentPageTarget[]>([]);
 const [total,setTotal]=useState(0),[current,setCurrent]=useState(1),[draft,setDraft]=useState('1'),[error,setError]=useState('');
 const [menu,setMenu]=useState<{left:number;top:number}|null>(null);
 const button=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null),editing=useRef(false);
 const edge=()=>{const toolbar=button.current?.closest('[data-document-toolbar]')?.getBoundingClientRect();return Math.max(0,toolbar?.bottom??0)+12;};
 useEffect(()=>{editing.current=false;setMenu(null);setError('');setCurrent(1);setDraft('1');},[documentId]);
 useEffect(()=>{
  const host=root.current;if(!host)return;let frame=0,rebuild=true;
  const measure=()=>{frame=0;if(rebuild){targets.current=documentPageTargets(host,iframe.current);setTotal(targets.current.length);rebuild=false;}const page=currentDocumentPage(targets.current,edge());setCurrent(page);if(!editing.current)setDraft(String(page));};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const changed=()=>{rebuild=true;schedule();};
  const observer=new MutationObserver(changed);observer.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
  if(iframe.current?.contentDocument?.body)observer.observe(iframe.current.contentDocument.body,{childList:true,subtree:true});
  const resize=new ResizeObserver(changed);resize.observe(host);
  window.addEventListener('scroll',schedule,true);window.addEventListener('resize',changed);measure();
  return()=>{cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',changed);};
 },[root,iframe,documentId,revision]);
 useEffect(()=>{
  if(!menu)return;
  const close=(event:Event)=>{const node=event.target as Node;if(!popup.current?.contains(node)&&!button.current?.contains(node))setMenu(null);};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenu(null);button.current?.focus({preventScroll:true});}};
  window.addEventListener('pointerdown',close,true);window.addEventListener('keydown',key);const resized=()=>setMenu(null);const scrolled=(event:Event)=>{const node=event.target as Node;if(!node?.nodeType||!popup.current?.contains(node))setMenu(null);};window.addEventListener('resize',resized);window.addEventListener('scroll',scrolled,true);
  return()=>{window.removeEventListener('pointerdown',close,true);window.removeEventListener('keydown',key);window.removeEventListener('resize',resized);window.removeEventListener('scroll',scrolled,true);};
 },[menu]);
 function go(page:number){
  if(!Number.isInteger(page)||page<1||page>total||!targets.current[page-1]){setError(`请输入 1–${total} 页`);return;}
  onJump();jumpDocumentPage(targets.current[page-1],edge());afterJump?.();setCurrent(page);setDraft(String(page));setError('');setMenu(null);
 }
 return <div className={styles.pageNavigation} data-document-page-navigation>
  <form onSubmit={event=>{event.preventDefault();go(Number(draft));}}><input aria-label="跳转页码" inputMode="numeric" value={draft} maxLength={5} disabled={!total} onFocus={()=>{editing.current=true;}} onBlur={()=>{editing.current=false;}} onChange={event=>{setDraft(event.target.value);setError('');}} /><span aria-label="总页数">/ {total||'…'}</span><button type="submit" className={styles.scaleChoice} disabled={!total}>跳转</button></form>
  <button type="button" className={styles.scaleChoice} ref={button} disabled={!total} aria-haspopup="dialog" aria-expanded={Boolean(menu)} onClick={()=>{if(menu)setMenu(null);else {const b=button.current!.getBoundingClientRect();setMenu({left:Math.max(8,Math.min(b.left,window.innerWidth-272)),top:Math.max(8,Math.min(b.bottom+8,window.innerHeight-Math.min(420,window.innerHeight*.6)-8))});}}}>页目录</button>
  {error&&<span role="status">{error}</span>}
  {menu&&createPortal(<div ref={popup} role="dialog" aria-label="文档页目录" className={styles.pageDirectory} style={{left:menu.left,top:menu.top}}><div className={styles.directoryHeading}><span>共 {total} 页</span><button type="button" onClick={()=>setMenu(null)} aria-label="关闭页目录">×</button></div>{word&&<p>Word 页码按网页排版计算</p>}<div className={styles.directoryPages}>{Array.from({length:total},(_,i)=><button key={i} type="button" aria-current={current===i+1?'page':undefined} onClick={()=>go(i+1)}>第 {i+1} 页</button>)}</div></div>,document.body)}
 </div>;
}
