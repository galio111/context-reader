import assert from "node:assert/strict";
import {test} from "node:test";
import {journalRows,journalCsvLines} from "../components/todo/day-journal";
import {traditionalFestival} from "../components/todo/lunar-calendar";
import {isPrivateTodoState,type PrivateTodoState} from "../lib/privateTodoState";

const day="2026-11-27", later=Date.parse("2026-11-28T08:00:00+08:00");
const state:PrivateTodoState={version:1,categories:[],settings:{learnDefaults:false,defaultMissed:"skip",emailEnabled:false,
  emailAddress:"",remindMinutes:60,allDayTime:"18:00"},tasks:[{id:"a",title:"练习",category:"",daily:true,date:day,time:"",
  created:day,lead:0,missed:"skip",priority:""}],history:[],events:[{id:"m",title:"组会",frequency:"weekly",startDate:day,endDate:"",
  weekdays:[5],monthDay:1,startTime:"17:00",endTime:"18:00",color:"#3764c5"}]};
test("backdating credits the selected day, preserves the click time and leaves the next recurrence open",()=>{
  const s={...state,history:[{key:"a@"+day,taskId:"a",occ:day,daily:true,title:"练习",category:"",finished:later,creditedDay:day}]};
  assert.ok(isPrivateTodoState(s));assert.equal(journalRows(s,day).find(r=>r.title==="练习")?.finished,later);
  assert.equal(journalRows(s,"2026-11-28").find(r=>r.title==="练习")?.finished,undefined);
  assert.equal(journalRows(s,"2026-11-28").filter(r=>r.title==="练习").length,1);
  assert.ok(!isPrivateTodoState({...s,history:[{...s.history[0],creditedDay:"2026-02-31"}]}));
});
test("event completion belongs to one occurrence and a later deleted event keeps its receipt",()=>{
  const s={...state,eventChecks:[{eventId:"m",title:"组会",day,finished:later}]};
  assert.ok(isPrivateTodoState(s));assert.ok(!isPrivateTodoState({...s,eventChecks:[...s.eventChecks,...s.eventChecks]}));
  assert.equal(journalRows(s,day).find(r=>r.kind==="事件")?.finished,later);
  assert.equal(journalRows(s,"2026-12-04").find(r=>r.kind==="事件")?.finished,undefined);
  assert.equal(journalRows({...s,events:[]},day).find(r=>r.kind==="事件")?.title,"组会");
});
test("CSV preserves date, status, real check time, quotes and safe spreadsheet text",()=>{
  const line=journalCsvLines(day,[{key:"x",kind:"待办",group:"",title:'=1,"a"',category:"",occ:day,when:"",finished:later}])[0];
  assert.ok(line.includes("2026-11-28 08:00"));assert.ok(line.includes("已完成"));assert.ok(line.includes("'=1,"));assert.ok(line.includes('""a""'));
  assert.ok(journalCsvLines(day,[])[0].includes("无记录"));
});
test("traditional festivals use regular lunar months and the actual last day of the year",()=>{
  for(const [date,name] of [["2026-02-16","除夕"],["2026-02-17","春节"],["2026-03-03","元宵"],["2026-06-19","端午"],
    ["2026-09-25","中秋"],["2026-10-18","重阳"],["2027-02-05","除夕"],["2027-02-06","春节"],["2026-11-28",""]])
    assert.equal(traditionalFestival(date),name,date);
});
