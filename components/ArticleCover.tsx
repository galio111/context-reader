"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { PublicArticle } from "@/types/publicArticle";
import { prepareCover, preparedCover, rememberCover } from "@/lib/coverMediaQueue";
import { coverSource } from "@/lib/coverSources";
import styles from "./HomeRedesign.module.css";

export function ArticleCover({ article, featured = false, priority = false, motion3dEnabled = true }: { article: PublicArticle; featured?: boolean; priority?: boolean; motion3dEnabled?: boolean }) {
  const surfaceRef = useRef<HTMLSpanElement | null>(null);
  const pointerFrameRef = useRef(0);
  const pointerTargetRef = useRef({ x: 0.5, y: 0.5 });
  const pointerCurrentRef = useRef({ x: 0.5, y: 0.5 });
  const coverUrl = article.recommendation?.coverImageUrl?.trim();
  const variants = article.recommendation?.coverVariants;
  const validVariants = variants?.version === 1 && variants.sourceUrl === coverUrl ? variants : undefined;
  const source = coverSource(article, featured);
  const srcSet = source?.srcSet;
  const sizes = source?.sizes || "100vw";
  const eager = featured || priority;
  const [prepared, setPrepared] = useState<{ src: string; srcSet?: string; sizes: string; error?: boolean } | null>(() => source ? preparedCover(source) : null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedCoverUrl, setLoadedCoverUrl] = useState<string | null>(null);
  const coverFailed = Boolean(coverUrl && (failedUrl === coverUrl || (prepared?.src === coverUrl && prepared.error)));
  const ready = prepared?.src === coverUrl ? prepared : null;
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !coverUrl) return;
    if (eager) {
      const image = surface.querySelector("img");
      if (image?.complete && image.naturalWidth) {
        rememberCover({ src: coverUrl, srcSet, sizes }, image);
        setLoadedCoverUrl(coverUrl);
      }
      return;
    }
    return prepareCover(surface, {
      src: coverUrl, srcSet,
      sizes,
      done: setPrepared,
    });
  }, [coverUrl, srcSet, eager, sizes]);

  useEffect(() => () => {
    if (pointerFrameRef.current) window.cancelAnimationFrame(pointerFrameRef.current);
  }, []);

  useEffect(() => {
    if (motion3dEnabled) return;
    pointerTargetRef.current = { x: 0.5, y: 0.5 };
    pointerCurrentRef.current = { x: 0.5, y: 0.5 };
    const surface = surfaceRef.current;
    surface?.style.setProperty("--pointer-x", ".5");
    surface?.style.setProperty("--pointer-y", ".5");
    surface?.style.setProperty("--rotate-x", "0deg");
    surface?.style.setProperty("--rotate-y", "0deg");
  }, [motion3dEnabled]);

  function animatePointer() {
    const surface = surfaceRef.current;
    if (!surface) {
      pointerFrameRef.current = 0;
      return;
    }
    const current = pointerCurrentRef.current;
    const target = pointerTargetRef.current;
    current.x += (target.x - current.x) * 0.14;
    current.y += (target.y - current.y) * 0.14;
    surface.style.setProperty("--pointer-x", current.x.toFixed(4));
    surface.style.setProperty("--pointer-y", current.y.toFixed(4));
    surface.style.setProperty("--rotate-x", `${((0.5 - current.y) * 10).toFixed(2)}deg`);
    surface.style.setProperty("--rotate-y", `${((current.x - 0.5) * 13).toFixed(2)}deg`);
    if (Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.001) {
      pointerFrameRef.current = window.requestAnimationFrame(animatePointer);
    } else {
      pointerFrameRef.current = 0;
    }
  }

  function startPointerAnimation() {
    if (!pointerFrameRef.current) pointerFrameRef.current = window.requestAnimationFrame(animatePointer);
  }

  function updatePointer(event: PointerEvent<HTMLSpanElement>) {
    if (!motion3dEnabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const y = (event.clientY - bounds.top) / Math.max(1, bounds.height);
    pointerTargetRef.current = { x, y };
    startPointerAnimation();
  }

  function resetPointer() {
    pointerTargetRef.current = { x: 0.5, y: 0.5 };
    startPointerAnimation();
  }

  const coverReady = Boolean(coverUrl && (ready || loadedCoverUrl === coverUrl) && !coverFailed);
  return (
    <span className={styles.coverClip}>
    <span
      ref={surfaceRef}
      className={`${styles.coverSurface} ${featured ? styles.coverFeatured : ""}`}
      data-image-pending={Boolean(coverUrl && !coverFailed && !coverReady) || undefined}
      data-image-ready={coverReady || undefined}
      data-image-eager={eager || undefined}
      data-tilt-disabled={!motion3dEnabled || undefined}
      onPointerMove={updatePointer}
      onPointerLeave={resetPointer}
    >
      {coverUrl && !coverFailed && (eager || ready) ? (
        // Native srcset selects pre-generated immutable files; no visit-time conversion.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} srcSet={srcSet} sizes={sizes} data-cover-eager={eager || undefined}
          alt={article.recommendation?.coverImageAlt || article.title}
          width={validVariants?.width || 1920} height={validVariants?.height || 1440}
          loading="eager" decoding="async" fetchPriority={eager ? "high" : "auto"} draggable={false}
          onLoad={event => { if (source) rememberCover(source, event.currentTarget); setLoadedCoverUrl(coverUrl); }} onError={() => setFailedUrl(coverUrl)} />
      ) : !coverUrl ? (
        <span className={styles.coverFallback} aria-label="纯文本外刊封面">
          <i>TEXT EDITION</i>
          <strong>{(article.sourceName || "Context Reader").slice(0, 28)}</strong>
          <small>{article.summary || "一篇值得慢慢读完的英文文章"}</small>
        </span>
      ) : coverFailed ? (
        <span className={styles.coverFallback} role="status"><i>封面暂时无法加载</i><strong>{article.sourceName || "Context Reader"}</strong></span>
      ) : null}
    </span>
    </span>
  );
}
