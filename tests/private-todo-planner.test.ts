import {strict as assert} from "node:assert";
import {test} from "node:test";
import {isSpringFestival} from "../components/todo/lunar-calendar";

test("Spring Festival follows lunar New Year across Gregorian months and adjacent dates",()=>{
  for(const date of ["2025-01-29","2026-02-17","2027-02-06","2028-01-26"]) {
    assert.equal(isSpringFestival(date),true);
    for(const offset of [-1,1]) {
      const adjacent = new Date(Date.parse(date+"T12:00:00Z")+offset*86400000);
      assert.equal(isSpringFestival(adjacent.toISOString().slice(0,10)),false);
    }
  }
});
import {dayReview,upcomingAgenda,reorderCategory,calendarDays,dateLabel,weekStart,calendarItems,eventsOnDay,firstEventDate,updateCategories,urgencyLabel,dayEntries,occurrenceKey,taskGroups,type Task,type TodoData} from "../components/todo/planner-model";

import {isCalendarEvent,type CalendarEvent} from "../lib/privateTodoState";
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
test("the calendar drops completed instances and restores them without removing fixed events",()=>{
  const once={...base,date:day,priority:"high" as const};
  const event:CalendarEvent={id:"one",title:"组会",frequency:"weekly",weekdays:[5],monthDay:10,startDate:day,endDate:"",startTime:"09:00",endTime:"10:00",color:"#234567"};
  assert.deepEqual(calendarItems([once],[event],day,new Set([occurrenceKey(once,day)])).map(i=>i.key),["event:one"]);
  assert.deepEqual(calendarItems([once],[event],day,new Set()).map(i=>i.key),["task:one","event:one"]);
});
test("weekly term bounds, multiple weekdays, monthly short months and leap years",()=>{
  const event:CalendarEvent={id:"course",title:"课程",frequency:"weekly",weekdays:[1,3],monthDay:31,startDate:"2026-11-24",endDate:"2026-11-30",startTime:"09:00",endTime:"10:00",color:"#234567"};
  assert.ok(isCalendarEvent(event));assert.ok(!isCalendarEvent({...event,weekdays:[]}));assert.ok(!isCalendarEvent({...event,endTime:"08:59"}));
  assert.equal(firstEventDate(event),"2026-11-25");
  for(const [date,expected] of [["2026-11-23",0],["2026-11-25",1],["2026-11-30",1],["2026-12-02",0]] as const)assert.equal(eventsOnDay([event],date).length,expected);
  const monthly={...event,frequency:"monthly" as const,startDate:"2028-02-01",endDate:""};
  assert.equal(firstEventDate(monthly),"2028-03-31");
  assert.equal(firstEventDate({...monthly,monthDay:29}),"2028-02-29");
  assert.equal(firstEventDate({...monthly,endDate:"2028-03-25"}),"");
});
test("the next three Shanghai calendar dates get labels across the year boundary",()=>{
  const day="2026-12-30";
  assert.deepEqual(["2026-12-29",day,"2026-12-31","2027-01-01","2027-01-02","2027-01-03"].map(d=>dateLabel(d,day)),
    ["12月29日","12月30日","明天（12月31日）","后天（1月1日）","大后天（1月2日）","1月3日"]);
});
test("Today lists every pending one-off due tomorrow, including all-day and already-started work",()=>{
  const tomorrow="2026-04-11";
  const s=workspace([{...base,id:"timed",date:tomorrow,time:"08:30"},{...base,id:"all",date:tomorrow},
    {...base,id:"routine",date:tomorrow,daily:true},{...base,id:"done",date:tomorrow},{...base,id:"later"}]);
  s.history=[{taskId:"done",key:"done@once",occ:tomorrow,daily:false,title:"已完成的待办",category:"",finished:now}];
  const group=taskGroups(s,"today",day,day,now).find(g=>g.title==="明日待办");
  assert.deepEqual(group?.rows.map(row=>row.task.id),["timed","all"]);
});
test("a one-off exam and an undated exam week have distinct calendar and time semantics",()=>{
  const event:CalendarEvent={id:"exam",title:"解剖考试",frequency:"once",weekdays:[],monthDay:1,startDate:"2027-01-01",endDate:"",startTime:"14:00",endTime:"",color:"#234567"};
  assert.ok(isCalendarEvent(event));assert.equal(eventsOnDay([event],event.startDate).length,1);
  assert.equal(eventsOnDay([event],"2027-01-02").length,0);
  const week={...event,frequency:"week" as const,startTime:"",startDate:weekStart(event.startDate)};
  assert.equal(week.startDate,"2026-12-28");assert.ok(isCalendarEvent(week));assert.ok(!isCalendarEvent({...week,startTime:"14:00"}));
  for(const d of ["2026-12-28","2027-01-01","2027-01-03"])assert.equal(calendarItems([],[week],d,new Set())[0].timeLabel,"周内日期待定");
  assert.deepEqual(eventsOnDay([week],"2027-01-04"),[]);
});
test("category order defaults to deadlines and a manual move affects only that category",()=>{
  const state=workspace([{...base,id:"future",category:"课程",priority:"high",date:"2026-04-15"},
    {...base,id:"same-day",category:"课程",date:day,time:"09:00"},{...base,id:"expired",date:"2026-04-08",category:"课程"},
    {...base,id:"all-day",date:day,category:"课程"},{...base,id:"undated",date:"",category:"课程"},{...base,id:"other",category:"科研"}]);
  state.categories=["课程","科研"];
  const ids=(s:TodoData)=>taskGroups(s,"all",day,day,now).find(g=>g.category==="课程")!.rows.map(r=>r.task.id);
  assert.deepEqual(ids(state),["expired","same-day","all-day","future","undated"]);
  const move={source:"undated",target:"expired",after:false};
  const sorted=reorderCategory(state,"课程",move);
  assert.deepEqual(ids(JSON.parse(JSON.stringify(sorted))),["undated","expired","same-day","all-day","future"]);
  assert.equal(reorderCategory(sorted,"课程",move),sorted);
  assert.deepEqual(ids(reorderCategory(sorted,"课程",null)),ids(state));
  assert.equal(sorted.tasks.find(t=>t.id==="other")?.sortOrder,undefined);
  assert.throws(()=>reorderCategory(sorted,"课程",{...move,target:"other"}));
  assert.equal(updateCategories(sorted,[],[],[{from:"课程",to:"新分类"}]).tasks[0].sortOrder,sorted.tasks[0].sortOrder);
  assert.equal(updateCategories(sorted,[],["课程"]).tasks[0].sortOrder,undefined);
  const added={...sorted,tasks:[...sorted.tasks,{...base,id:"new",date:day,category:"课程"}]};
  assert.equal(ids(added).at(-1),"new");
});
test("annual lunar events skip the intercalary month and include next-year Gregorian dates",()=>{
  const event:CalendarEvent={id:"lunar",title:"纪念日",frequency:"lunarYearly",lunarMonth:6,monthDay:1,
    startDate:"2025-01-01",endDate:"",weekdays:[],startTime:"",endTime:"",color:"#246789"};
  assert.ok(isCalendarEvent(event));
  assert.equal(firstEventDate(event),"2025-06-25");
  assert.equal(eventsOnDay([event],"2025-06-25").length,1);
  assert.equal(eventsOnDay([event],"2025-07-25").length,0);
  assert.equal(firstEventDate({...event,lunarMonth:12,startDate:"2027-01-01"}),"2027-01-08");
  assert.equal(firstEventDate({...event,endDate:"2025-02-01"}),"");
  assert.equal(isCalendarEvent({...event,lunarMonth:13}),false);
  assert.equal(isCalendarEvent({...event,monthDay:31}),false);
});
test("rolling agenda interleaves deadlines and occurrences and shows a spanning week once",()=>{
  const event:CalendarEvent={id:"event",title:"复习课",frequency:"once",weekdays:[],monthDay:1,startDate:day,endDate:"",startTime:"",endTime:"",color:"#456789"};
  const tomorrow="2026-04-11";
  const dated=(id:string,startDate:string,startTime:string,endTime="")=>({...event,id,startDate,startTime,endTime});
  const events:CalendarEvent[]=[
    {...event,id:"week",frequency:"week",startDate:"2026-04-06"},
    dated("over",day,"15:00","18:00"),dated("ongoing",day,"17:30","19:00"),dated("past",day,"16:00"),
    {...dated("weekly",day,"20:00"),frequency:"weekly",weekdays:[5]},
    dated("all",tomorrow,""),dated("atLimit",tomorrow,"18:00"),dated("later",tomorrow,"18:01")
  ];
  const state=workspace([{...base,date:day,time:"19:00"},{...base,id:"daily",date:day,daily:true}]);
  const groups=upcomingAgenda(events,taskGroups(state,"upcoming",day,day,now),now);
  assert.deepEqual(groups.map(group=>group.items.map(item=>"entry" in item?item.entry.task.id:item.event.id)),[
    ["week","ongoing","one","weekly"],["all","atLimit"]
  ]);
  assert.equal(upcomingAgenda(events,[],now).length,2);
  assert.deepEqual(upcomingAgenda([],[],now),[]);
});
test("a past day uses creation and completion dates, isolated from later activity",()=>{
  const day="2026-11-25", next="2026-11-26", prior="2026-11-24";
  const task={...base,date:day,created:prior,lead:0};
  const state=workspace(["open","later","done","unknown","new","lead","routine"].map(id=>({
    ...task,id,created:id==="new"?next:prior,date:id==="lead"?next:day,
    lead:id==="lead"?1:0,daily:id==="routine"
  })));
  state.history=["later","done","unknown"].map(id=>({key:id+"@once",taskId:id,occ:day,daily:false,title:id,category:"",
    finished:Date.parse((id==="later"?next:day)+"T00:00:00+08:00"),...(id==="unknown"?{importedWithoutCompletionDate:true as const}:{})}));
  const review=dayReview(state,day);
  assert.deepEqual(review.completed.map(h=>h.taskId),["done"]);
  assert.deepEqual(review.groups.flatMap(g=>g.rows.map(e=>e.task.id)).sort(),["later","lead","open","routine"]);
  assert.deepEqual(dayReview(state,"2026-10-31").groups,[]);
});
test("24 hour view spans midnight and excludes untimed backlog",()=>{
  const s=workspace([{...base,id:"none",date:""},{...base,id:"past",date:day,time:"09:00"},
    {...base,id:"future",date:"2026-04-11",time:"12:00"},{...base,id:"all-day",date:day}]);
  assert.deepEqual(taskGroups(s,"upcoming",day,day,now).flatMap(g=>g.rows.map(e=>e.task.id)),["all-day","future"]);
});
