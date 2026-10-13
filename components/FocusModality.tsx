"use client";
import { useEffect } from "react";

/** Dialog focus restoration should retain the user's input method. */
export function FocusModality() {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => { root.dataset.focusInput = "pointer"; };
    const keyboard = (event: KeyboardEvent) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey &&
        ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        root.dataset.focusInput = "keyboard";
      }
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      delete root.dataset.focusInput;
    };
  }, []);
  return null;
}
