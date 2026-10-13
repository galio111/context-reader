import {contrastInk} from '../../sdk/materials.js';
/* Public-source ports/adaptations. Pinned originals and licenses: third-party/designeer.
   Effect layers never replace existing business elements or intercept their clicks. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
const sampleItems=()=>['The art of noticing','Space to think','A quieter kind of design','Small discoveries'].map((title,i)=>({id:String(i),title,label:title,description:['留心日常','为想法留白','少一点，更清楚','发现细节'][i]}));
function instance(root,item,initial,enhance){
 let options={...initial},disposed=false,paused=false,progress=0,frame=0,clock=0,last=0,cycle=0,animations=[],cleanups=[],localCleanups=[],tickers=[];
 const abort=new AbortController(),v=item.variant,owned=new Set(),originalStyle=new Map(),originalClasses=new Map(),absentClass=new Set();let typographyTarget;
 const on=(el,type,fn,opts={})=>el.addEventListener(type,fn,{...opts,signal:abort.signal});
 const style=(el,key,value)=>{if(!originalStyle.has(el))originalStyle.set(el,new Map());const props=originalStyle.get(el);if(!props.has(key))props.set(key,[el.style.getPropertyValue(key),el.style.getPropertyPriority(key)]);el.style.setProperty(key,value);};
 const klass=(el,name)=>{if(!originalClasses.has(el)){originalClasses.set(el,new Set());if(!el.hasAttribute("class"))absentClass.add(el);}if(!el.classList.contains(name)){el.classList.add(name);originalClasses.get(el).add(name);}};
 const add=(el,tag,cls)=>{const n=document.createElement(tag);n.className=cls;el.append(n);owned.add(n);return n;};
 const emit=(action,detail)=>options.onAction?.(action,detail);
 const duration=()=>Math.max(200,options.duration||1400)/(options.speed||1);
 const animate=(el,keys,extra={})=>{if(options.reducedMotion){Object.assign(el.style,keys.at(-1));return null;}const a=el.animate(keys,{duration:duration(),easing:'cubic-bezier(.2,.8,.2,1)',fill:'both',...extra});animations.push(a);if(animations.length>64){animations.shift()?.cancel();}return a;};
 const stopAnimations=()=>{animations.forEach(a=>a.cancel());animations=[];};
 const applyTheme=()=>{style(root,'--sl-accent',options.accent);style(root,'--sl-on-accent',contrastInk(options.accent));style(root,'--sl-radius',options.radius+'px');style(root,'--sl-font',options.font);style(root,'--sl-font-size',options.fontSize+'px');if(typographyTarget){style(typographyTarget,'font-family',options.font);style(typographyTarget,'font-size',Math.round(options.fontSize*2.3)+'px');style(typographyTarget,'color',options.accent);}};
 klass(root,'sl-root');applyTheme();
 const data=()=>options.data||{},items=()=>data().items??sampleItems();
 let replayEffect=()=>{},draw=()=>{},updateData=()=>{};
 function effectTarget(){if(enhance){klass(root,"sl-enhanced-action");return root;}const b=add(root,'button','sl-action');b.type='button';b.textContent=data().label||'保存这份灵感';on(b,'click',()=>emit('complete',{value:true}));return b;}
 if(item.category==='buttons'||item.category==='hover'){
  const target=effectTarget();klass(target,'sl-effect-target');
  if(v==='ripple-button'){
   const ripple=e=>{const r=target.getBoundingClientRect(),size=Math.max(r.width,r.height)*2,n=add(target,'span','sl-click-ripple');n.setAttribute('aria-hidden','true');n.style.cssText=`width:${size}px;height:${size}px;left:${(e?.detail?e.clientX-r.left:r.width/2)-size/2}px;top:${(e?.detail?e.clientY-r.top:r.height/2)-size/2}px`;const a=animate(n,[{transform:'scale(0)',opacity:.3},{transform:'scale(1)',opacity:0}]);a?.finished.then(()=>{n.remove();owned.delete(n);}).catch(()=>{});if(!a){n.remove();owned.delete(n);}};
   on(target,'click',ripple);replayEffect=()=>ripple();
  }else if(v==='glare-hover'){
   const cover=add(target,'span','sl-glare');cover.setAttribute('aria-hidden','true');const band=add(cover,'i','sl-glare-band');
   replayEffect=()=>{stopAnimations();animate(band,[{transform:'translateX(-180%) rotate(-30deg)'},{transform:'translateX(220%) rotate(-30deg)'}]);};on(target,'pointerenter',replayEffect);on(target,'focus',replayEffect);
  }else if(v==='lens'){
   if(!enhance){target.classList.add('sl-lens-sample');target.innerHTML='<small>FIELD NOTES / 026</small><strong>Look<br>closer.</strong><span>移动鼠标 · 看见细节</span>';}
   const lens=add(target,'span','sl-lens'),clone=target.cloneNode(true);clone.querySelectorAll('.sl-lens').forEach(x=>x.remove());clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));clone.inert=true;lens.setAttribute('aria-hidden','true');lens.append(clone);clone.className='sl-lens-content';
   let x=80,y=70;const move=(nx,ny)=>{x=nx;y=ny;lens.style.clipPath=`circle(65px at ${x}px ${y}px)`;clone.style.transformOrigin=`${x}px ${y}px`;lens.classList.add('visible');};on(target,'pointermove',e=>{const r=target.getBoundingClientRect();move(e.clientX-r.left,e.clientY-r.top);});on(target,'pointerleave',()=>lens.classList.remove('visible'));on(target,'focus',()=>move(target.clientWidth/2,target.clientHeight/2));on(target,'blur',()=>lens.classList.remove('visible'));on(target,'keydown',e=>{if(e.key.startsWith('Arrow')){e.preventDefault();move(clamp(x+(e.key==='ArrowRight'?15:e.key==='ArrowLeft'?-15:0),0,target.clientWidth),clamp(y+(e.key==='ArrowDown'?15:e.key==='ArrowUp'?-15:0),0,target.clientHeight));}});replayEffect=()=>move(target.clientWidth/2,target.clientHeight/2);
  }
 }
 if(item.category==='backgrounds'){
  klass(root,'sl-background-host');if(getComputedStyle(root).position==='static')style(root,'position','relative');style(root,'isolation','isolate');
  const layer=add(root,'div','sl-background '+v);layer.setAttribute('aria-hidden','true');
  if(!enhance){const label=add(root,'div','sl-background-copy');label.innerHTML='<small>一点氛围，足够了。</small><strong>Space for ideas.</strong>';}
  if(v==='border-beam'){const n=add(layer,'i','sl-beam');draw=p=>{n.style.offsetDistance=(p*100)+'%';};cycle=1;}
  if(v==='ripple'){for(let i=0;i<7;i++){const n=add(layer,'i','sl-wave');n.style.width=n.style.height=(90+i*52)+'px';}draw=p=>layer.querySelectorAll('i').forEach((n,i)=>{const z=(p+i*.1)%1;n.style.transform=`translate(-50%,-50%) scale(${.92+z*.18})`;n.style.opacity=String((1-z)*(.26-i*.026));});cycle=1;}
  if(v==='interactive-grid-pattern'){
   const spot=add(layer,'i','sl-grid-spot');on(root,'pointermove',e=>{const r=root.getBoundingClientRect();spot.style.transform=`translate(${Math.floor((e.clientX-r.left)/40)*40}px,${Math.floor((e.clientY-r.top)/40)*40}px)`;spot.style.opacity='.2';});on(root,'pointerleave',()=>spot.style.opacity='0');replayEffect=()=>{spot.style.transform='translate(80px,80px)';animate(spot,[{opacity:.3},{opacity:0}]);};
  }
  if(v==='flickering-grid'){
   const canvas=add(layer,'canvas','sl-pixels'),ctx=canvas.getContext('2d');let squares=[],cols=0,rows=0;const resize=()=>{const w=root.clientWidth,h=root.clientHeight,dpr=Math.min(devicePixelRatio,2);canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);cols=Math.ceil(w/12);rows=Math.ceil(h/12);squares=Array.from({length:cols*rows},()=>Math.random()*.3);};const ro=new ResizeObserver(resize);ro.observe(root);cleanups.push(()=>ro.disconnect());resize();let prev=-1;
   draw=p=>{const phase=Math.floor(p*24);if(prev!==phase){for(let i=0;i<squares.length;i++)if(Math.random()<.08)squares[i]=Math.random()*.3;prev=phase;}ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle=options.accent;for(let i=0;i<squares.length;i++){ctx.globalAlpha=squares[i];ctx.fillRect(i%cols*12,Math.floor(i/cols)*12,4,4);}ctx.globalAlpha=1;};cycle=1;
  }
 }
 if(item.category==='layout'){
  const area=add(root,'div','sl-layout '+v),controls=add(root,'div','sl-card-controls');let order=0;
  const card=(it,i)=>`<button class="sl-card" type="button" data-sl-open="${i}"><small>${String(i+1).padStart(2,'0')}</small><strong>${esc(it.title||it.label)}</strong><span>${esc(it.description||it.meta||'打开看看')} ↗</span></button>`;
  const arrange=()=>{const cards=[...area.querySelectorAll('.sl-card')],n=cards.length;cards.forEach((el,i)=>{const pos=(i-order+n)%n;el.style.zIndex=String(n-pos);if(v==='bounce-cards'){const mid=(n-1)/2;el.style.transform=`translate(calc(-50% + ${(i-mid)*Math.min(52,area.clientWidth/Math.max(n,1)*.5)}px),-50%) rotate(${[10,5,-3,-10][i%4]}deg)`;}else if(['stack-cards','card-swap'].includes(v)){el.style.transform=`translate(calc(-50% + ${v==='card-swap'?pos*18:0}px),calc(-50% - ${pos*14}px)) rotate(${v==='card-swap'?-7:pos*4}deg) scale(${1-pos*.06})`;el.inert=pos!==0;}});};
  const render=()=>{localCleanups.forEach(fn=>fn());localCleanups=[];const list=items();area.innerHTML=list.length?list.map(card).join(''):'<p class="sl-empty">这里还没有内容</p>';controls.innerHTML=['stack-cards','card-swap'].includes(v)&&list.length>1?'<button type="button" data-sl-prev aria-label="上一张">←</button><span>拖动或用方向键</span><button type="button" data-sl-next aria-label="下一张">→</button>':'';
   if(v==='marquee'){const track=document.createElement('div');track.className='sl-marquee-track';track.innerHTML=area.innerHTML;const copy=track.cloneNode(true);copy.inert=true;copy.setAttribute('aria-hidden','true');area.replaceChildren(track,copy);draw=p=>{const w=track.offsetWidth;area.style.setProperty('--sl-shift',(-p*w)+'px');};cycle=1;}
   if(v==='orbiting-circles'){area.insertAdjacentHTML('beforeend','<span class="sl-orbit-center">探索</span>');draw=p=>{area.querySelectorAll('.sl-card').forEach((el,i)=>{const angle=2*Math.PI*(p+i/Math.max(list.length,1)),r=Math.min(area.clientWidth*.3,90);el.style.transform=`translate(calc(-50% + ${Math.cos(angle)*r}px),calc(-50% + ${Math.sin(angle)*r}px))`;});};cycle=1;}
   arrange();const ro=new ResizeObserver(arrange);ro.observe(area);localCleanups.push(()=>ro.disconnect());
  };
  const shift=step=>{const list=items();if(!list.length)return;const top=area.querySelectorAll('.sl-card')[order];if(!options.reducedMotion&&top)animate(top,[{transform:top.style.transform},{transform:`translate(${step>0?'140%':'-200%'},-40%) rotate(18deg)`},{transform:'translate(-50%,-50%) scale(.76)'}],{duration:duration()*.7,fill:'none'});order=(order+step+list.length)%list.length;arrange();};
  on(controls,'click',e=>{if(e.target.closest('[data-sl-next]'))shift(1);if(e.target.closest('[data-sl-prev]'))shift(-1);});
  let drag;on(area,'pointerdown',e=>{if(!['stack-cards','card-swap'].includes(v))return;drag={x:e.clientX,y:e.clientY,id:e.pointerId};});let suppress=false;on(area,'pointerup',e=>{if(!drag)return;if(Math.abs(e.clientX-drag.x)>40&&Math.abs(e.clientX-drag.x)>Math.abs(e.clientY-drag.y)){suppress=true;shift(e.clientX<drag.x?1:-1);}drag=null;});on(area,'pointercancel',()=>drag=null);
  on(area,'click',e=>{if(suppress){suppress=false;return;}const b=e.target.closest('[data-sl-open]');if(b){const it=items()[Number(b.dataset.slOpen)];if(it)emit('open',{id:it.id,value:it.id});}});
  on(area,'keydown',e=>{if(['stack-cards','card-swap'].includes(v)&&['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();shift(e.key==='ArrowRight'?1:-1);area.querySelectorAll('.sl-card')[order]?.focus();}});
  if(v==='bounce-cards'){const spread=index=>area.querySelectorAll('.sl-card').forEach((el,i)=>{const mid=(items().length-1)/2,base=(i-mid)*Math.min(52,area.clientWidth/Math.max(items().length,1)*.5);el.style.transform=`translate(calc(-50% + ${base+(index<0?0:i===index?0:Math.sign(i-index)*65)}px),-50%) rotate(${index===i?0:[10,5,-3,-10][i%4]}deg) scale(${index===i?1.06:1})`;el.style.zIndex=index===i?'20':String(i+1);});on(area,'pointerover',e=>{const b=e.target.closest('[data-sl-open]');if(b)spread(Number(b.dataset.slOpen));});on(area,'focusin',e=>spread(Number(e.target.dataset.slOpen)));on(area,'pointerleave',()=>spread(-1));on(area,'focusout',()=>spread(-1));}
  on(area,'pointerenter',()=>paused=true);on(area,'pointerleave',()=>{paused=false;wake();});on(area,'focusin',()=>paused=true);on(area,'focusout',()=>{paused=false;wake();});
  render();updateData=render;replayEffect=['stack-cards','card-swap'].includes(v)?()=>shift(1):()=>{clock=0;arrange();};cleanups.push(()=>localCleanups.forEach(fn=>fn()));
 }
 if(item.category==='navigation'){
  const nav=add(root,'nav','sl-flowing-menu');nav.setAttribute('aria-label',data().label||'内容导航');let selected=data().value;
  const render=()=>{nav.innerHTML=items().map((it,i)=>`<button type="button" data-sl-nav="${i}" aria-current="${String(it.id||it.value)===String(selected)?'page':'false'}"><span>${esc(it.label||it.title)}</span><span class="sl-menu-marquee" aria-hidden="true"><i>${Array(5).fill(esc(it.label||it.title)+' ↗ ').join('')}</i></span></button>`).join('');};
  on(nav,'click',e=>{const b=e.target.closest('[data-sl-nav]');if(!b)return;const it=items()[Number(b.dataset.slNav)];selected=it.id||it.value;render();emit('navigate',{id:selected,value:selected});});updateData=()=>{selected=data().value;render();};render();
 }
 if(item.category==='inputs'){
  const wrap=add(root,'div','sl-elastic');wrap.innerHTML='<label></label><div class="sl-elastic-row"><span>−</span><div class="sl-elastic-control" role="slider" tabindex="0"><div class="sl-elastic-track"><i></i></div></div><span>＋</span></div><output></output>';
  const control=wrap.querySelector('[role=slider]'),track=wrap.querySelector('.sl-elastic-track');let value=Number(data().value??50),drag=false;
  const bounds=()=>({min:Number(data().min??0),max:Number(data().max??100),step:Number(data().step??1)});
  const set=(n,fire=false)=>{const {min,max,step}=bounds();value=clamp(Math.round(n/step)*step,min,max);wrap.querySelector('label').textContent=data().label||'拖动试试';wrap.querySelector('output').textContent=String(value);control.setAttribute('aria-label',data().label||'数值');control.setAttribute('aria-valuemin',min);control.setAttribute('aria-valuemax',max);control.setAttribute('aria-valuenow',value);track.firstElementChild.style.width=((value-min)/(max-min||1)*100)+'%';if(fire)emit('change',{value});};
  const move=e=>{const r=control.getBoundingClientRect(),{min,max}=bounds();set(min+(e.clientX-r.left)/r.width*(max-min),true);const over=Math.max(r.left-e.clientX,e.clientX-r.right,0),decay=(2*(1/(1+Math.exp(-over/50))-.5))*50;track.style.transformOrigin=e.clientX<r.left?'right':'left';track.style.transform=options.reducedMotion?'none':`scale(${1+decay/r.width},${1-decay/250})`;};
  on(control,'pointerdown',e=>{drag=true;control.setPointerCapture(e.pointerId);move(e);});on(control,'pointermove',e=>{if(drag)move(e);});const release=()=>{drag=false;animate(track,[{transform:track.style.transform},{transform:'scale(.98,1.04)'},{transform:'scale(1,1)'}],{duration:500,fill:'none'});track.style.transform='';};on(control,'pointerup',release);on(control,'pointercancel',release);on(control,'keydown',e=>{const {min,max,step}=bounds();if(['ArrowRight','ArrowUp','ArrowLeft','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();set(e.key==='Home'?min:e.key==='End'?max:value+(['ArrowRight','ArrowUp'].includes(e.key)?step:-step),true);}});updateData=()=>set(Number(data().value??value));updateData();
 }
 if(item.category==='typography'){
  const heading=enhance?(root.matches('h1,h2,h3')?root:root.querySelector('h1,h2,h3')||root):add(root,'h2','sl-type-demo');
  if(!enhance)heading.textContent=data().text|| (v==='circular-text'?'READ · NOTICE · REPEAT ·':'Make room for ideas.');
  typographyTarget=heading;applyTheme();klass(heading,'sl-type');const nodes=[...heading.childNodes];const originalText=heading.textContent;
  if(v==='typing-animation'||v==='scroll-float'||v==='circular-text'){
   const wrap=add(heading,'span','sl-letters '+v),saved=document.createDocumentFragment();nodes.forEach(n=>saved.append(n));wrap.setAttribute('aria-label',originalText);wrap.innerHTML=[...originalText].map((c,i)=>`<span aria-hidden="true" style="--i:${i};--n:${[...originalText].length}">${c===' '?'&nbsp;':esc(c)}</span>`).join('');cleanups.push(()=>{wrap.remove();heading.prepend(saved);});
   const letters=[...wrap.children];draw=p=>{letters.forEach((n,i)=>{const t=clamp((p-i/Math.max(letters.length,1)*.6)/.4);if(v==='typing-animation')n.style.opacity=p>=i/Math.max(letters.length,1)?'1':'0';if(v==='scroll-float'){n.style.opacity=t;n.style.transform=`translateY(${(1-t)*120}%) scale(${.7+t*.3},${2.3-t*1.3})`;}});if(v==='circular-text')wrap.style.transform=`rotate(${p*360}deg)`;};if(v==='circular-text'){cycle=1;on(heading,'pointerenter',()=>paused=true);on(heading,'pointerleave',()=>{paused=false;wake();});}
  }else if(v==='word-rotate'){
   const words=data().words||(!enhance?['Make room for ideas.','给想法，留一点空间。','Look a little closer.']:[originalText]);const text=add(heading,'span','sl-rotating');const saved=document.createDocumentFragment();nodes.forEach(n=>saved.append(n));cleanups.push(()=>{text.remove();heading.prepend(saved);});draw=p=>{const i=Math.floor(p*words.length)%words.length,t=p*words.length-i;text.textContent=words[i];text.style.opacity=options.reducedMotion?'1':String(clamp(Math.min(t/.15,(1-t)/.15)));text.style.transform=options.reducedMotion?'none':`translateY(${t<.15?-35*(1-t/.15):t>.85?35*((t-.85)/.15):0}px)`;};cycle=1;
  }else if(v==='scroll-velocity'){
   const belt=add(heading,'span','sl-velocity-belt'),saved=document.createDocumentFragment();nodes.forEach(n=>saved.append(n));belt.innerHTML=Array.from({length:6},(_,i)=>`<span ${i?'aria-hidden="true"':''}>${esc(originalText)} &nbsp; </span>`).join('');cleanups.push(()=>{belt.remove();heading.prepend(saved);});let boost=1,prev=scrollY;on(window,'scroll',()=>{const diff=scrollY-prev;prev=scrollY;if(diff)boost=clamp(diff/20,-8,8);},{passive:true});on(heading,'wheel',e=>boost=clamp(e.deltaY/40,-8,8),{passive:true});tickers.push(dt=>{boost+=(1-boost)*Math.min(1,dt*.003);clock+=dt*(boost-1);});draw=p=>belt.style.transform=`translateX(${-p*(belt.firstElementChild?.offsetWidth||300)}px)`;cycle=1;
  }
 }
 if(item.category==='data'){
  const chart=add(root,'div','sl-data');let value=0,total=0;
  const render=()=>{const series=data().series;value=Number(data().value??(series?series.reduce((sum,x)=>sum+Number(x.value||0),0):73));total=Number(data().max??(series?series.length:100));chart.innerHTML=v==='number-ticker'?`<small>${esc(data().title||'收集的灵感')}</small><strong class="sl-ticker">0</strong>`:`<svg viewBox="0 0 100 100" role="img" aria-label="${esc(data().title||'完成进度')}"><circle class="sl-ring-track" cx="50" cy="50" r="42"/><circle class="sl-ring-value" cx="50" cy="50" r="42"/></svg><strong class="sl-ring-number"></strong><small>${esc(data().title||'完成进度')}</small>`;clock=0;};
  draw=p=>{const ease=1-(1-p)**4;if(v==='number-ticker')chart.querySelector('strong').textContent=Math.round(value*ease).toLocaleString('zh-CN');else{const percent=clamp(value/(total||1)),circ=2*Math.PI*42;chart.querySelector('.sl-ring-value').style.strokeDasharray=`${percent*ease*circ} ${circ}`;chart.querySelector('.sl-ring-track').style.strokeDasharray=`${Math.max(0,.9-percent*ease)*circ} ${circ}`;chart.querySelector('.sl-ring-number').textContent=Math.round(percent*ease*100)+'%';}};render();updateData=render;
 }
 function renderFrame(p){progress=p;draw(options.reducedMotion?1:p);}
 const visible=new IntersectionObserver(([e])=>{if(e.isIntersecting)wake();else {cancelAnimationFrame(frame);frame=0;}});visible.observe(root);cleanups.push(()=>visible.disconnect());
 function loop(now){frame=0;if(disposed||paused||document.hidden||options.reducedMotion)return;const dt=Math.min(40,now-last||16);last=now;tickers.forEach(fn=>fn(dt));clock+=dt;const length=duration()*(cycle?4:1);renderFrame(cycle?((clock%length)+length)%length/length:Math.min(1,clock/length));if(cycle||progress<1)frame=requestAnimationFrame(loop);}
 function wake(){if(disposed||paused||document.hidden||options.reducedMotion||frame)return;last=performance.now();frame=requestAnimationFrame(loop);}
 on(document,'visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else wake();});
 const api={replay(){stopAnimations();clock=0;paused=false;delete root.dataset.slPaused;renderFrame(options.reducedMotion?1:0);replayEffect();wake();},pause(){paused=true;root.dataset.slPaused="true";cancelAnimationFrame(frame);frame=0;animations.forEach(a=>a.pause());},play(){paused=false;delete root.dataset.slPaused;animations.forEach(a=>a.play());wake();},seek(p){api.pause();clock=p*duration()*(cycle?4:1);renderFrame(p);animations.forEach(a=>a.currentTime=p*Number(a.effect.getTiming().duration));},get progress(){return progress;},update(next){options={...options,...next};applyTheme();if(Object.hasOwn(next,'data'))updateData();if(options.reducedMotion){api.pause();renderFrame(1);}else wake();},destroy(){if(disposed)return;disposed=true;delete root.dataset.slPaused;abort.abort();cancelAnimationFrame(frame);stopAnimations();cleanups.forEach(fn=>fn());for(const n of owned)n.remove();for(const [el,props] of originalStyle)for(const [key,[value,priority]] of props){if(value)el.style.setProperty(key,value,priority);else el.style.removeProperty(key);}for(const [el,names] of originalClasses)for(const n of names)el.classList.remove(n);for(const el of absentClass)if(!el.className)el.removeAttribute("class");}};
 api.replay();return api;
}
export const mount=(root,item,options)=>instance(root,item,options,false);
export const applyToElement=(root,item,options)=>instance(root,item,options,true);
