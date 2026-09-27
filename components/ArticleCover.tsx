"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { PublicArticle } from "@/types/publicArticle";
import { prepareCover } from "@/lib/coverMediaQueue";
import styles from "./HomeRedesign.module.css";

export function ArticleCover({ article, featured = false, motion3dEnabled = true }: { article: PublicArticle; featured?: boolean; motion3dEnabled?: boolean }) {
  const surfaceRef = useRef<HTMLSpanElement | null>(null);
  const pointerFrameRef = useRef(0);
  const pointerTargetRef = useRef({ x: 0.5, y: 0.5 });
  const pointerCurrentRef = useRef({ x: 0.5, y: 0.5 });
  const coverUrl = article.recommendation?.coverImageUrl?.trim();
  const variants = article.recommendation?.coverVariants;
  const validVariants = variants?.version === 1 && variants.sourceUrl === coverUrl ? variants : undefined;
  const srcSet = validVariants?.items.map(item => `${item.url} ${item.width}w`).join(", ");
  const criticalSizes = featured ? "(max-width: 900px) 112vw, (max-width: 1440px) 69vw, 950px" : "50vw";
  const [prepared, setPrepared] = useState<{ src: string; srcSet?: string; sizes: string; error?: boolean } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedCoverUrl, setLoadedCoverUrl] = useState<string | null>(null);
  const [measuredSizes, setMeasuredSizes] = useState<string | null>(null);
  const coverFailed = Boolean(coverUrl && (failedUrl === coverUrl || (prepared?.src === coverUrl && prepared.error)));
  const ready = prepared?.src === coverUrl ? prepared : null;
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const measure = () => {
      const ratio = validVariants ? validVariants.width / validVariants.height : 4 / 3;
      // offset sizes exclude the animated scale(.9); object-fit:cover may need
      // more source width than the box when the accepted photo is very wide.
      setMeasuredSizes(`${Math.ceil(Math.max(surface.offsetWidth, surface.offsetHeight * ratio) * 1.06)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [validVariants?.width, validVariants?.height]);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || featured || !coverUrl || !measuredSizes) return;
    return prepareCover(surface, {
      src: coverUrl, srcSet,
      // Includes the existing 111.112% surface and 106% image overscan.
      sizes: measuredSizes,
      done: setPrepared,
    });
  }, [coverUrl, srcSet, featured, measuredSizes]);

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
      data-tilt-disabled={!motion3dEnabled || undefined}
      onPointerMove={updatePointer}
      onPointerLeave={resetPointer}
    >
      {coverUrl && !coverFailed && (featured || ready) ? (
        // Native srcset selects pre-generated immutable files; no visit-time conversion.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} srcSet={ready?.srcSet || srcSet} sizes={ready?.sizes || criticalSizes}
          alt={article.recommendation?.coverImageAlt || article.title}
          width={validVariants?.width || 1920} height={validVariants?.height || 1440}
          loading="eager" decoding="async" fetchPriority={featured ? "high" : "auto"} draggable={false}
          onLoad={() => setLoadedCoverUrl(coverUrl)} onError={() => setFailedUrl(coverUrl)} />
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
