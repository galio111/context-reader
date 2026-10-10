"use client";
import { openStudy } from "@/lib/studyNavigation";
import styles from "./StudyPanel.module.css";
export function StudyEntry({ reminder = false }: { reminder?: boolean }) {
  return <button type="button" className={reminder ? styles.entryReminder : styles.entry} onClick={openStudy}>
    <span>{reminder ? "背单词" : "背单词"}</span><span>{reminder ? "继续学习 →" : "→"}</span>
  </button>;
}
