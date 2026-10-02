"use client";
import { useEffect, useState } from "react";

/** Speculative videos/CET modules yield bandwidth to the ten parser-started
 * photos. This never delays the opening, scrolling or explicit resource clicks. */
export function useShowcaseCoversReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const check = () => {
      if ([...document.querySelectorAll<HTMLImageElement>("img[data-cover-eager]")].some(image => !image.complete)) return;
      setReady(true);
      document.removeEventListener("load", check, true);
      document.removeEventListener("error", check, true);
    };
    document.addEventListener("load", check, true);
    document.addEventListener("error", check, true);
    check();
    // A permanently stalled cover must not prevent the other tools from warming.
    const timeout = window.setTimeout(() => setReady(true), 8000);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("load", check, true);
      document.removeEventListener("error", check, true);
    };
  }, []);
  return ready;
}
