"use client";
import type { RefObject } from "react";
import { checkSpelling, spellingSentence } from "@/lib/studySpelling";
import { StudyIcon } from "./StudyIcon";
import styles from "./StudyPanel.module.css";

export function StudySpellingInput({ sentence, word, value, onChange, inputRef, fallback }: {
  sentence: string; word: string; value: string; onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>; fallback: string;
}) {
  const context = spellingSentence(sentence, word);
  if (!context) return <p>{fallback}</p>;
  return <p>{context.before}<span className={styles.spellingSlot}>
    <span className={styles.spellingMeasure} aria-hidden="true">{context.expected}</span>
    <input ref={inputRef} className={styles.spellingInput} aria-label="拼写单词或短语" value={value}
      placeholder="试着拼写" maxLength={256} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
      onChange={e => onChange(e.target.value)}/>
  </span>{context.after}</p>;
}

export function StudySpellingResult({ sentence, word, typed }: { sentence: string; word: string; typed?: string }) {
  const context = spellingSentence(sentence, word);
  if (!context || !typed?.trim()) return <>{sentence}</>;
  const parts = checkSpelling(typed, context.expected);
  const correct = parts.every(part => part.kind === "equal");
  const visible = (text: string) => text.replace(/ /g, "␣");
  return <>{context.before}<span className={styles.spellingResult}>
    <span className={styles.srOnly}>{correct ? "拼写正确" : `你的拼写：${typed}。正确拼写：${context.expected}。`}</span>
    <span aria-hidden="true" className={correct ? styles.spellingCorrect : undefined}>
      {parts.map((part, index) => part.kind === "equal" ? <span key={index}>{part.expected}</span> :
        <span className={styles.spellingChange} key={index}>
          {part.typed && <del>{visible(part.typed)}</del>}
          {part.expected && <ins data-missing={!part.typed}>{visible(part.expected)}</ins>}
        </span>)}
      {correct && <StudyIcon name="check"/>}
    </span>
  </span>{context.after}</>;
}
