import type { CSSProperties } from "react";

const paths = {
  book: "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2",
  cards: "M7 5h12v16H7zM4 17V2h12",
  chart: "M4 4v16h17M8 16v-5m5 5V7m5 9V3",
  gift: "M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
  profile: "M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  back: "m10 5-7 7 7 7M3 12h18",
  undo: "M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14",
  arrow: "M3 12h18m-7-7 7 7-7 7",
  external: "M14 3h7v7m0-7L10 14M10 3H4v17h17v-6",
  check: "m5 12 4 4L20 5",
  close: "m6 6 12 12M6 18 18 6",
  pause: "M8 4v16M16 4v16",
  search: "M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-2 6 6 6",
} as const;
export type StudyIconName = keyof typeof paths;
export function StudyIcon({name, className, style}: {name: StudyIconName; className?: string; style?: CSSProperties}) {
  return <svg className={className} style={style} width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
