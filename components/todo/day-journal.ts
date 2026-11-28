import {dayReview,eventTime,isoDay,occurrenceKey,type Entry,type TodoData} from "./planner-model";
import type {CalendarEvent} from "@/lib/privateTodoState";

export type JournalPlan=Pick<TodoData,"tasks"> & {day:string;events:CalendarEvent[]};
export type JournalRow={
  key:string;group:string;kind:string;title:string;category:string;when:string;occ:string;
  finished?:number;entry?:Entry;historyKey?:string;
};

export function journalRows(state:TodoData,day:string):JournalRow[] {
  const {groups,events,completed}=dayReview(state,day);
  const rows:JournalRow[]=events.map(event=>({key:"event:"+event.id,group:"日程",kind:"事件",
    title:event.title,category:"",when:eventTime(event),occ:day}));
  // An older journal receipt can be the only surviving record of a removed event.
  const scheduled=new Set(events.map(event=>event.id));
  for(const receipt of state.eventChecks||[]) {
    if(receipt.day!==day || scheduled.has(receipt.eventId))continue;
    rows.push({key:"event:"+receipt.eventId,group:"日程",kind:"事件",title:receipt.title,category:"",when:"",occ:day});
  }
  for(const group of groups)for(const entry of group.rows) {
    const t=entry.task;
    rows.push({key:occurrenceKey(t,entry.occ),entry,group:group.title==="该动手了"?"到期或已到开工日":group.title,
      kind:t.daily?"每日任务":"待办",title:t.title,category:t.category,occ:entry.occ,when:t.time || "全天"});
  }
  const completedEarly=state.history.filter(h=>!h.daily && !h.importedWithoutCompletionDate && h.occ===day &&
    (h.creditedDay || isoDay(h.finished))<day);
  for(const h of [...completed,...completedEarly]){
    const t=state.tasks.find(t=>t.id===h.taskId);
    rows.push({key:h.key,historyKey:h.key,group:completedEarly.includes(h)?"提前完成":"当日已完成",kind:h.daily?"每日任务":"待办",title:h.title,category:h.category,
      occ:h.occ,when:t?.time||"",finished:h.finished});
  }
  return rows;
}

const clock=new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"Asia/Shanghai"});
export function stamp(ms:number) {return isoDay(ms)+" "+clock.format(ms)}
export const journalHeader=["日志日期","类型","事项","分类","计划日期","时间","状态","实际勾选时间","记录来源"];
export function journalCsvLines(day:string,rows:JournalRow[],reconstructed=false) {
  const cells=rows.length?rows.map(r=>[day,r.kind,r.title,r.category,r.occ,r.when,
    r.kind==="事件"?"":r.finished===undefined?"未完成":"已完成",r.finished===undefined?"":stamp(r.finished)]):
    [[day,"","","","","","无记录",""]];
  return cells.map(fields=>[...fields,reconstructed?"启用前回溯":"日志"].map(value=>{
    const safe=/^(?:[\t\r\n]|\s*[=+@-])/.test(value)?"'"+value:value;
    return '"'+safe.replaceAll('"','""')+'"';
  }).join(","));
}
