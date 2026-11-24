import {strict as assert} from "node:assert";
import {test} from "node:test";
import {calendarDays,dayEntries,occurrenceKey,taskGroups,type Task,type TodoData} from "../components/todo/planner-model";

const day="2026-04-10";
const base:Task={id:"one",title:"整理一页草稿",category:"",date:"2026-04-13",time:"",lead:3,daily:false,missed:"skip",priority:"",created:day};
function workspace(tasks:Task[]):TodoData {return {version:1,categories:[],tasks,history:[],settings:{learnDefaults:false,defaultMissed:"skip",emailEnabled:false,emailAddress:"",remindMinutes:60,allDayTime:"18:00"}}}
const now=Date.parse(day+"T18:00:00+08:00");
test("start date promotes a task without moving its monthly deadline",()=>{
  assert.equal(taskGroups(workspace([base]),"today",day,day,now)[0].title,"该动手了");
  assert.equal(taskGroups(workspace([{...base,lead:1}]),"today",day,day,now).length,0);
  assert.equal(dayEntries([base],day).length,0);
  assert.equal(dayEntries([base],base.date)[0].task.id,"one");
  assert.ok(calendarDays(day.slice(0,7)).includes(base.date));
});
test("daily carry advances one unpaid instance and skip starts fresh",()=>{
  const task={...base,date:"2026-04-08",daily:true,missed:"carry" as const};
  const s=workspace([task]);
  s.history.push({key:occurrenceKey(task,task.date),taskId:task.id,occ:task.date,daily:true,title:task.title,category:"",finished:now});
  assert.equal(taskGroups(s,"today",day,day,now)[0].rows[0].occ,"2026-04-09");
  s.tasks=[{...task,missed:"skip"}];
  assert.equal(taskGroups(s,"today",day,day,now)[0].rows[0].occ,day);
});
test("24 hour view spans midnight and excludes untimed backlog",()=>{
  const s=workspace([{...base,id:"none",date:""},{...base,id:"past",date:day,time:"09:00"},
    {...base,id:"future",date:"2026-04-11",time:"12:00"},{...base,id:"all-day",date:day}]);
  assert.deepEqual(taskGroups(s,"upcoming",day,day,now).flatMap(g=>g.rows.map(e=>e.task.id)),["all-day","future"]);
});
