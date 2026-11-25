export type TodoTask = {
  id: string;
  title: string;
  category: string;
  date: string;
  time: string;
  lead: number;
  daily: boolean;
  missed: "skip" | "carry";
  priority: "" | "high" | "normal" | "low";
  color?: string;
  created: string;
  sortOrder?: number;
  skippedDates?: string[];
};

export type CalendarEvent = {
  id:string; title:string; frequency:"once"|"week"|"weekly"|"monthly"|"lunarYearly"; lunarMonth?:number; weekdays:number[]; monthDay:number;
  startDate:string; endDate:string; startTime:string; endTime:string; color:string;
};

export type TodoCompletion = {
  key: string;
  taskId: string;
  occ: string;
  daily: boolean;
  title: string;
  category: string;
  finished: number;
  importedWithoutCompletionDate?: true;
};

export type PrivateTodoState = {
  version: 1;
  categories: string[];
  tasks: TodoTask[];
  events?: CalendarEvent[];
  history: TodoCompletion[];
  settings: {
    learnDefaults: boolean;
    defaultMissed: "skip" | "carry";
    emailEnabled: boolean;
    emailAddress: string;
    remindMinutes: number;
    allDayTime: string;
    urgentColor?: string;
  };
};

export type PrivateTodoSnapshot = { revision: number; state: PrivateTodoState };

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" && value.length <= max && (empty || value.trim().length > 0);
const integer = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
const time = (value: unknown) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const optionalColor = (value: unknown) => value === undefined || (typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value));
const unique = (values: unknown[]) => new Set(values).size === values.length;
const missed = (value: unknown) => value === "skip" || value === "carry";
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(value + "T00:00:00Z");
  return Number.isFinite(day.valueOf()) && day.toISOString().slice(0, 10) === value;
};

function task(value: unknown): value is TodoTask {
  if (!object(value)) return false;
  return text(value.id, 160) && !value.id.includes("@") && text(value.title, 4096) && text(value.category, 64, true)
    && (value.date === "" || date(value.date)) && (value.time === "" || (time(value.time) && date(value.date)))
    && integer(value.lead, 0, 3650) && typeof value.daily === "boolean" && missed(value.missed)
    && ["", "high", "normal", "low"].includes(String(value.priority)) && typeof value.priority === "string"
    && (value.sortOrder === undefined || integer(value.sortOrder,0,Number.MAX_SAFE_INTEGER)) && optionalColor(value.color) && date(value.created) && (value.skippedDates === undefined || (Array.isArray(value.skippedDates)
      && value.skippedDates.every(date) && unique(value.skippedDates)));
}

export function isCalendarEvent(value:unknown): value is CalendarEvent {
  if (!object(value) || !text(value.id,160) || !text(value.title,300) || !date(value.startDate)
    || !(value.endDate === "" || (date(value.endDate) && value.endDate >= value.startDate))
    || !(value.startTime === "" || time(value.startTime))
    || !(value.endTime === "" || (time(value.endTime) && typeof value.endTime === "string" && typeof value.startTime === "string" && value.startTime && value.endTime > value.startTime))
    || typeof value.color !== "string" || !optionalColor(value.color)) return false;
  if ((value.frequency==="once" || value.frequency==="week") && value.endDate!=="")return false;
  if (value.frequency==="week" && (value.startTime!=="" || value.endTime!=="" || new Date(value.startDate+"T12:00:00Z").getUTCDay()!==1))return false;
  if (value.frequency==="lunarYearly" && (!integer(value.lunarMonth,1,12) || !integer(value.monthDay,1,30)))return false;
  return ["once","week","weekly","monthly","lunarYearly"].includes(String(value.frequency)) && integer(value.monthDay,1,31)
    && Array.isArray(value.weekdays) && value.weekdays.every(n=>integer(n,0,6)) && unique(value.weekdays)
    && (value.frequency !== "weekly" || value.weekdays.length > 0);
}

function completion(value: unknown): value is TodoCompletion {
  if (!object(value) || !text(value.taskId, 160) || !date(value.occ)) return false;
  return typeof value.daily === "boolean"
    && value.key === value.taskId + "@" + (value.daily ? value.occ : "once")
    && text(value.title, 4096) && text(value.category, 64, true)
    && (value.importedWithoutCompletionDate === undefined || value.importedWithoutCompletionDate === true)
    && integer(value.finished, 0, 8640000000000000);
}

export function isPrivateTodoState(value: unknown): value is PrivateTodoState {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.categories)
    || !value.categories.every(c => text(c, 64)) || !unique(value.categories)
    || !Array.isArray(value.tasks) || !value.tasks.every(task) || !unique(value.tasks.map(t => t.id))
    || (value.events !== undefined && (!Array.isArray(value.events) || !value.events.every(isCalendarEvent) || !unique(value.events.map(event=>event.id))))
    || !Array.isArray(value.history) || !value.history.every(completion) || !unique(value.history.map(h => h.key))) return false;
  const s = value.settings;
  if (!object(s) || typeof s.learnDefaults !== "boolean" || !missed(s.defaultMissed) || typeof s.emailEnabled !== "boolean"
    || !text(s.emailAddress, 254, true) || !integer(s.remindMinutes, 0, 525600) || !optionalColor(s.urgentColor) || !time(s.allDayTime)) return false;
  if (!s.emailAddress) return !s.emailEnabled;
  // A single mailbox only. SMTP may otherwise interpret commas or angle brackets as a list.
  return /^[^\s@,;<>:"()\\\[\]]+@(?:[a-z\d-]+\.)+[a-z\d-]+$/i.test(s.emailAddress)
    && !/[\x00-\x1F\x7F]/.test(s.emailAddress);
}
