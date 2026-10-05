"use client";
import { openStudy } from "@/lib/studyNavigation";
import styles from "./StudyPanel.module.css";
export function StudyEntry({ reminder = false }: { reminder?: boolean }) {
  return <button type="button" className={reminder ? styles.entryReminder : styles.entry} onClick={openStudy}>
    <span>{reminder ? "把读过的词，真正记下来" : "背单词"}</span><span>{reminder ? "开始今天的复习 →" : "→"}</span>
  </button>;
}
