import { shanghaiDay } from "./privateTodoParse";

interface ReminderTask { id: string; title: string; date: string; time: string; daily: boolean; created: string; skippedDates?: string[] }
export interface ReminderWorkspace {
  tasks: ReminderTask[];
  history: {key: string}[];
  settings: { emailEnabled: boolean; emailAddress: string; remindMinutes: number; allDayTime: string };
}
export interface TodoReminder { key: string; taskId: string; title: string; occurrence: string; time: string; deadline: number }
const dayMs = 86_400_000;
const localStamp = (day: string, time: string) => Date.parse(day + "T" + time + ":00+08:00");
export function validTodoRecipient(input: string) {
  return typeof input === "string" && input.length <= 254 && /^[^\s<>,;:@\\"()[\]]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(input) && !/[\x00-\x1f\x7f]/.test(input);
}
export function dueTodoReminders(state: ReminderWorkspace, now: number): TodoReminder[] {
  const s = state.settings;
  if (!s.emailEnabled || !validTodoRecipient(s.emailAddress) || !Number.isInteger(s.remindMinutes) || s.remindMinutes < 0 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.allDayTime)) return [];
  const today = shanghaiDay(now);
  const completed = new Set(state.history.map(record => record.key));
  const due: TodoReminder[] = [];
  for (const task of state.tasks) {
    const first = task.date || task.created;
    if (!task.daily && !task.date) continue;
    // Recover at most one past reminder day plus the nearest due occurrence on
    // enabling mail or recovering from downtime. Long leads still fire every new
    // daily occurrence exactly when its own advance window opens.
    const horizon = now + s.remindMinutes * 60_000;
    const nearest = first > today ? first : today;
    const dates = task.daily && task.time
      ? [...new Set([nearest, shanghaiDay(horizon - dayMs), shanghaiDay(horizon)])].filter(day => day >= first)
      : [task.daily ? today : task.date].filter(day => !task.daily || day >= first);
    for (const date of dates) {
      const key = task.id + "@" + (task.daily ? date : "once");
      if (completed.has(key) || task.skippedDates?.includes(date)) continue;
      const deadline = localStamp(date, task.time || "23:59");
      const reminder = task.time ? deadline - s.remindMinutes * 60_000 : localStamp(date, s.allDayTime);
      if (!Number.isFinite(deadline) || now < reminder || now >= deadline + 60_000) continue;
      if (task.daily && date !== nearest && now - reminder >= dayMs) continue;
      due.push({key, taskId:task.id, title:task.title, occurrence:date, time:task.time, deadline});
    }
  }
  return due.sort((a,b) => a.deadline - b.deadline);
}
export function todoEmailText(reminder: TodoReminder, now: number) {
  const title = reminder.title.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
  const at = reminder.time ? reminder.occurrence + " " + reminder.time : reminder.occurrence + "（全天）";
  const minutes = Math.max(0, Math.ceil((reminder.deadline - now) / 60_000));
  const remaining = minutes === 0 ? "本分钟截止" : minutes < 60 ? "距截止还有 " + minutes + " 分钟" : "距截止约 " + Math.floor(minutes / 60) + " 小时" + (minutes % 60 ? " " + minutes % 60 + " 分钟" : "");
  return {subject:"待办提醒 · " + title, text:title + "\n截止时间（上海） " + at + "\n" + remaining + "。\n\n打开我的待办 https://context-reader.com/todo"};
}
