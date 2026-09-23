"use client";
import { useEffect, type RefObject } from "react";

export function useArticleReveal(gridRef: RefObject<HTMLDivElement | null>, cardClass: string, resourceTab: "articles" | "cet", motionKey: string, enabled = true) {
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(`.${cardClass}`));
    if (!enabled) {
      cards.forEach((card) => {
        delete card.dataset.motionReady;
        delete card.dataset.enterDirection;
        card.dataset.visible = "true";
      });
      return;
    }
    if (!("IntersectionObserver" in window)) {
      cards.forEach((card) => { card.dataset.visible = "true"; });
      return;
    }
    cards.forEach((card) => {
      card.dataset.motionReady = "true";
      delete card.dataset.visible;
      delete card.dataset.enterDirection;
    });
    let lastY = window.scrollY;
    let direction: "up" | "down" = "down";
    const trackDirection = () => {
      direction = window.scrollY < lastY ? "up" : "down";
      lastY = window.scrollY;
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const card = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          card.dataset.enterDirection = direction;
          card.dataset.visible = "true";
        } else {
          delete card.dataset.visible;
        }
      });
    }, { rootMargin: "0px 0px -2% 0px", threshold: 0.001 });
    // Let the hidden cover/copy keyframe paint before observing. Without this,
    // already-visible cards (including the featured card and a newly revealed
    // last card) can enter in the same frame and skip their transition entirely.
    let observeFrame = 0;
    const prepareFrame = window.requestAnimationFrame(() => {
      observeFrame = window.requestAnimationFrame(() => {
        cards.forEach((card) => observer.observe(card));
      });
    });
    window.addEventListener("scroll", trackDirection, { passive: true });
    return () => {
      window.cancelAnimationFrame(prepareFrame);
      if (observeFrame) window.cancelAnimationFrame(observeFrame);
      observer.disconnect();
      window.removeEventListener("scroll", trackDirection);
    };
  // Resource tabs unmount the grid even when its article IDs stay unchanged.
  }, [gridRef, cardClass, resourceTab, motionKey, enabled]);
}
