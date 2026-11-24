import test from "node:test";
import assert from "node:assert/strict";
import {categoryPatterns, parseTodoSuggestions, shanghaiDay, type TodoParseContext} from "../lib/privateTodoParse";
import {dueTodoReminders, validTodoRecipient, todoEmailText, type ReminderWorkspace} from "../lib/privateTodoReminderSchedule";
import {processTodoReminders} from "../lib/privateTodoReminderServer";
import {todoSmtpFailureOutcome} from "../lib/siteNotificationEmail";

const parseContext: TodoParseContext = {categories:["学习","生活"],tasks:[],settings:{learnDefaults:true,defaultMissed:"skip"}};
const parsed = (text:string) => parseTodoSuggestions(text,parseContext,"2026-11-24")[0];
test("Chinese and Arabic dates and clocks match and vague input keeps suggestions editable", () => {
  for (const input of ["明天下午三点半提交报告","明天下午3点30分提交报告","明天15:30提交报告"]) {
    const item = parsed(input);
    assert.deepEqual([item.date,item.time,item.needsDate],["2026-11-25","15:30",false]);
  }
  assert.equal(parsed("周五交报告，提前三天准备").lead,3);
  assert.equal(parsed("下周五交报告").date,"2026-12-04");
  assert.equal(parsed("十一月二十八日取快递").date,"2026-11-28");
  assert.equal(parsed("找时间看论文").needsDate,true);
  assert.equal(parsed("周末下午三点去配眼镜").date,"");
  assert.equal(parsed("明天下午三点左右买书").time,"");
  assert.equal(parsed("明天下午三四点买书").time,"");
  assert.equal(parsed("明天或者后天去取").date,"");
  assert.equal(parsed("二月三十一日交报告").date,"");
  assert.equal(shanghaiDay(Date.parse("2026-11-24T16:01:00Z")),"2026-11-25");
});
test("history is aggregate, optional, and model proposals cannot drop input or invent categories", () => {
  const state:TodoParseContext = {...parseContext,tasks:[{category:"学习",lead:3,daily:false,missed:"carry"}]};
  assert.deepEqual(categoryPatterns(state),[{category:"学习",count:1,dailyCount:0,usualLead:3}]);
  assert.deepEqual(categoryPatterns({...state, settings:{...state.settings,learnDefaults:false}}),[]);
  assert.equal(parseTodoSuggestions("明天买书；周五交报告",state,"2026-11-24",[{source:"明天买书",title:"买书"}]).length,2);
  const [item] = parseTodoSuggestions("买书",state,"2026-11-24",[{source:"买书",category:"模型虚构分类"}]);
  assert.equal(item.category,"");
});
const baseTime = Date.parse("2026-11-24T14:00:01+08:00");
test("a generic CONN socket loss is ambiguous; a definitive rejection can retry", () => {
  assert.equal(todoSmtpFailureOutcome({command:"CONN",code:"ETIMEDOUT",message:"Timeout"}),"uncertain");
  assert.equal(todoSmtpFailureOutcome({command:"CONN",code:"ETIMEDOUT",message:"Greeting never received"}),"retry");
  assert.equal(todoSmtpFailureOutcome({command:"DATA",responseCode:451}),"retry");
});
const sampleTask = {id:"a",title:"样例任务",date:"2026-11-24",time:"15:00",daily:false,created:"2026-11-23"};
const state:ReminderWorkspace = {settings:{emailEnabled:true,emailAddress:"owner@example.invalid",remindMinutes:60,allDayTime:"18:00"},tasks:[sampleTask],history:[]};
test("deadline windows distinguish timed, all-day, skipped, recurring, and completed", () => {
  assert.equal(dueTodoReminders(state,baseTime)[0].key,"a@once");
  assert.equal(dueTodoReminders(state,baseTime - 61000).length,0);
  assert.equal(dueTodoReminders(state,baseTime + 3700000).length,0);
  assert.equal(dueTodoReminders({...state,history:[{key:"a@once"}]},baseTime).length,0);
  assert.equal(dueTodoReminders({...state,settings:{...state.settings,emailEnabled:false}},baseTime).length,0);
  const recurring = {...state,tasks:[{...sampleTask,daily:true}]};
  assert.equal(dueTodoReminders(recurring,baseTime)[0].key,"a@2026-11-24");
  assert.equal(dueTodoReminders({...state,tasks:[{...sampleTask,daily:true,skippedDates:["2026-11-24"]}]},baseTime).length,0);
  const allday = {...state,tasks:[{...sampleTask,time:""}]};
  assert.equal(dueTodoReminders(allday,baseTime).length,0);
  const later = baseTime + 4 * 3600000;
  const due = dueTodoReminders(allday,later)[0];
  assert.ok(due);
  assert.match(todoEmailText(due,later).text,/全天/);
  for (const value of ["other@example.com,me@example.com","a@example.com\r\nTo:b@example.com","Name <a@example.com>"]) assert.equal(validTodoRecipient(value),false);
});
test("duplicate worker ticks share the dispatch claim and a fresh completion suppresses the email", async () => {
  const row = {owner_id:"test-only",revision:1,state};
  const recorded = new Set<string>();
  let delivered = 0;
  const deps = {
    load:async()=>row,
    start:async (_row: typeof row, key:string) => { if(recorded.has(key)) return false; recorded.add(key); return true; },
    send:async () => {delivered++; return "sent" as const;},
    finish:async()=>undefined, now:()=>baseTime
  };
  await Promise.all([processTodoReminders(deps), processTodoReminders(deps)]);
  assert.equal(delivered,1);
  let reads = 0;
  await processTodoReminders({...deps,load:async()=>++reads === 1 ? row : {...row,revision:2,state:{...state,history:[{key:"a@once"}]}}});
  assert.equal(delivered,1);
});
test("multi-day recurring leads trigger each future occurrence even when today's delivery is already claimed", async () => {
  for (const days of [2,7,365]) {
    const multi = {...state,settings:{...state.settings,remindMinutes:days*1440},tasks:[{...sampleTask,daily:true}]};
    const now = Date.parse("2026-11-24T15:00:15+08:00");
    const upcoming = shanghaiDay(now + days*86400000);
    assert.deepEqual(dueTodoReminders(multi,now).map(r=>r.key),["a@2026-11-24","a@"+upcoming]);
    const found:string[]=[];
    await processTodoReminders({
      load:async()=>({owner_id:"test",revision:8,state:multi}),
      start:async (_row,key) => key !== "a@2026-11-24",
      send:async (_to,_subject,text) => {found.push(text); return "sent";},
      finish:async()=>undefined,
      now:()=>now
    });
    assert.equal(found.length,1);
    assert.ok(found[0].includes(upcoming));
  }
  const evening = {...state,settings:{...state.settings,remindMinutes:18*60},tasks:[{...sampleTask,daily:true,time:"10:00"}]};
  assert.equal(dueTodoReminders(evening, Date.parse("2026-11-24T16:00:20+08:00"))[0].key,"a@2026-11-25");
});
