import type { StudyCard, StudySnapshot } from "@/types/study";
import { shanghaiDay, studyDayEnd, studyQueuePriority, isStudyLearning, recallProbability } from "./studyScheduler";

export function studyWordState(card: StudyCard, now: Date): "new"|"learning"|"review"|"steady" {
  if(card.memory.state===0)return "new";
  if(isStudyLearning(card.memory))return "learning";
  return card.memory.stability>=21&&(recallProbability(card.memory,now)??0)>=.9?"steady":"review";
}

export function activeStudySnapshot(snapshot: StudySnapshot): StudySnapshot {
  if(snapshot.settings.includeAnki)return snapshot;
  const cards=snapshot.cards.filter(card=>!card.anki_pending);
  const ids=new Set(cards.map(card=>card.entry_id));
  return {...snapshot,cards,entries:snapshot.entries.filter(entry=>ids.has(entry.id))};
}

export function chooseStudyCard(ready: StudyCard[], current: string, order: "ordered" | "random", ranks: Map<string, number>, newTurn=false) {
  const displayed = ready.find(card => card.id === current);
  if (displayed) return displayed;
  if (order === "ordered") return ready[0];
  // Only reorder already-eligible cards, and never let a new word precede due learning.
  return [...ready].sort((a,b) => (newTurn?Number(b.memory.state===0)-Number(a.memory.state===0):0) || studyQueuePriority(a)-studyQueuePriority(b) || (ranks.get(a.id) ?? 0)-(ranks.get(b.id) ?? 0))[0];
}
export function remainingStudyCounts(cards: StudyCard[], ids: string[], now: Date, paused = false) {
  if (paused) return { learning: 0, review: 0 };
  const planned = new Set(ids), end = studyDayEnd(now).getTime();
  const active = cards.filter(card => planned.has(card.id) && !card.suspended);
  return {
    learning: active.filter(card => isStudyLearning(card.memory)&&Date.parse(card.memory.due)<end).length,
    review: active.filter(card => card.memory.state === 2 && Date.parse(card.memory.due) < end).length,
  };
}
export function studyHistoryDays(daily: StudySnapshot["daily"], today: string, count: number) {
  const byDay = new Map(daily.map(day => [day.day, day]));
  const end = Date.parse(today+"T00:00:00Z");
  return Array.from({length:count}, (_,i) => {
    const day = new Date(end-(count-1-i)*86400000).toISOString().slice(0,10);
    return byDay.get(day) ?? {day,cards:0,active_ms:0,successes:0,reviews:0};
  });
}
/** Allocate the current due inventory, including backlog, without inventing future FSRS answers. */
export function studyForecast(cards: StudyCard[], now: Date, includeAnki: boolean, reviewsPerDay = 100, completedToday = 0, pausedUntil: string | null = null, todayIds?:string[]) {
  const today = shanghaiDay(now);
  const active=cards.filter(c=>!c.suspended&&(!c.anki_pending||includeAnki));
  const planned=todayIds?new Set(todayIds):null;
  const todayRemaining=planned?active.filter(c=>planned.has(c.id)&&c.memory.state!==0&&Date.parse(c.memory.due)<studyDayEnd(now).getTime()):[];
  const consumed=new Set(todayRemaining.map(c=>c.id));
  const inventory=planned?active.filter(c=>!consumed.has(c.id)):active;
  const learning=inventory.filter(c=>isStudyLearning(c.memory)).map(c=>shanghaiDay(new Date(c.memory.due)));
  const due = inventory.filter(c => c.memory.state === 2)
    .map(c => shanghaiDay(new Date(c.memory.due))).sort();
  let index = 0, backlog = 0;
  return Array.from({length:7},(_,i)=>{
    const day = new Date(Date.parse(today+"T00:00:00Z")+i*86400000).toISOString().slice(0,10);
    if(i===0&&planned)return {day,count:pausedUntil&&Date.parse(pausedUntil)>now.getTime()?0:todayRemaining.length,remaining:0};
    while (index < due.length && due[index] <= day) { backlog++; index++; }
    const paused = pausedUntil && day < shanghaiDay(new Date(pausedUntil));
    const capacity = paused ? 0 : Math.max(0, reviewsPerDay - (i === 0 ? completedToday : 0));
    const reviews = Math.min(backlog, capacity);
    const learningCount=paused?0:learning.filter(d=>d<=day).length;
    if(!paused)for(let j=learning.length-1;j>=0;j--)if(learning[j]<=day)learning.splice(j,1);
    const count=reviews+learningCount;
    backlog -= reviews;
    return {day,count,remaining:backlog};
  });
}
