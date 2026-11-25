import type {CalendarEvent,PrivateTodoSnapshot,PrivateTodoState,TodoCompletion,TodoTask} from "@/lib/privateTodoState";
export type Task=TodoTask;
export type Completed=TodoCompletion;
export type TodoData=PrivateTodoState;
export type Settings=TodoData["settings"];
export type Snapshot=PrivateTodoSnapshot;
export interface Entry {task: Task; occ: string}
export type View = "today" | "upcoming" | "all" | "day" | "history";
const dayMs = 86400000;
export const isoDay = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export const plusDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * dayMs).toISOString().slice(0, 10);
export function relativeDayLabel(day:string,today:string) {
  const distance=(Date.parse(day+"T00:00:00Z")-Date.parse(today+"T00:00:00Z"))/dayMs;
  return ({1:"明天",2:"后天",3:"大后天"} as Record<number,string>)[distance] || "";
}
export function dateLabel(day:string,today=isoDay()) {
  const absolute=Number(day.slice(5,7))+"月"+Number(day.slice(-2))+"日",relative=relativeDayLabel(day,today);
  return relative ? relative+"（"+absolute+"）" : absolute;
}
export const occurrenceKey = (t: Task, day: string) => t.id + "@" + (t.daily ? day : "once");
export const dueTime = (d: string, t: string) => Date.parse(d + "T" + (t || "23:59") + (t ? ":00" : ":59.999") + "+08:00");
export const defaultUrgentColor = "#ca4e32";
export function urgencyLabel(task: Task, today: string, now: number) {
  if (!task.daily && task.date) {
    const due = dueTime(task.date,task.time);
    if (due < now) return "已过截止";
    if (task.date === today) return "今天到期";
    if (due <= now + dayMs) return "24 小时内到期";
    if (task.lead > 0 && plusDays(task.date,-task.lead) <= today) return "已到开工日";
  }
  return task.priority === "high" ? "高优先级" : "";
}
export const priorityLabels = {"": "未指定", low: "低", normal: "普通", high: "高"};
export const dailyStart = (t: Task) => t.date || t.created;

export type CategoryRename = {from:string; to:string};
export function updateCategories(state: TodoData, added: string[], removed: string[], renamed:CategoryRename[]=[]): TodoData {
  const deleted = new Set(removed);
  const rename = new Map(renamed.map(({from,to}) => [from,to]));
  if (renamed.some(({from})=>!state.categories.includes(from))) throw Error("分类已在另一处修改，请重新打开设置。");
  const existing = state.categories.filter(name => !deleted.has(name)).map(name=>rename.get(name) ?? name);
  if (new Set(existing).size !== existing.length) throw Error("已存在同名分类，请换一个名字。");
  const categories = [...new Set([...existing,...added])];
  const fallback = categories.includes("未分类") ? "未分类" : "";
  const tasks = deleted.size || rename.size ? state.tasks.map(task => {
    const category = deleted.has(task.category) ? fallback : rename.get(task.category);
    return category === undefined ? task : {...task,category,...(deleted.has(task.category)?{sortOrder:undefined}:{})};
  }) : state.tasks;
  const history = rename.size ? state.history.map(h=>rename.has(h.category) ? {...h,category:rename.get(h.category)!} : h) : state.history;
  return {...state, categories, tasks, history};
}

export function calendarDays(month: string) {
  const first = month.slice(0, 7) + "-01";
  const weekday = (new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7;
  const start = plusDays(first, -weekday);
  const end = new Date(Date.parse(first + "T12:00:00Z"));
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return Array.from({length: Math.ceil((end.getUTCDate() + weekday) / 7) * 7}, (_, i) => plusDays(start, i));
}
export function nextMonth(month: string, step: number) {
  const start = new Date(month.slice(0, 7) + "-01T12:00:00Z");
  start.setUTCMonth(start.getUTCMonth() + step);
  return start.toISOString().slice(0, 7);
}
export function dayEntries(tasks: Task[], day: string): Entry[] {
  return tasks.filter(t => !t.daily && t.date === day).map(task => ({task, occ: day}));
}
export function weekStart(day:string) {
  return plusDays(day,-((new Date(day+"T12:00:00Z").getUTCDay()+6)%7));
}
export function eventRepeatLabel(event:CalendarEvent) {
  if(event.frequency==="once")return "单次事件";
  if(event.frequency==="week")return dateLabel(event.startDate)+"至"+dateLabel(plusDays(event.startDate,6));
  if(event.frequency==="monthly")return "每月 "+event.monthDay+" 日";
  return "每周"+[1,2,3,4,5,6,0].filter(n=>event.weekdays.includes(n)).map(n=>"日一二三四五六"[n]).join("、");
}
function occursOn(event:CalendarEvent, day:string, weekday:number) {
  if(event.frequency==="once")return day===event.startDate;
  if(event.frequency==="week")return day>=event.startDate && day<=plusDays(event.startDate,6);
  return event.startDate<=day && (!event.endDate || day<=event.endDate) &&
    (event.frequency==="weekly" ? event.weekdays.includes(weekday) : event.monthDay===Number(day.slice(-2)));
}
export function firstEventDate(event:CalendarEvent) {
  // Adjacent occurrences of a monthly date are at most 61 days apart.
  for(let offset=0;offset<=62;offset++){
    const day=plusDays(event.startDate,offset);
    if(event.endDate && day>event.endDate)break;
    if(occursOn(event,day,new Date(day+"T12:00:00Z").getUTCDay()))return day;
  }
  return "";
}
export function eventsOnDay(events: CalendarEvent[], day: string) {
  const weekday = new Date(day+"T12:00:00Z").getUTCDay();
  return events.filter(event=>occursOn(event,day,weekday))
    .sort((a,b)=>a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title,"zh-CN"));
}
export function eventTime(event:CalendarEvent) {
  if(event.frequency==="week")return "周内日期待定";
  return event.startTime ? [event.startTime,event.endTime].filter(Boolean).join("–") : "全天";
}
type CalendarItem = {key:string;title:string;time:string;timeLabel:string;high:boolean;task?:Task;event?:CalendarEvent};
export function calendarItems(tasks:Task[],events:CalendarEvent[],day:string,completed:ReadonlySet<string>):CalendarItem[] {
  const items:CalendarItem[]=dayEntries(tasks,day).filter(e=>!completed.has(occurrenceKey(e.task,day))).map(({task})=>({
    key:"task:"+task.id,title:task.title,time:task.time,timeLabel:task.time || "全天",high:task.priority==="high",task
  }));
  for(const event of eventsOnDay(events,day))items.push({key:"event:"+event.id,title:event.title,time:event.startTime,timeLabel:eventTime(event),high:false,event});
  return items.sort((a,b)=>Number(b.high)-Number(a.high) || a.time.localeCompare(b.time));
}
function byDeadline(a: Entry, b: Entry) {
  return (a.occ || "9999").localeCompare(b.occ || "9999") || (a.task.time || "24:00").localeCompare(b.task.time || "24:00") || a.task.title.localeCompare(b.task.title, "zh-CN");
}
function categoryOrder(a:Entry,b:Entry) {
  return (a.task.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.task.sortOrder ?? Number.MAX_SAFE_INTEGER)
    || Number(!a.occ)-Number(!b.occ) || byDeadline(a,b);
}
export type TaskMove = {source:string; target:string; after:boolean};
export function reorderCategory(state:TodoData,category:string,move:TaskMove|null):TodoData {
  if(!move)return {...state,tasks:state.tasks.map(t=>t.category===category && t.sortOrder!==undefined ? {...t,sortOrder:undefined} : t)};
  const entries=state.tasks.filter(t=>!t.daily && t.category===category).map(task=>({task,occ:task.date})).sort(categoryOrder);
  const ids=entries.map(e=>e.task.id);
  if(!ids.includes(move.source) || !ids.includes(move.target) ||
    state.history.some(h=>h.key===move.source+"@once" || h.key===move.target+"@once"))throw Error("清单已变动，请按当前顺序重试。");
  if(move.source===move.target)return state;
  const next=ids.filter(id=>id!==move.source);
  next.splice(next.indexOf(move.target)+Number(move.after),0,move.source);
  if(next.every((id,i)=>id===ids[i]))return state;
  const order=new Map(next.map((id,i)=>[id,i]));
  return {...state,tasks:state.tasks.map(t=>order.has(t.id)?{...t,sortOrder:order.get(t.id)}:t)};
}
const rank = {high: 0, normal: 1, "": 1, low: 2};
export function taskGroups(state: TodoData, view: View, today: string, selected: string, now: number) {
  const completed = new Set(state.history.map(h => h.key));
  const pending = (e: Entry) => !completed.has(occurrenceKey(e.task, e.occ));
  const groups: {title: string; category?: string; rows: Entry[]}[] = [];
  function add(title: string, entries: Entry[], prioritySort = false) {
    const rows = entries.filter(pending).sort((a, b) => (prioritySort ? rank[a.task.priority] - rank[b.task.priority] : 0) || byDeadline(a, b));
    if (rows.length) groups.push({title, rows});
  }
  if (view === "all") {
    const byCategory = new Map<string, Entry[]>(state.categories.map(category => [category, []]));
    for (const task of state.tasks) {
      const entry = {task, occ: task.date};
      if (task.daily || !pending(entry)) continue;
      if (!byCategory.has(task.category)) byCategory.set(task.category, []);
      byCategory.get(task.category)!.push(entry);
    }
    for (const [category, entries] of byCategory)
      groups.push({title: category || "未分类", category, rows: entries.sort(categoryOrder)});
    return groups;
  }
  if (view === "day") {
    const entries = dayEntries(state.tasks, selected);
    add("全天", entries.filter(e => !e.task.time)); add("具体时间", entries.filter(e => !!e.task.time));
    return groups;
  }
  if (view === "upcoming") {
    for (const date of [today, plusDays(today, 1)]) {
      add(date === today ? "今天" : "明天", dayEntries(state.tasks, date).filter(e => {
        const due = dueTime(date, e.task.time);
        return due >= now && due <= now + dayMs;
      }));
    }
    return groups;
  }
  const overdue: Entry[] = [], attention: Entry[] = [], daily: Entry[] = [];
  for (const task of state.tasks) {
    if (task.daily) {
      const start = dailyStart(task);
      if (start > today) continue;
      let occ = task.missed === "carry" ? start : today;
      while (occ <= today && (completed.has(occurrenceKey(task, occ)) || task.skippedDates?.includes(occ))) occ = plusDays(occ, 1);
      if (occ <= today) daily.push({task, occ});
      continue;
    }
    const row = {task, occ: task.date};
    if (!task.date) continue;
    else if (dueTime(task.date, task.time) < now) overdue.push(row);
    else if (plusDays(task.date, -task.lead) <= today) attention.push(row);
  }
  add("已过截止", overdue, true); add("该动手了", attention, true); add("每日任务", daily, true);
  add("明日待办",dayEntries(state.tasks,plusDays(today,1)),true);

  return groups;
}
export function timing({task: t, occ}: Entry, today: string) {
  if (t.daily) return (occ < today ? dateLabel(occ) + " 待补" : "每天") + (t.time ? " " + t.time : "") + (t.missed === "carry" ? " · 漏做保留" : "");
  if (!t.date) return "未定日期";
  const start = plusDays(t.date, -t.lead);
  const prefix = t.lead && today >= start && today < t.date ? (today === start ? "今天开工" : "已到开工日") + " · " : "";
  return prefix + (t.date === today ? "今天" : dateLabel(t.date,today)) + (t.time ? " " + t.time : " 全天") + "截止";
}
export function learnedCategory(text: string, state: TodoData) {
  if (!state.settings.learnDefaults) return null;
  const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}]/gu, "");
  const input = clean(text);
  const score = new Map<string,number>();
  for (const t of state.tasks) {
    if (!t.category || !state.categories.includes(t.category)) continue;
    const title = clean(t.title);
    if (title.length < 2) continue;
    let matches = 0;
    for (let i = 0; i < title.length - 1; i++) if (input.includes(title.slice(i, i + 2))) matches++;
    if (matches >= Math.min(3, title.length - 1) && matches / (title.length - 1) >= .55)
      score.set(t.category, (score.get(t.category) || 0) + matches);
  }
  const sorted = [...score].sort((a, b) => b[1] - a[1]);
  return sorted.length && sorted[0][1] !== sorted[1]?.[1] ? {category: sorted[0][0], reason: "参考你之前保存的相似待办"} : null;
}
