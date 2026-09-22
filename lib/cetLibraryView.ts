export interface CetLibraryView {
  level: 4 | 6;
  view: "paper" | "type";
  type: "cloze" | "matching" | "detail";
  year: string;
  page: number;
}
const KEY = "context-reader:cet-library-view:v1";
export function normalizeCetLibraryView(value: unknown): CetLibraryView {
  const x = value as Partial<CetLibraryView> | null;
  return {
    level: x?.level === 6 ? 6 : 4,
    view: x?.view === "type" ? "type" : "paper",
    type: x?.type === "matching" || x?.type === "detail" ? x.type : "cloze",
    year: typeof x?.year === "string" && /^20\d{2}$/.test(x.year) ? x.year : "recent",
    page: Number.isInteger(x?.page) && Number(x?.page) >= 0 && Number(x?.page) < 1000 ? Number(x?.page) : 0,
  };
}
export function readCetLibraryView(): CetLibraryView {
  try { return normalizeCetLibraryView(JSON.parse(sessionStorage.getItem(KEY) || "null")); }
  catch { return normalizeCetLibraryView(null); }
}
export function writeCetLibraryView(view: CetLibraryView): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(normalizeCetLibraryView(view))); }
  catch { /* Filters remain usable when browser storage is unavailable. */ }
}
