import type { StudyCard, StudySnapshot } from "@/types/study";
import { shanghaiDay } from "./studyScheduler";

export function activeStudySnapshot(snapshot: StudySnapshot): StudySnapshot {
  if(snapshot.settings.includeAnki)return snapshot;
  const cards=snapshot.cards.filter(card=>!card.anki_pending);
  const ids=new Set(cards.map(card=>card.entry_id));
  return {...snapshot,cards,entries:snapshot.entries.filter(entry=>ids.has(entry.id))};
}

export function chooseStudyCard(ready: StudyCard[], current: string, order: "ordered" | "random", ranks: Map<string, number>) {
  const displayed = ready.find(card => card.id === current);
  if (displayed) return displayed;
  if (order === "ordered") return ready[0];
  // Only reorder already-eligible cards, and never let a new word precede due learning.
  return [...ready].sort((a,b) => Number(a.memory.state === 0)-Number(b.memory.state === 0) || (ranks.get(a.id) ?? 0)-(ranks.get(b.id) ?? 0))[0];
}
export function studyHistoryDays(daily: StudySnapshot["daily"], today: string, count: number) {
  const byDay = new Map(daily.map(day => [day.day, day]));
  const end = Date.parse(today+"T00:00:00Z");
  return Array.from({length:count}, (_,i) => {
    const day = new Date(end-(count-1-i)*86400000).toISOString().slice(0,10);
    return byDay.get(day) ?? {day,cards:0,active_ms:0,successes:0,reviews:0};
  });
}
export function studyForecast(cards: StudyCard[], now: Date, includeAnki: boolean) {
  const today = shanghaiDay(now);
  return Array.from({length:7},(_,i)=>{
    const day = new Date(Date.parse(today+"T00:00:00Z")+(i+1)*86400000).toISOString().slice(0,10);
    return {day,count:cards.filter(c=>!c.suspended&&(!c.anki_pending||includeAnki)&&c.memory.state!==0&&shanghaiDay(new Date(c.memory.due))===day).length};
  });
}
