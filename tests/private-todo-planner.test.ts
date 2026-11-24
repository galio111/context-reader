import {strict as assert} from "node:assert";
import {test} from "node:test";
import {calendarDays,updateCategories,urgencyLabel,dayEntries,occurrenceKey,taskGroups,type Task,type TodoData} from "../components/todo/planner-model";

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
test("daily tasks only appear in Today and categories can accept their first task",()=>{
  const s=workspace([{...base,id:"routine",daily:true,date:day,priority:"high",category:"Daily"},
    {...base,id:"regular",date:day,category:"Work"},{...base,id:"unscheduled",date:""}]);
  s.categories=["Work","Empty","Daily"];
  assert.deepEqual(dayEntries(s.tasks,day).map(e=>e.task.id),["regular"]);
  for(const view of ["today","upcoming","all","day"] as const) {
    assert.equal(taskGroups(s,view,day,day,now).some(g=>g.rows.some(e=>e.task.id==="routine")),view==="today");
  }
  assert.deepEqual(taskGroups(s,"all",day,day,now).map(g=>[g.title,g.rows.map(e=>e.task.id)]),
    [["Work",["regular"]],["Empty",[]],["Daily",[]],["未分类",["unscheduled"]]]);
});
test("urgency respects start dates, upcoming deadlines, recurring dates and explicit priority",()=>{
  assert.equal(urgencyLabel(base,day,now),"已到开工日");
  assert.equal(urgencyLabel({...base,lead:0},day,now),"");
  assert.equal(urgencyLabel({...base,date:day,time:"09:00"},day,now),"已过截止");
  assert.equal(urgencyLabel({...base,date:"2026-04-11",time:"13:00"},day,now),"24 小时内到期");
  assert.equal(urgencyLabel({...base,daily:true,date:day},day,now),"");
  assert.equal(urgencyLabel({...base,priority:"high",date:""},day,now),"高优先级");
});
test("removing a category retains recurring and one-off tasks, historic completions and unrelated concurrent categories",()=>{
  const s=workspace([{...base,category:"学习"},{...base,id:"daily",daily:true,category:"学习"},{...base,id:"other",category:"生活"}]);
  s.categories=["学习","生活","另一端新增"];
  s.history=[{key:"one@once",taskId:"one",occ:day,daily:false,title:base.title,category:"学习",finished:now}];
  const changed=updateCategories(s,["科研"],["学习"]);
  assert.deepEqual(changed.categories,["生活","另一端新增","科研"]);
  assert.deepEqual(changed.tasks,s.tasks.map(t=>({...t,category:t.category==="学习"?"":t.category})));
  assert.deepEqual(changed.history,s.history);
  assert.deepEqual(updateCategories(changed,["科研"],["学习"]),changed);
});
test("renaming updates task and history labels in place, and rejects a competing name",()=>{
  const state=workspace([{...base,category:"学习"}]);state.categories=["学习","生活"];
  state.history=[{key:"one@once",taskId:"one",occ:day,daily:false,title:base.title,category:"学习",finished:now}];
  const next=updateCategories(state,[],[],[{from:"学习",to:"课程"}]);
  assert.deepEqual(next.categories,["课程","生活"]);
  assert.deepEqual(next.tasks,[{...state.tasks[0],category:"课程"}]);
  assert.deepEqual(next.history,[{...state.history[0],category:"课程"}]);
  assert.throws(()=>updateCategories(state,[],[],[{from:"学习",to:"生活"}]));
  assert.throws(()=>updateCategories(next,[],[],[{from:"学习",to:"科研"}]));
});
test("24 hour view spans midnight and excludes untimed backlog",()=>{
  const s=workspace([{...base,id:"none",date:""},{...base,id:"past",date:day,time:"09:00"},
    {...base,id:"future",date:"2026-04-11",time:"12:00"},{...base,id:"all-day",date:day}]);
  assert.deepEqual(taskGroups(s,"upcoming",day,day,now).flatMap(g=>g.rows.map(e=>e.task.id)),["all-day","future"]);
});
