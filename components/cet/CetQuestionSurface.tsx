"use client";
import type {MouseEvent, ReactNode} from "react";
import type {CetQuestion, CetSection} from "@/types/cet";

export type QuestionSurface = "inline" | "dock";
export interface QuestionAction {id:string; label:string; disabled?:boolean; invoke:()=>void; className?:string}
export function CetQuestionActions({surface,actions,children}:{surface:QuestionSurface;actions:QuestionAction[];children?:ReactNode}) {
  return <div className="cet-question-actions" data-question-actions={surface}>{actions.map(action=><button type="button" key={action.id} data-action={action.id} className={action.className} disabled={action.disabled} onClick={action.invoke}>{action.label}</button>)}{children}</div>;
}
export function CetQuestionSurface({surface,section,disabled,answerFor,revealed,renderText,explain,onAnswer,onOpenChoice,openNumber}:{
  surface:QuestionSurface; section:CetSection; disabled:boolean;
  answerFor:(q:CetQuestion)=>string; revealed:(q:CetQuestion)=>boolean;
  renderText:(text:string)=>ReactNode; explain:(q:CetQuestion,surface:QuestionSurface)=>ReactNode;
  onAnswer:(q:CetQuestion,value:string)=>void;
  onOpenChoice:(event:MouseEvent<HTMLButtonElement>,q:CetQuestion,surface:QuestionSurface)=>void;
  openNumber?:number;
}) {
  if(surface==='inline'&&section.type==='cloze')return <section className="cet-cloze-explanations">{section.questions.filter(revealed).map(q=><div key={q.number}><h3>第 {q.number} 空</h3>{explain(q,surface)}</div>)}</section>;
  return <div className="cet-questions" data-question-surface={surface}>
    {surface==='dock'&&section.bank&&<div className="cet-word-bank">{section.bank.map(option=><span key={option.key} data-used={section.questions.some(q=>answerFor(q)===option.key)||undefined}><b>{option.key}</b> {renderText(option.text)}{section.questions.some(q=>answerFor(q)===option.key)&&<small>已用</small>}</span>)}</div>}
    {section.questions.map(q=><section id={`cet-${surface}-q-${q.number}`} key={q.number}>
    <h2><b>{q.number}.</b> {section.type==='cloze'?'选择单词':renderText(q.stem)}</h2>
    {section.type==='detail'?<div role="radiogroup" aria-label={`第 ${q.number} 题选项`}>{q.options.map(option=><div className="cet-option" data-chosen={answerFor(q)===option.key} key={option.key}>
      <button type="button" role="radio" aria-label={`第 ${q.number} 题选择 ${option.key}`} aria-checked={answerFor(q)===option.key} disabled={disabled||revealed(q)} onClick={()=>onAnswer(q,answerFor(q)===option.key?'':option.key)}>{option.key}</button><span>{renderText(option.text)}</span>
    </div>)}</div>:<button type="button" className="cet-match-choice" aria-haspopup="listbox" aria-expanded={openNumber===q.number} disabled={disabled||revealed(q)} onClick={e=>onOpenChoice(e,q,surface)}>{answerFor(q)?section.type==='matching'?`${answerFor(q)} 段`:`${answerFor(q)} ${q.options.find(o=>o.key===answerFor(q))?.text||''}`:section.type==='matching'?'选择段落':'选择单词'} <span aria-hidden="true">⌄</span></button>}
    {revealed(q)&&explain(q,surface)}
  </section>)}</div>;
}
