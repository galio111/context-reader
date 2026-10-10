"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { StudyIcon, type StudyIconName } from "./StudyIcon";
import styles from "./StudyPanel.module.css";

export function StudyDialog({title, children, onCancel, busy = false, icon = "cards"}: {
  title: string; children: ReactNode; onCancel: () => void; busy?: boolean; icon?: StudyIconName;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={dialog} className={styles.confirm} aria-labelledby={heading}
    onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!busy) onCancel(); }}
    onClick={e => { if (e.target === e.currentTarget && !busy) { const r=e.currentTarget.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onCancel(); } }}>
    <div className={styles.dialogTop}><span className={styles.dialogSymbol}><StudyIcon name={icon}/></span><button type="button" className={styles.iconButton} aria-label="关闭提示" disabled={busy} onClick={onCancel}><StudyIcon name="close"/></button></div>
    <h2 id={heading}>{title}</h2>{children}
  </dialog>;
}
