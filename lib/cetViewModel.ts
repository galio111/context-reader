import type { CetActivity, CetFinalization, CetPaper } from "@/types/cet";
import { cetQuestionKey } from "./cetActivity";

/** One scope and one selected snapshot feed counts, cards, passage answers and results. */
export function cetViewModel(paper: CetPaper, activity: CetActivity | null, entrySectionId?: string, selectedFinalId?: string) {
  const ids = activity?.sectionIds || (entrySectionId ? [entrySectionId] : paper.sections.map(s=>s.id));
  const finals = Object.values(activity?.finalizations || {});
  const selected = finals.find(f=>f.id===selectedFinalId);
  const snapshotFor = (sectionId:string): CetFinalization | undefined => {
    if(activity?.purpose==='self_test') return selected || finals[0];
    return selected?.questions.some(q=>q.sectionId===sectionId) ? selected : finals.find(f=>f.sectionId===sectionId) || finals.find(f=>f.reason==='ended_for_study' && f.questions.some(q=>q.sectionId===sectionId));
  };
  const keys = activity?.questionKeys || paper.sections.filter(s=>ids.includes(s.id)).flatMap(s=>s.questions.map(q=>cetQuestionKey(s.id,q.number)));
  const keySet = new Set(keys);
  const sections = ids.flatMap(id=> {
    const section=paper.sections.find(s=>s.id===id); if(!section)return [];
    const snapshot=snapshotFor(id);
    const questions=snapshot ? snapshot.questions.filter(q=>q.sectionId===id).map(q=>({...q})) : section.questions.filter(q=>keySet.has(cetQuestionKey(id,q.number)));
    return [{...section,questions}];
  });
  const answer = (sectionId:string,key:string) => {const snapshot=snapshotFor(sectionId);return snapshot ? snapshot.answers[key] || "" : activity?.answers[key]?.value || "";};
  const state = (sectionId:string,key:string) => {
    const snapshot=snapshotFor(sectionId), question=snapshot?.questions.find(q=>q.key===key);
    if(!snapshot || !question) return answer(sectionId,key) ? 'answered' : 'draft';
    if(!question.answer || !question.options.some(o=>o.key===question.answer))return 'unverified';
    if(!snapshot.answers[key])return 'unanswered';
    return snapshot.answers[key]===question.answer ? 'correct' : 'incorrect';
  };
  const renderedKeys=sections.flatMap(s=>s.questions.map(q=>cetQuestionKey(s.id,q.number)));
  const mismatch=renderedKeys.length!==keys.length || renderedKeys.some(k=>!keySet.has(k)) || sections.length!==ids.length;
  return {sections, keys, total:keys.length, answered:keys.filter(k=>answer(k.slice(0,k.lastIndexOf(':')),k)).length, answer, state, snapshotFor, mismatch};
}
