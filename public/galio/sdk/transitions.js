/** Animate a project's own synchronous render; newer navigation always cancels older animation. */
const active=new WeakMap();
export function transitionView(element,render,{mode='none',duration=220}={}){
  if(!(element instanceof Element)||typeof render!=='function')throw new TypeError('需要页面区域与实际渲染函数');
  active.get(element)?.cancel();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const ms=Math.min(600,Math.max(0,Number(duration)||0));
  const enabled=typeof element.animate==='function'&&!reduced.matches&&ms>0&&['fade','rise','slide','crossfade','scale'].includes(mode);
  const previous=enabled&&mode==='crossfade'?element.cloneNode(true):null;
  render(); // Never defer the real application state behind an animation.
  if(!enabled)return {finished:Promise.resolve(),cancel(){}};
  const animations=[],oldPosition=element.style.position;let overlay=null,complete=false,positionChanged=false,resolve;
  const finished=new Promise(r=>resolve=r);
  const handle={finished,cancel:finish};active.set(element,handle);
  function finish(){if(complete)return;complete=true;for(const animation of animations)animation.cancel();overlay?.remove();if(positionChanged&&element.style.position==='relative')element.style.position=oldPosition;reduced.removeEventListener('change',onReduce);if(active.get(element)===handle)active.delete(element);resolve();}
  const onReduce=e=>{if(e.matches)finish();};reduced.addEventListener('change',onReduce);
  const animate=(node,frames)=>{const animation=node.animate(frames,{duration:ms,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'});animations.push(animation);return animation;};
  if(previous){
    previous.removeAttribute('id');previous.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));previous.querySelectorAll('[data-galio-selected]').forEach(n=>n.removeAttribute('data-galio-selected'));
    previous.querySelectorAll('[name],[autofocus]').forEach(n=>{n.removeAttribute('name');n.removeAttribute('autofocus');});
    overlay=document.createElement('div');overlay.dataset.galioTransient='';overlay.setAttribute('aria-hidden','true');overlay.inert=true;overlay.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1;';previous.style.margin='0';previous.style.width='100%';overlay.append(previous);
    if(getComputedStyle(element).position==='static'){element.style.position='relative';positionChanged=true;}
    const next=[...element.children];element.append(overlay);for(const node of next)animate(node,[{opacity:0},{opacity:1}]);animate(overlay,[{opacity:1},{opacity:0}]);
  }else{
    const from=mode==='rise'?{opacity:.2,transform:'translateY(10px)'}:mode==='slide'?{opacity:.2,transform:'translateX(20px)'}:mode==='scale'?{opacity:.2,transform:'scale(.97)'}:{opacity:.15};
    animate(element,[from,{opacity:1,transform:'none'}]);
  }
  Promise.allSettled(animations.map(a=>a.finished)).then(finish);
  return handle;
}
