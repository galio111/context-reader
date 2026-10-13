import {installExperiencePreview} from './experiencePreview';
import type {AccountSessionState} from '@/types/account';
import type {DictionaryResult} from '@/types/dictionary';
import type {StudySnapshot} from '@/types/study';
import type {VocabularyEntry} from '@/types/vocabulary';
import {DEFAULT_STUDY_POLICY} from './studyPolicy';
import {explanationAsStreamText} from './explanationDisplay';
export const UI_PREVIEW_ARTICLE='The quiet power of noticing\n\nA small change in attention can transform an ordinary walk. The light shifts across a familiar street, and a detail that once went unnoticed becomes a source of curiosity.\n\nResearchers describe this habit as a deliberate practice. Rather than rushing towards a conclusion, we can pause and notice the subtle connections between things. Learning a language follows a similar rhythm: an unfamiliar word becomes meaningful when we meet it in a story.\n\nThere is no single perfect way to learn. The most enduring progress often grows from small, consistent actions. Reading a paragraph, asking a question and returning to an idea are all part of that process.';
export const UI_PREVIEW_DICTIONARY:DictionaryResult={query:'subtle',lemma:'subtle',phonetic:'/ˈsʌtəl/',direction:'en_to_cn',inputStatus:'valid',suggestedQuery:'',senses:[{partOfSpeech:'adjective',meaning:'微妙的；不易察觉的',phonetic:'/ˈsʌtəl/',register:'',usageNote:'形容细微但值得留意的区别。',exampleEnglish:'There is a subtle difference between the two ideas.',exampleChinese:'这两种想法之间有细微的差别。'}],verbForms:null,usageGuide:'常用于描述差别、变化或感受。',collocations:[{phrase:'a subtle difference',meaning:'细微的差别',exampleEnglish:'She noticed a subtle difference.'}],wordFamily:[{word:'subtly',partOfSpeech:'adverb',meaning:'微妙地'}],synonyms:[{word:'delicate',difference:'更强调精巧、脆弱。'}],commonMistakes:[],memoryTip:''};
function previewStudy():StudySnapshot{
 const now=new Date().toISOString(),day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const entries:VocabularyEntry[]=[['subtle','微妙的；不易察觉的'],['enduring','持久的'],['curiosity','好奇心'],['deliberate','有意识的'],['consistent','持续的']].map(([word,meaning],i)=>({id:'preview-word-'+i,word,lemma:word,phonetic:i===0?'/ˈsʌtəl/':'',partOfSpeech:'',basicMeaning:meaning,contextMeaning:meaning,sentenceTranslation:'我们可以停下来，留意事物之间微妙的联系。',usageNote:'',collocation:'',exampleEnglish:'We can notice the subtle connections between things.',exampleChinese:'我们可以留意事物之间微妙的联系。',sourceSentence:'We can notice the subtle connections between things.',previousSentence:'',nextSentence:'',difficulty:'medium',shouldAddToVocabulary:true,createdAt:now,updatedAt:now,anki:{canMakeCloze:false,cardMode:'basic_en_to_cn',clozeSentence:'',contextCue:'',basicCue:word,frontPreview:word,backPreview:meaning}}));
 const settings={reviewsPerDay:100,retention:.9,forgotMinutes:5,unsureMinutes:10,pausedUntil:null,reminders:true,includeAnki:false};
 const cards=entries.map((e,i)=>({id:'preview-card-'+i,entry_id:e.id,mode:'basic_en_to_cn',version:1,suspended:false,anki_pending:false,created_at:now,memory:{due:now,stability:8,difficulty:4,elapsed_days:2,scheduled_days:2,reps:i<2?3:0,lapses:0,state:i<2?2:0,learning_steps:0}}));
 return {serverNow:now,settings,cards,entries,today:{day,card_ids:cards.map(c=>c.id),new_ids:cards.slice(2).map(c=>c.id),settings,reward_points:5,completed_at:null,new_completed:0,streak:3},reviews:[],daily:Array.from({length:45},(_,i)=>({day:new Date(Date.now()-(44-i)*86400000+8*3600000).toISOString().slice(0,10),cards:12+i%18,new_cards:5+i%7,review_cards:7+i%11,learning_cards:0,active_ms:(4+i%9)*60000,successes:10+i%18,reviews:15+i%20})),policy:DEFAULT_STUDY_POLICY,streak:{current:3,best:7,last_day:day},rewards:[],claims:[{id:'preview-reward',day,milestone:null,points:5,claimed_points:5,plan:null,months:0,earned_at:now,claimed_at:now}]};
}
/** Additional fixtures are scoped to the authorized iframe's Window. No provider calls. */
export function installUiDesignPreview(account:AccountSessionState){
 const readonlyFetch=window.fetch.bind(window),restore=installExperiencePreview(account),baseFetch=window.fetch;let snapshot=previewStudy();const history:StudySnapshot[]=[];
 const nativeBeacon=navigator.sendBeacon;const xhrOpen=XMLHttpRequest.prototype.open;
 navigator.sendBeacon=()=>true;
 XMLHttpRequest.prototype.open=function(){throw new Error('界面预览不发送业务请求');};
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','X-UI-Preview':'1'}});
 window.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  if(url.origin!==location.origin)return json({error:'预览不发送外部请求。'},403);
  if(uiPreviewReadonlyAdmin(url,method))return readonlyFetch(input,init);
  const body=typeof init?.body==='string'?JSON.parse(init.body):input instanceof Request&&method!=='GET'?await input.clone().json().catch(()=>({})):{};
  if(url.pathname==='/api/study'){
   snapshot.serverNow=new Date().toISOString();
   if(body.op==='pause'){snapshot.settings.pausedUntil=new Date(Date.now()+(Number(body.days)||3)*86400000).toISOString();return json(snapshot);}
   if(body.op==='resume'){snapshot.settings.pausedUntil=null;return json(snapshot);}
   if(method==='GET'||['start','prepare'].includes(body.op))return json(snapshot);
   if(body.op==='present')return json({token:'preview-presentation'});
   if(body.op==='review'){
    history.push(structuredClone(snapshot));const card=snapshot.cards.find(c=>c.id===body.cardId);
    if(card){const previous={...card.memory};card.memory={...card.memory,due:new Date(Date.now()+86400000).toISOString(),state:2,reps:card.memory.reps+1};card.version++;snapshot.reviews.unshift({id:body.id,card_id:card.id,answer:body.answer,rating:3,reviewed_at:snapshot.serverNow,active_ms:2000,undone:false,previous,next:card.memory});}return json({snapshot});
   }
   if(body.op==='undo'){snapshot=history.pop()??snapshot;return json(snapshot);}
   if(body.op==='settings'){snapshot.settings={...snapshot.settings,...body.settings};return json(snapshot);}
   if(body.op==='claimReward'){const c=snapshot.claims.find(c=>c.id===body.id);if(c){c.claimed_points=c.points;c.claimed_at=snapshot.serverNow;}return json({claimed:{points:c?.points??0},snapshot});}
   if(body.op==='complete')return json({snapshot});return json(snapshot);
  }
  if(url.pathname==='/api/study/profile')return json({activeSeconds:4200,uniqueLookups:64,eligible:true,...(method==='POST'?{result:{summary:'你更熟悉日常与文化类文章。',recommendedLevel:'中等',strengths:['善于结合语境理解词义'],focus:['尝试稍长的论述段落']}}:{})});
  if(url.pathname==='/api/dictionary-history')return url.searchParams.get('query')==='subtle'?json({dictionary:UI_PREVIEW_DICTIONARY,updatedAt:new Date().toISOString()}):json({dictionary:null},404);
  if(url.pathname==='/api/explain-word-stream'){
   const base=snapshot.entries.find(e=>e.word===body.word)??snapshot.entries[0];
   const explanation={...base,word:body.word||base.word,lemma:body.word||base.lemma};
   return new Response(explanationAsStreamText(explanation)+'\u001e',{headers:{'Content-Type':'text/plain; charset=utf-8','X-UI-Preview':'1'}});
  }
  if(url.pathname==='/api/dictionary-stream'){
   const result=UI_PREVIEW_DICTIONARY,lines=[{type:'head',lemma:body.query||result.lemma,phonetic:result.phonetic,phoneticFor:body.query||result.query,inputStatus:'valid'},...result.senses.map(s=>({type:'sense',...s})),{type:'usage',value:result.usageGuide},...result.collocations.map(c=>({type:'collocation',...c})),...result.wordFamily.map(w=>({type:'wordFamily',...w})),...result.synonyms.map(s=>({type:'synonym',...s})),{type:'done'}];
   return new Response(lines.map(l=>JSON.stringify(l)).join('\n')+'\n',{headers:{'Content-Type':'application/x-ndjson','X-UI-Preview':'1'}});
  }
  if(url.pathname==='/api/usage/cache-lookup')return json({ok:true});
  if(url.pathname==='/api/translate-article/start')return json({actionId:body.actionId||'preview-translation',source:'generated',charged:false});
  if(url.pathname==='/api/translate-article/finish')return json({ok:true});
  if(url.pathname==='/api/translate-article')return json({translations:(body.blocks??[]).map((b:{id:string})=>({id:b.id,translation:'这是用于调整阅读界面的示例译文。留意细节，让熟悉的事物产生新的意义。'}))});
  if(url.pathname==='/api/admin/session')return json({authenticated:true,accessMode:'developer'});
  if(url.pathname==='/api/admin/public-articles')return json({articles:[]});
  if(url.pathname==='/api/admin/article-candidates')return json({articles:[],candidates:[],rejectedArticles:[]});
  if(url.pathname==='/api/admin/homepage-curation')return json({curation:{}});
  if(url.pathname==='/api/admin/models'&&method==='GET')return json({statuses:[],models:[]});
  return baseFetch(input,init);
 };
 return()=>{window.fetch=baseFetch;navigator.sendBeacon=nativeBeacon;XMLHttpRequest.prototype.open=xhrOpen;restore();};
}
/** Only reviewed business-read endpoints. Model probes and all mutations remain blocked. */
export function uiPreviewReadonlyAdmin(url:URL,method:string){
 if(method!=='GET')return false;
 const q=url.searchParams,keys=[...q.keys()],only=(allowed:string[])=>keys.every(k=>allowed.includes(k));
 if(['/api/admin/billing','/api/admin/feedback','/api/admin/error-reports','/api/admin/study'].includes(url.pathname))return keys.length===0;
 if(url.pathname==='/api/admin/accounts')return only(['view'])&&(!q.has('view')||q.get('view')==='directory');
 if(url.pathname==='/api/admin/models')return only(['config'])&&q.get('config')==='1';
 if(url.pathname==='/api/admin/product-analytics')return only(['days'])&&(!q.has('days')||['7','30','90'].includes(q.get('days')!));
 if(url.pathname==='/api/admin/usage')return only(['period','scope','date'])&&(!q.has('period')||['today','yesterday','7','30','date'].includes(q.get('period')!))&&(!q.has('scope')||['all','reader','system','unclassified'].includes(q.get('scope')!))&&(!q.has('date')||/^\d{4}-\d\d-\d\d$/.test(q.get('date')!));
 return false;
}
