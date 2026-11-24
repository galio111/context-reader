type Priority = "" | "high" | "normal" | "low";
type Missed = "skip" | "carry";
export interface TodoParseContext {
  categories: string[];
  tasks: {category: string; lead: number; daily: boolean; missed: Missed}[];
  settings: {learnDefaults: boolean; defaultMissed: Missed};
}
export interface TodoSuggestion {
  source: string; title: string; category: string; date: string; time: string; lead: number; daily: boolean;
  missed: Missed; priority: Priority; needsDate: boolean; reason: string;
}
type ModelDraft = {source?: unknown; title?: unknown; category?: unknown; lead?: unknown; priority?: unknown; reason?: unknown};
const dayMs = 86_400_000;
export function shanghaiDay(now: number): string { return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10); }
function shiftDate(day: string, count: number) { return new Date(Date.parse(day + "T00:00:00Z") + count * dayMs).toISOString().slice(0, 10); }

function numerals(text: string): string {
  const digit = "零一二三四五六七八九";
  return text.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 65248)).replace(/[〇零一二两三四五六七八九十]+/g, (source) => {
    const token = source.replace(/两/g, "二").replace(/〇/g, "零");
    if (!token.includes("十")) return [...token].map(ch => digit.indexOf(ch)).join("");
    const [tens, units] = token.split("十");
    return String((tens ? digit.indexOf(tens) : 1) * 10 + (units ? digit.indexOf(units) : 0));
  });
}
function validDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const out = [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
  return shiftDate(out, 0) === out ? out : "";
}
function dateInfo(raw: string, today: string) {
  const text = numerals(raw);
  if (/(?:今天|明天|后天|周[1-7日天]|星期[1-7日天]|\d{1,2}[号日])\s*(?:或者?|还是|[～~到至])\s*(?:今|明|后|[下这本]?周|星期|\d)/.test(text)) return "";
  const exact = /(?:(\d{4})(?:年|[-/.]))?(\d{1,2})(?:月|[-/.])(\d{1,2})(?:日|号)?(?!\d)/.exec(text);
  if (exact) return validDate(exact[1] ? Number(exact[1]) : Number(today.slice(0, 4)), Number(exact[2]), Number(exact[3]));
  const relative = /(大后天|后天|明[天早晚]|今[天早晚])/.exec(text);
  if (relative) return shiftDate(today, relative[0] === "大后天" ? 3 : relative[0] === "后天" ? 2 : relative[0].startsWith("明") ? 1 : 0);
  const later = /(\d{1,2})天[后以]后?/.exec(text);
  if (later) return shiftDate(today, Number(later[1]));
  const match = /(下下|下|本|这)?(?:个)?(?:周|星期|礼拜)([1-7日天])/.exec(text);
  if (!match) return "";
  const weekday = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7;
  const wanted = /[日天]/.test(match[2]) ? 6 : Number(match[2]) - 1;
  let gap = wanted - weekday;
  if (match[1]?.startsWith("下")) gap += match[1] === "下下" ? 14 : 7;
  else if (!match[1] && gap < 0) gap += 7;
  return shiftDate(today, gap);
}
function timeInfo(raw: string) {
  if (/[一二两三四五六七八九]{2}[点时]|[点时]\s*(或(?:者)?|还是|到|至|[~～-])\s*(?:凌晨|早上|上午|中午|下午|晚上)?\s*[\d一二两三四五六七八九十]/.test(raw)) return "";
  const text = numerals(raw).replace(/：/g, ":");
  const match = /(?:(凌晨|清晨|早上|早晨|上午|中午|下午|晚上|傍晚|夜里|今晚|明晚|今早|明早)\s*)?(\d{1,2})\s*(?:[:](\d{1,2})|[点时](?:(半|1刻|3刻)|(\d{1,2})分?)?)(?!\d)/.exec(text);
  if (!match || /^(左右|前后|许|多|几|以后|之后)/.test(text.slice(match.index + match[0].length))) return "";
  const [period, hourRaw] = [match[1] || "", Number(match[2])];
  const fractions: Record<string, number> = {半:30,"1刻":15,"3刻":45};
  const minute = match[4] ? fractions[match[4]] : Number(match[3] || match[5] || 0);
  if (hourRaw > 23 || minute > 59 || (period && hourRaw > 12)) return "";
  let hour = hourRaw;
  if (/下午|傍晚|晚上|夜里|今晚|明晚/.test(period) && hour < 12) hour += 12;
  else if (period === "中午" && hour < 10) hour += 12;
  else if ((period === "凌晨" || /晚|夜/.test(period)) && hour === 12) hour = 0;
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}
export function categoryPatterns(context: TodoParseContext) {
  if (!context.settings.learnDefaults) return [];
  return context.categories.flatMap(category => {
    const group = context.tasks.filter(t => t.category === category);
    if (!group.length) return [];
    const leads = group.filter(t => !t.daily && t.lead > 0).map(t => t.lead).sort((a, b) => a - b);
    return [{category, count: group.length, dailyCount: group.filter(t => t.daily).length, usualLead: leads.length ? leads[Math.floor(leads.length / 2)] : 0}];
  });
}
export function parseTodoSuggestions(raw: string, context: TodoParseContext, today: string, modelItems?: ModelDraft[]): TodoSuggestion[] {
  const separators = /[\r\n；;。]+|[，,](?=\s*(?:然后|另外|顺便|再|今|明|后天|每天|每日|[本下这]?周|星期|周末))/;
  const simple: ModelDraft[] = raw.split(separators).map(source => ({source: source.trim()})).filter(x => x.source);
  const items = modelItems?.length && modelItems.length <= 35 ? modelItems : simple;
  let cursor = 0;
  const conjunction = /^[\s。，,、;；：:和然后再及另外顺便还要以及并且]*$/;
  const complete = items.every(item => {
    if (!item || typeof item.source !== "string" || !item.source.trim()) return false;
    const start = raw.indexOf(item.source, cursor);
    if (start < 0 || !conjunction.test(raw.slice(cursor, start))) return false;
    cursor = start + item.source.length;
    return true;
  }) && conjunction.test(raw.slice(cursor));
  return (complete ? items : simple).map(item => {
    const source = String(item.source).trim();
    const daily = /每天|每日|天天/.test(source);
    const date = dateInfo(source, today) || (daily ? today : "");
    const time = timeInfo(source);
    const vagueDay = /找时间|有空|某天|改天|最近|近期|周末|星期末|下周(?![一二三四五六日天1-7])|这周(?![一二三四五六日天1-7])|[月年][底初末]|下个月|回头|过几天|今天|明天|后天|星期|周[一二三四五六日天1-7]/.test(source);
    const vagueTime = /[早晚]上|下午|傍晚|上午|中午|凌晨|左右|\d[:：]\d|[\d一二两三四五六七八九十几]点|早些|晚些|明早|明晚|今晚/.test(source);
    const explicitLead = /提前\s*(\d{1,3})\s*天/.exec(numerals(source));
    const category = typeof item.category === "string" && context.categories.includes(item.category)
      ? item.category : context.categories.find(c => source.includes(c)) || context.categories.find(c => c === "未分类") || "";
    const priority = ["high","normal","low"].includes(String(item.priority)) ? item.priority as Priority : "";
    return {
      source,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 300) : source,
      category, date, time, daily, missed: context.settings.defaultMissed,
      lead: date && !daily ? Math.min(365, explicitLead ? Number(explicitLead[1]) : Number.isInteger(item.lead) && Number(item.lead) > 0 ? Number(item.lead) : 0) : 0,
      priority, needsDate: (!date && (!!time || vagueDay || vagueTime || /[年月日号]|[-/]\d/.test(numerals(source)))) || (!time && vagueTime),
      reason: typeof item.reason === "string" ? item.reason.trim().slice(0, 120) : ""
    };
  });
}
