import type {PrivateTodoSnapshot,PrivateTodoState,TodoCompletion,TodoTask} from "@/lib/privateTodoState";
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
export const dateLabel = (d: string) => Number(d.slice(5, 7)) + "月" + Number(d.slice(-2)) + "日";
export const occurrenceKey = (t: Task, day: string) => t.id + "@" + (t.daily ? day : "once");
export const dueTime = (d: string, t: string) => Date.parse(d + "T" + (t || "23:59") + (t ? ":00" : ":59.999") + "+08:00");
export const priorityLabels = {"": "未指定", low: "低", normal: "普通", high: "高"};
export const dailyStart = (t: Task) => t.date || t.created;

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
  return tasks.filter(t => t.daily ? day >= dailyStart(t) && !t.skippedDates?.includes(day) : t.date === day).map(task => ({task, occ: day}));
}
function byDeadline(a: Entry, b: Entry) {
  return (a.occ || "9999").localeCompare(b.occ || "9999") || (a.task.time || "24:00").localeCompare(b.task.time || "24:00") || a.task.title.localeCompare(b.task.title, "zh-CN");
}
const rank = {high: 0, normal: 1, "": 1, low: 2};
export function taskGroups(state: TodoData, view: View, today: string, selected: string, now: number) {
  const completed = new Set(state.history.map(h => h.key));
  const pending = (e: Entry) => !completed.has(occurrenceKey(e.task, e.occ));
  const groups: {title: string; rows: Entry[]}[] = [];
  function add(title: string, entries: Entry[], prioritySort = false) {
    const rows = entries.filter(pending).sort((a, b) => (prioritySort ? rank[a.task.priority] - rank[b.task.priority] : 0) || byDeadline(a, b));
    if (rows.length) groups.push({title, rows});
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
  const overdue: Entry[] = [], attention: Entry[] = [], daily: Entry[] = [], later: Entry[] = [], anytime: Entry[] = [];
  for (const task of state.tasks) {
    if (task.daily) {
      const start = dailyStart(task);
      if (start > today) { later.push({task, occ: start}); continue }
      let occ = task.missed === "carry" ? start : today;
      while (occ <= today && (completed.has(occurrenceKey(task, occ)) || task.skippedDates?.includes(occ))) occ = plusDays(occ, 1);
      if (occ <= today) daily.push({task, occ});
      continue;
    }
    const row = {task, occ: task.date};
    if (!task.date) anytime.push(row);
    else if (dueTime(task.date, task.time) < now) overdue.push(row);
    else if (plusDays(task.date, -task.lead) <= today) attention.push(row);
    else later.push(row);
  }
  add("已过截止", overdue, true); add("该动手了", attention, true); add("每日任务", daily, true);
  if (view === "all") { add("以后要做", later); add("未定日期", anytime, true) }
  return groups;
}
export function timing({task: t, occ}: Entry, today: string) {
  if (t.daily) return (occ < today ? dateLabel(occ) + " 待补" : "每天") + (t.time ? " " + t.time : "") + (t.missed === "carry" ? " · 漏做保留" : "");
  if (!t.date) return "未定日期";
  const start = plusDays(t.date, -t.lead);
  const prefix = t.lead && today >= start && today < t.date ? (today === start ? "今天开工" : "已到开工日") + " · " : "";
  return prefix + (t.date === today ? "今天" : dateLabel(t.date)) + (t.time ? " " + t.time : " 全天") + "截止";
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
