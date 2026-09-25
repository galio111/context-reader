import type {CetActivity} from '../types/cet';
export interface CetTimerEpoch {
 eventId:string;epochId:string;previousEpochId:string;kind:'reset'|'countdown';at:string;
 scope:string;mode:'countup'|'countdown';budgetMs?:number;baseEffectiveMs:number;
 previousDisplay:number;runningState:'running'|'paused';
}
export const cetTimerScope=(a:CetActivity,sectionId:string)=>a.purpose==='practice'?sectionId:'$self';
export function cetEpochDepth(event:CetTimerEpoch,all:Record<string,CetTimerEpoch>):number{
 let depth=0,current=event;const seen=new Set<string>();
 while(current&&!seen.has(current.epochId)){seen.add(current.epochId);depth++;current=all[current.previousEpochId];}return depth;
}
export function currentCetEpoch(a:CetActivity,sectionId:string):CetTimerEpoch|undefined{
 const all=a.timerEpochs||{};
 return Object.values(all).filter(e=>e.scope===cetTimerScope(a,sectionId)).sort((a,b)=>cetEpochDepth(a,all)-cetEpochDepth(b,all)||a.at.localeCompare(b.at)||a.epochId.localeCompare(b.epochId)).at(-1);
}
export function projectCetTimer(a:CetActivity,sectionId:string,now=Date.now(),practiceDelta=0){
 const epoch=currentCetEpoch(a,sectionId);
 let total:number;
 if(a.purpose==='practice')total=Object.entries(a.timerParts).reduce((n,[id,ms])=>n+(id.startsWith(sectionId+'#')?ms:0),0)+practiceDelta;
 else if(a.schemaVersion===4||a.timerMode==='countup')total=a.elapsedMs+(a.status==='in_progress'&&a.runningSince?Math.max(0,now-Date.parse(a.runningSince)):0);
 else total=a.legacy?a.elapsedMs:Math.max(0,(a.budgetMs||0)-Math.max(0,(a.remainingMs??a.budgetMs??0)-(a.status==='in_progress'&&a.runningSince?Math.max(0,now-Date.parse(a.runningSince)):0)));
 const mode=epoch?.mode||(a.purpose==='self_test'&&a.timerMode!=='countup'?'countdown':'countup');
 const base=epoch?.baseEffectiveMs||0,budget=epoch?.budgetMs??a.budgetMs??0;
 if(mode==='countdown')total=Math.min(total,base+budget);
 const elapsed=Math.max(0,total-base),remaining=mode==='countdown'?Math.max(0,budget-elapsed):Infinity;
 return {total,elapsed,remaining,display:mode==='countdown'?remaining:elapsed,mode,budget,epoch};
}
export interface CetTimerTarget {owner:string;activityId:string;sectionId:string;revision:string}
export function adjustCetTimer(a:CetActivity,target:CetTimerTarget,kind:'reset'|'countdown',minutes:number|undefined,at:string,eventId:string):CetActivity{
 if(a.timerEpochs?.[eventId])return a;
 if(a.owner!==target.owner||a.id!==target.activityId||a.activeSection!==target.sectionId||a.timerRevision!==target.revision)throw Error('计时目标已改变，请重新打开设置。');
 if(a.legacy||a.status==='submitted'||a.status==='ended'||a.purpose==='practice'&&Object.values(a.finalizations).some(f=>f.sectionId===target.sectionId))throw Error('已固定记录不可调整。');
 const previous=projectCetTimer(a,target.sectionId,Date.parse(at));
 if(a.purpose==='self_test'&&a.status==='in_progress'&&previous.remaining===0)throw Error('自测已到时，请先保存结果。');
 if(kind==='countdown'&&(!Number.isInteger(minutes)||minutes!<1||minutes!>180))throw Error('请输入1–180整数分钟。');
 const running=a.purpose==='practice'?!a.practiceTimerPaused:a.status==='in_progress';
 const mode=kind==='countdown'?'countdown':previous.mode,budgetMs=mode==='countdown'?(kind==='countdown'?minutes!*60000:previous.budget):undefined;
 const event:CetTimerEpoch={eventId,epochId:eventId,previousEpochId:previous.epoch?.epochId||'legacy',kind,at,scope:cetTimerScope(a,target.sectionId),mode,budgetMs,baseEffectiveMs:previous.total,previousDisplay:previous.display,runningState:running?'running':'paused'};
 return {...a,schemaVersion:4,upgradedFromVersion:a.upgradedFromVersion||(a.schemaVersion===4?2:a.schemaVersion),
  timerEpochs:{...a.timerEpochs,[eventId]:event},timerMode:a.purpose==='self_test'?mode:a.timerMode,
  budgetMs:a.purpose==='self_test'?budgetMs:a.budgetMs,remainingMs:a.purpose==='self_test'?budgetMs:a.remainingMs,
  elapsedMs:a.purpose==='self_test'?previous.total:a.elapsedMs,runningSince:a.purpose==='self_test'&&running?at:a.runningSince,
  timerRevision:`${at}:${eventId}`,updatedAt:at,conditions:[...new Set([...a.conditions,'timer_adjusted'])]};
}
