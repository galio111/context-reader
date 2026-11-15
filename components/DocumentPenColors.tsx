"use client";
import { DOCUMENT_PEN_COLORS, type DocumentPenColor } from "@/lib/documentPen";
import styles from "./DocumentReader.module.css";

export function DocumentPenColors({color,disabled,onChange}:{color:DocumentPenColor;disabled:boolean;onChange:(color:DocumentPenColor)=>void}){
  return <span className={styles.penColors} role="group" aria-label="画笔颜色">
    {(Object.keys(DOCUMENT_PEN_COLORS) as DocumentPenColor[]).map(value=>{
      const option=DOCUMENT_PEN_COLORS[value];
      return <button key={value} type="button" className={styles.penColor} aria-label={`${option.label}色画笔`} title={`${option.label}色画笔`} aria-pressed={color===value} disabled={disabled} onClick={()=>onChange(value)}><span aria-hidden="true" style={{background:option.stroke}}/>{option.label}</button>;
    })}
  </span>;
}
