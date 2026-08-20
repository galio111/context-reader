"use client";

import type { CSSProperties, ReactNode } from "react";
import { useRef, type MouseEvent } from "react";
import styles from "./ClearableField.module.css";

interface ClearableFieldProps {
  children: ReactNode;
  value: string;
  onClear: () => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  multiline?: boolean;
  clearButtonInset?: string;
  inputPaddingRight?: string;
}

export default function ClearableField({
  children,
  value,
  onClear,
  label = "清空输入内容",
  className = "",
  disabled = false,
  multiline = false,
  clearButtonInset,
  inputPaddingRight,
}: ClearableFieldProps) {
  const fieldRef = useRef<HTMLSpanElement>(null);
  const fieldStyle = {
    ...(clearButtonInset ? { "--clearable-button-inset": clearButtonInset } : {}),
    ...(inputPaddingRight ? { "--clearable-input-padding": inputPaddingRight } : {}),
  } as CSSProperties;

  function clear(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onClear();
    window.requestAnimationFrame(() => {
      fieldRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")?.focus();
    });
  }

  return (
    <span
      ref={fieldRef}
      className={`${styles.field} ${multiline ? styles.multiline : ""} ${className}`.trim()}
      style={fieldStyle}
      data-clearable-field
    >
      {children}
      {value.length > 0 && (
        <button
          className={styles.button}
          type="button"
          onClick={clear}
          aria-label={label}
          title={label}
          disabled={disabled}
          data-clear-input-button
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
          </svg>
        </button>
      )}
    </span>
  );
}
