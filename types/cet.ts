export type CetType = "cloze" | "matching" | "detail";
export interface CetQuestion {
  number: number;
  stem: string;
  options: { key: string; text: string }[];
  answer?: string;
  explanation?: string;
}
export interface CetSection {
  id: string;
  type: CetType;
  title: string;
  paragraphs: string[];
  questions: CetQuestion[];
  bank?: { key: string; text: string }[];
}
export interface CetPaper {
  id: string;
  level: 4 | 6;
  year: number;
  month: number;
  set: number;
  title: string;
  source: string;
  answerSource?: string;
  status: "ready" | "review";
  sections: CetSection[];
}
export interface CetAttempt {
  id: string;
  scope: string;
  paperId: string;
  sectionId?: string;
  activeSection: string;
  title: string;
  mode: "exam" | "study";
  answers: Record<string, string>;
  answerTimes: Record<string, string>;
  revealed: Record<string, string>;
  elapsedMs: number;
  timerEpoch: string;
  timerParts: Record<string, number>;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}
