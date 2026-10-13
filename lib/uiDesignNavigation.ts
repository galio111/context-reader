import {sceneForGroup,type UiScene} from './uiDesignRegistry';

export function uiEffectTarget(id:string){return ({'effect.pill-fill':'global.pill-button','effect.study-answer':'study.answer','effect.study-dialog':'study.confirm','effect.study-switch':'study.remind','effect.menu-panel':'menu.panel','effect.menu-items':'menu.items','effect.menu-layers':'menu.layers','effect.menu-preview':'menu.preview-settings','effect.theme-switch':'menu.theme','effect.reader-dictionary':'reader.dictionary','effect.dictionary-enter':'home.dictionary-window','effect.token-highlight':'reader.token','effect.cet-card-hover':'cet.resource','effect.study-card':'study.card'} as Record<string,string>)[id]??id;}

export function uiTargetScene(id:string,group:string):UiScene {
 if (/^(home\.(hero|title|subtitle|start|hero-edge|ballpit|import|closing|footer|qr|publication-bridge|letter-field)|showcase\.|effect\.(ballpit|wordfall|letters|cover-scroll|section-reveal|bridge-reveal|closing-reveal|feedback-expand|qr-reveal|showcase|lanyard))/.test(id) && !id.startsWith('home.import-')) return 'guest';
 if (id==='study.entry'||id==='study.reminder'||id==='study.return')return 'home';
 if (id.startsWith('account.login')||id==='account.password-hint'||id==='account.guest-login')return 'guest';
 if (id==='global.pronunciation')return 'dictionary';
 if (id==='global.clear-input')return 'dictionary';
 return sceneForGroup(group);
}

export function visibleUiNode(node:Element|null):node is HTMLElement {
 if(!(node instanceof HTMLElement)||!node.isConnected||node.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
 for(let parent:HTMLElement|null=node;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.opacity==='0'||style.visibility==='hidden'||style.display==='none')return false;}
 const box=node.getBoundingClientRect(),style=getComputedStyle(node);
 return box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0';
}
export function findVisibleUiNode(selector:string){return [...document.querySelectorAll<HTMLElement>(selector)].find(visibleUiNode)??null;}

/** Runs exclusively in the isolated design iframe. Only opens UI; never submits work. */
export async function revealUiTarget(id:string,group:string,signal:AbortSignal,opened=new Set<string>()){
 const tick=()=>new Promise<void>(r=>setTimeout(r,90));
 const press=async(selector:string,text?:string,contains?:string)=>{
  const key=selector+'|'+(text??contains??'');if(signal.aborted||opened.has(key))return;
  const node=[...document.querySelectorAll<HTMLElement>(selector)].find(n=>visibleUiNode(n)&&(!text||n.textContent?.trim()===text)&&(!contains||n.textContent?.includes(contains)));
  if(node){node.click();opened.add(key);}await tick();
 };
 const studyTab=async(text:string)=>press('nav[aria-label="学习导航"] button',text);
 if(group==='study'||id.startsWith('effect.study-')){
  if(/input-|settings-row|retention|remind$|order$|pause$|study-switch/.test(id))await studyTab('设置');
  else if(/metrics|trend|donut|forecast|calendar|chart-tooltip/.test(id))await studyTab('学习数据');
  else if(/vocab-|saved-details/.test(id))await studyTab('生词本');
  else if(/rewards|milestones|reward-rules|claim|activate/.test(id))await studyTab('学习奖励');
  else if(/confirm|dialog-/.test(id)||id==='effect.study-dialog'){
   await studyTab('设置');await press('[data-ui-target="study.pause"]');
  }else if(id==='study.profile'){
   await studyTab('设置');const row=[...document.querySelectorAll<HTMLElement>('[class*="StudyPanel_settingRow"]')].find(n=>n.textContent?.includes('阅读画像'));row?.querySelector<HTMLButtonElement>('button')?.click();await tick();
  }else if(/answer|word-title|meaning|sentence|source$|more$|next$/.test(id)){
   await studyTab('背单词');await press(id==='study.next'?'[data-rating="forgot"]':'[data-rating="unsure"]');
  }else if(!['study.entry','study.reminder','study.return','study.page-title'].includes(id))await studyTab('背单词');
 }
 if(group==='menu'||id==='effect.day-night'||id==='global.feedback'){
  if(!opened.has('main-menu')){window.dispatchEvent(new Event('context-reader-open-main-menu'));opened.add('main-menu');}await tick();
  let label='';
  if(/settings|theme|toggle|day-night/.test(id))label='设置';
  else if(/feedback/.test(id))label='意见反馈';
  else if(/vocab|menu.search/.test(id))label='生词本';
  else if(/saved|article-context/.test(id))label='我的文章';
  else if(/preview-account|menu.account/.test(id))label='账号与用量';
  else if(/invite/.test(id))label='兑换邀请码';
  else if(/guide/.test(id))label='使用说明';
  if(label==='生词本'||label==='我的文章')await press(`[aria-label="打开${label}"]`);
  else if(label)await press('#home-option-menu button',label);
 }
 if(/home\.(dictionary-|dictionary$)|effect.dictionary-enter/.test(id))await press('[data-home-mode] [aria-label="单独查词"]');
 if(/home\.(preference-)/.test(id))await press('[class*="HomeRedesign_preferenceTrigger"]');
 if(id==='home.url-help')await press('[class*="HomeRedesign_importModes"] button','输入网址');
 if(id.startsWith('account.login')||id==='account.password-hint'){
  if(!opened.has('main-menu')){window.dispatchEvent(new Event('context-reader-open-main-menu'));opened.add('main-menu');}await tick();await press('[aria-label="打开登录与账号入口"]');
 }
 if(group==='reader'||id.startsWith('effect.reader-')){
  if(/dictionary/.test(id))await press('[aria-label="阅读快捷入口"] button:has(small)',undefined,'打开可移动查词窗口');
  else if(/import-|work-layer/.test(id))await press('[aria-label="阅读快捷入口"] button:has(small)',undefined,'导入新的文章或网址');
  else if(/saved-/.test(id))await press('[aria-label="阅读快捷入口"] button:has(small)',undefined,'打开保存文章');
  else if(/edit-canvas|history/.test(id))await press('[aria-label="文章工具"] button',undefined,'编辑文章');
  else if(/explanation|translation|panel-tabs|side-panel|ask-ai/.test(id)){
   await press('[data-reader-token]');
   if(/translation/.test(id))await press('[data-reader-panel-tabs] button','全文翻译');
  }
 }
 if(group==='pricing'&&/dialog/.test(id))await press('[class*="BillingPage_card"] button');
 if(group==='dictionary'&&/history-more/.test(id))await press('[class*="BookDictionary_history"] button','历史查词');
 if(group==='cet'&&!/library|filters|resource|cover|recent|select|listbox|dialog/.test(id))await press('.cet-resource-row');
 if(id==='cet.listbox')await press('.cet-select-trigger');
 if(/reward-rules|study.more/.test(id)){document.querySelectorAll<HTMLDetailsElement>('details').forEach(n=>{n.open=true;});await tick();}
}

/** Clear unrelated transient layers before revealing an inventory target. */
export async function prepareUiTarget(id:string,group:string,selector:string,signal:AbortSignal){
 const target=selector?findVisibleUiNode(selector):null;
 if(!signal.aborted&&uiTargetScene(id,group)!=='study'&&!target?.closest('dialog[data-study-open="true"]'))
  window.dispatchEvent(new Event('context-reader-leave-study'));
 const close=(selector:string)=>{if(!signal.aborted)findVisibleUiNode(selector)?.click();};
 if(group!=='menu'&&id!=='global.feedback'&&!target?.closest('[data-study-menu="true"]'))
  close('[data-study-menu="true"] button[aria-label="关闭生词本"],[data-study-menu="true"] button[aria-label="关闭保存文章"],[data-study-menu="true"] button[aria-label="关闭菜单"]');
 if(group==='study'&&!/confirm|dialog-|saved-details|vocab-detail/.test(id)&&!target?.closest('dialog[class*="StudyPanel_confirm"]'))
  close('dialog[class*="StudyPanel_confirm"][open] button[aria-label="关闭提示"]');
 if(!/dictionary/.test(id)&&!target?.closest('[aria-label="单独查词面板"]'))close('button[aria-label="隐藏单独查词窗口"]');
 if(group==='reader'&&!/import-|work-layer|saved-/.test(id)&&!target?.closest('[aria-label="导入新文章"],[aria-label="我的文章"]'))close('[aria-label="导入新文章"] button[aria-label="返回原文"],[aria-label="我的文章"] button[aria-label="返回原文"]');
 await new Promise(r=>setTimeout(r,120));
}
