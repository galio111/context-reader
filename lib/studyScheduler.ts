import { BasicLearningStepsStrategy, createEmptyCard, fsrs, Rating, State, StrategyMode, type Card, type StepUnit } from "ts-fsrs";
import type { StudyAnswer, StudyCard, StudyMemory, StudySettings } from "@/types/study";

// Pin the library and store the identity with every event. No hand-written interval multiplier.
export const STUDY_ALGORITHM = "FSRS-6/ts-fsrs-5.4.2";
export const DEFAULT_STUDY_SETTINGS: StudySettings = {
  reviewsPerDay: 100, retention: 0.9, forgotMinutes:5, unsureMinutes:10, pausedUntil: null, reminders: true, includeAnki: false,
};
export function studyRating(answer: StudyAnswer): Rating.Again | Rating.Hard | Rating.Good {
  switch (answer) {
    case "forgot": case "unsure_wrong": return Rating.Again;
    case "unsure_right": return Rating.Hard;
    case "remembered": return Rating.Good;
    default: throw new Error("Invalid recall outcome");
  }
}
export function scheduler(retention = 0.9, steps: Pick<StudySettings,"forgotMinutes"|"unsureMinutes"> = {}) {
  const forgot=steps.forgotMinutes??5,unsure=steps.unsureMinutes??10;
  return fsrs({ request_retention: retention, enable_fuzz: false, enable_short_term: true,
    learning_steps: [(forgot+"m") as StepUnit, (unsure+"m") as StepUnit], relearning_steps: [(forgot+"m") as StepUnit], maximum_interval: 36500 })
    .useStrategy(StrategyMode.LEARNING_STEPS,(params,state,step)=>{
      const result=BasicLearningStepsStrategy(params,state,step);
      // FSRS still updates S/D and all long-term intervals. Only explicit intraday steps change.
      result[Rating.Again]={scheduled_minutes:forgot,next_step:0};
      if(state!==State.Review)result[Rating.Hard]={scheduled_minutes:unsure,next_step:step};
      return result;
    });
}
export function memoryFromCard(card: Card): StudyMemory {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() };
}
export function cardFromMemory(memory: StudyMemory): Card {
  return { ...memory, due: new Date(memory.due), last_review: memory.last_review ? new Date(memory.last_review) : undefined };
}
export function newMemory(now: Date): StudyMemory { return memoryFromCard(createEmptyCard(now)); }
export function scheduleStudy(memory: StudyMemory, answer: StudyAnswer, now: Date, retention: number, steps: Pick<StudySettings,"forgotMinutes"|"unsureMinutes"> = {}) {
  if (memory.last_review && now.getTime() < Date.parse(memory.last_review)) throw new Error("Review clock moved backwards");
  const result = scheduler(retention,steps).next(cardFromMemory(memory), now, studyRating(answer));
  return { memory: memoryFromCard(result.card), log: result.log };
}
export function recallProbability(memory: StudyMemory, now: Date): number | null {
  if (!memory.last_review || memory.state === State.New) return null;
  return scheduler().get_retrievability(cardFromMemory(memory), now, false) as number;
}
export function shanghaiDay(now: Date): string { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
export function studyDayEnd(now: Date): Date { return new Date(Date.parse(shanghaiDay(now) + "T16:00:00Z")); }
export function studyPaused(settings: StudySettings, now: Date) { return Boolean(settings.pausedUntil && Date.parse(settings.pausedUntil) > now.getTime()); }
export function sanitizeStudySettings(input: unknown, current = DEFAULT_STUDY_SETTINGS): StudySettings {
  const p = input as Partial<StudySettings>;
  if (!p || typeof p !== "object") throw new Error("学习设置无效。");
  const integer = (value: unknown, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) throw new Error("每日数量超出允许范围。");
    return value;
  };
  const retention = p.retention ?? current.retention;
  if (typeof retention !== "number" || !Number.isFinite(retention) || retention < .8 || retention > .95) throw new Error("目标记住概率应在 80%–95% 之间。");
  for (const key of ["reminders", "includeAnki"] as const) if (p[key] !== undefined && typeof p[key] !== "boolean") throw new Error("学习设置无效。");
  return { ...current,
    forgotMinutes:Math.max(1,integer(p.forgotMinutes,current.forgotMinutes??5,120)),
    unsureMinutes:Math.max(1,integer(p.unsureMinutes,current.unsureMinutes??10,120)),
    reviewsPerDay: Math.max(1, integer(p.reviewsPerDay, current.reviewsPerDay, 300)), retention,
    reminders: p.reminders ?? current.reminders, includeAnki: p.includeAnki ?? current.includeAnki };
}
export function buildStudyPlan(cards: StudyCard[], settings: StudySettings, now: Date): string[] {
  if (studyPaused(settings, now)) return [];
  const eligible = cards.filter(c => !c.suspended && (!c.anki_pending || settings.includeAnki));
  const due = eligible.filter(c => c.memory.state !== State.New && Date.parse(c.memory.due) <= now.getTime())
    .sort((a, b) => Date.parse(a.memory.due) - Date.parse(b.memory.due) || a.id.localeCompare(b.id));
  // Catch up before introducing more work.
  const fresh = eligible.filter(c => c.memory.state === State.New).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return [...due.slice(0, settings.reviewsPerDay), ...fresh].map(c => c.id);
}
export function planProgress(cards: StudyCard[], ids: string[], now: Date, newIds?: string[]) {
  const byId = new Map(cards.map(c => [c.id,c]));
  const selected = ids.flatMap(id => { const c = byId.get(id); return c && !c.suspended ? [c] : []; });
  const end = studyDayEnd(now).getTime();
  const finished = selected.filter(c => c.memory.last_review && shanghaiDay(new Date(c.memory.last_review)) === shanghaiDay(now)
    && c.memory.state === State.Review && Date.parse(c.memory.due) >= end);
  const finishedSet=new Set(finished);
  const newSet=new Set(newIds??selected.filter(c=>c.memory.state===State.New).map(c=>c.id));
  const reviewRemaining=selected.some(c=>!newSet.has(c.id)&&!finishedSet.has(c));
  const available=selected.filter(c=>!finishedSet.has(c)&&(!reviewRemaining||!newSet.has(c.id)));
  const ready = available.filter(c => Date.parse(c.memory.due) <= now.getTime())
    .sort((a,b) => (a.memory.state === State.New ? 1 : 0) - (b.memory.state === State.New ? 1 : 0) || Date.parse(a.memory.due) - Date.parse(b.memory.due));
  const readySet = new Set(ready);
  const waiting = available.filter(c => !readySet.has(c));
  return { total: selected.length, finished: finished.length, ready, waiting, blockedNew:reviewRemaining?selected.filter(c=>newSet.has(c.id)&&!finishedSet.has(c)).length:0 };
}
