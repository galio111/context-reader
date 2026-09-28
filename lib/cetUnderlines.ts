import type { CetActivity, CetPaper, CetUnderline, CetUnderlineColor } from "../types/cet";

export interface CetUnderlineRange {
  sectionId: string;
  paragraphIndex: number;
  start: number;
  end: number;
}

const COLORS: CetUnderlineColor[] = ["blue", "teal", "amber", "rose"];
const MAX_MARKS = 200;

export function validCetUnderline(value: unknown): value is CetUnderline {
  if (!value || typeof value !== "object") return false;
  const mark = value as CetUnderline;
  return typeof mark.id === "string" && mark.id.length > 0 && mark.id.length <= 100
    && typeof mark.sectionId === "string" && mark.sectionId.length > 0 && mark.sectionId.length <= 100
    && Number.isInteger(mark.paragraphIndex) && mark.paragraphIndex >= 0
    && Number.isInteger(mark.start) && mark.start >= 0 && Number.isInteger(mark.end) && mark.end > mark.start
    && mark.end - mark.start <= 2000 && COLORS.includes(mark.color)
    && Number.isFinite(Date.parse(mark.updatedAt)) && typeof mark.eventId === "string" && mark.eventId.length > 0
    && (mark.deleted === undefined || typeof mark.deleted === "boolean");
}

export function liveCetUnderlines(marks: Record<string, CetUnderline> | CetUnderline[] | undefined): CetUnderline[] {
  const values = Array.isArray(marks) ? marks : Object.values(marks || {});
  return values.filter(mark => validCetUnderline(mark) && !mark.deleted)
    .sort((a, b) => a.sectionId.localeCompare(b.sectionId) || a.paragraphIndex - b.paragraphIndex || a.start - b.start || a.id.localeCompare(b.id));
}

export function mergeCetUnderlines(a: Record<string, CetUnderline> | undefined, b: Record<string, CetUnderline> | undefined): Record<string, CetUnderline> {
  const result = { ...a };
  for (const [id, mark] of Object.entries(b || {})) {
    if (!validCetUnderline(mark) || id !== mark.id) continue;
    const previous = result[id];
    if (!previous || `${mark.updatedAt}\0${mark.eventId}` > `${previous.updatedAt}\0${previous.eventId}`) result[id] = mark;
  }
  return result;
}

function nextTime(previous: CetUnderline | undefined, now: string): string {
  return new Date(Math.max(Date.parse(now), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
}

export function updateCetUnderline(activity: CetActivity, id: string, color: CetUnderlineColor | "remove", now = new Date().toISOString(), newId = () => crypto.randomUUID()): CetActivity {
  if (activity.purpose !== "self_test" || activity.status !== "in_progress") return activity;
  const old = activity.underlines?.[id];
  if (!old || old.deleted || !COLORS.includes(color as CetUnderlineColor) && color !== "remove") return activity;
  if (color !== "remove" && color === old.color) return activity;
  const next = { ...old, color: color === "remove" ? old.color : color, deleted: color === "remove" || undefined, updatedAt: nextTime(old, now), eventId: newId() };
  return { ...activity, underlines: { ...activity.underlines, [id]: next }, updatedAt: next.updatedAt };
}

export function addCetUnderlines(activity: CetActivity, paper: CetPaper, ranges: CetUnderlineRange[], color: CetUnderlineColor, now = new Date().toISOString(), newId = () => crypto.randomUUID()): CetActivity {
  if (activity.purpose !== "self_test" || activity.status !== "in_progress" || !COLORS.includes(color) || !ranges.length || ranges.length > 24) return activity;
  if (ranges.some(range => {
    const paragraph = paper.sections.find(section => section.id === range.sectionId)?.paragraphs[range.paragraphIndex];
    return !activity.sectionIds.includes(range.sectionId) || typeof paragraph !== "string" || !Number.isInteger(range.start) || !Number.isInteger(range.end)
      || range.start < 0 || range.end > paragraph.length || range.end <= range.start || range.end - range.start > 2000 || !paragraph.slice(range.start, range.end).trim();
  })) return activity;
  const marks = { ...activity.underlines };
  for (const range of ranges) {
    for (const old of liveCetUnderlines(marks)) {
      if (old.sectionId !== range.sectionId || old.paragraphIndex !== range.paragraphIndex || old.start >= range.end || old.end <= range.start) continue;
      marks[old.id] = { ...old, deleted: true, updatedAt: nextTime(old, now), eventId: newId() };
      for (const [start, end] of [[old.start, range.start], [range.end, old.end]]) {
        if (start >= end) continue;
        const id = newId();
        marks[id] = { ...old, id, start, end, deleted: undefined, updatedAt: now, eventId: newId() };
      }
    }
    const id = newId();
    marks[id] = { id, ...range, color, updatedAt: now, eventId: newId() };
  }
  if (liveCetUnderlines(marks).length > MAX_MARKS) return activity;
  return { ...activity, underlines: marks, updatedAt: now };
}
