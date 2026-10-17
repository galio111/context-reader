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
/** Date inventory, not a capped workload simulation. Overdue words belong to today. */
export function studyForecast(cards: StudyCard[], now: Date, includeAnki: boolean, _reviewsPerDay = 100, _completedToday = 0, _pausedUntil: string | null = null, _todayIds?:string[]) {
  void _reviewsPerDay; void _completedToday; void _pausedUntil; void _todayIds; // Legacy call compatibility; never cap inventory.
  const today = shanghaiDay(now);
  const days = Array.from({length:7},(_,i)=>({day:new Date(Date.parse(today+"T00:00:00Z")+i*86400000).toISOString().slice(0,10),count:0,remaining:0}));
  for (const card of cards) {
    if (card.suspended || (card.anki_pending && !includeAnki) || card.memory.state === 0) continue;
    const due = shanghaiDay(new Date(card.memory.due));
    const bucket = days.find(d=>d.day === (due < today ? today : due));
    if (bucket) bucket.count++;
  }
  return days;
}
