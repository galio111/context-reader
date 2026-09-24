import type { CetActivity, CetPaper } from "../types/cet";
import { cetFinalize, cetQuestionSnapshots } from "./cetActivity";

/** Pure preparation: the caller checkpoints the timer once and persists once. */
export function prepareCetPracticeSubmitAll(activity: CetActivity, paper: CetPaper, operationId: string, now = new Date().toISOString()): CetActivity {
  if (activity.purpose !== "practice" || activity.legacy) throw new Error("只能提交当前新版阅读练习。");
  if (!operationId || activity.paperId !== paper.id) throw new Error("练习身份不一致，原记录已保留。");
  const keys = cetQuestionSnapshots(paper, activity.sectionIds).map(q => q.key);
  if (new Set(keys).size !== keys.length || keys.length !== activity.questionKeys.length || keys.some(key => !activity.questionKeys.includes(key))) throw new Error("题目范围不一致，原记录已保留。");
  const snapshots = Object.values(activity.finalizations);
  if (activity.conditions.includes("submission_conflict") || new Set(snapshots.map(f => f.sectionId)).size !== snapshots.length) throw new Error("存在不同提交结果，请先查看冲突记录。");
  if (activity.status === "ended" || activity.status === "submitted") return activity;
  let result = activity;
  for (const sectionId of activity.sectionIds) {
    if (!snapshots.some(f => f.sectionId === sectionId)) result = cetFinalize(result, paper, "passage_submit", sectionId, now, `${operationId}:${sectionId}`);
  }
  return result;
}

export function cetPracticeTotals(activity: CetActivity) {
  const snapshots = Object.values(activity.finalizations).filter(f => f.sectionId && activity.sectionIds.includes(f.sectionId));
  const conflict = activity.conditions.includes("submission_conflict") || new Set(snapshots.map(f => f.sectionId)).size !== snapshots.length;
  if (conflict) return { conflict: true, completed: new Set(snapshots.map(f => f.sectionId)).size, correct: 0, scoreable: 0, unanswered: 0, unreliable: 0, elapsedMs: 0 };
  return { conflict: false, completed: snapshots.length, ...snapshots.reduce((total, f) => ({ correct: total.correct + f.correct, scoreable: total.scoreable + f.scoreable, unanswered: total.unanswered + f.unanswered, unreliable: total.unreliable + f.unreliable, elapsedMs: total.elapsedMs + f.elapsedMs }), { correct: 0, scoreable: 0, unanswered: 0, unreliable: 0, elapsedMs: 0 }) };
}
