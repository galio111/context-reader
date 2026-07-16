"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { ArticleAudienceStage, PublicArticle } from "@/types/publicArticle";
import styles from "./BookRecommendations.module.css";

interface OpeningCover {
  article: PublicArticle;
  rect: { left: number; top: number; width: number; height: number };
}

interface BookRecommendationsProps {
  articles: PublicArticle[];
  openingPublicArticleId: string;
  readerTransitioning: boolean;
  onOpenArticle: (id: string) => Promise<void>;
  onPrefetchArticle: (id: string) => void;
  embedded?: boolean;
  preferredLevel?: ArticleAudienceStage | "all";
}

export function BookRecommendations({
  articles,
  openingPublicArticleId,
  readerTransitioning,
  onOpenArticle,
  onPrefetchArticle,
  embedded = false,
  preferredLevel,
}: BookRecommendationsProps) {
  const [openingCover, setOpeningCover] = useState<OpeningCover | null>(null);
  const [coverExpanded, setCoverExpanded] = useState(false);
  const [sectionEntered, setSectionEntered] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  const level = preferredLevel ?? "all";

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSectionEntered(true);
        observer.disconnect();
      }
    }, { threshold: 0.14 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const coveredArticles = useMemo(
    () => articles.filter((article) => Boolean(article.recommendation?.coverImageUrl?.trim())),
    [articles],
  );
  const matchedArticles = useMemo(() => (
    level === "all"
      ? coveredArticles
      : coveredArticles.filter((article) => article.recommendation?.audienceStages.includes(level))
  ), [coveredArticles, level]);
  const visibleArticles = matchedArticles.length ? matchedArticles : coveredArticles;

  async function openArticle(event: MouseEvent<HTMLButtonElement>, article: PublicArticle) {
    if (openingCover || openingPublicArticleId || readerTransitioning) return;
    const image = event.currentTarget.querySelector("img");
    const rect = (image ?? event.currentTarget).getBoundingClientRect();
    setOpeningCover({ article, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setCoverExpanded(true)));
    await new Promise((resolve) => window.setTimeout(resolve, 480));
    await onOpenArticle(article.id);
    window.setTimeout(() => {
      setCoverExpanded(false);
      window.setTimeout(() => setOpeningCover(null), 420);
    }, 920);
  }

  const overlayStyle = openingCover ? ({
    "--cover-left": `${openingCover.rect.left}px`,
    "--cover-top": `${openingCover.rect.top}px`,
    "--cover-width": `${openingCover.rect.width}px`,
    "--cover-height": `${openingCover.rect.height}px`,
  } as CSSProperties) : undefined;

  return (
    <section ref={sectionRef} className={`${styles.section} ${embedded ? styles.embedded : ""} ${sectionEntered ? styles.entered : ""}`} aria-labelledby="recommendation-heading">
      {!embedded && <div className={styles.turnLeaf} aria-hidden="true" />}
      <header className={styles.header}>
        <div>
          <span>Reading list · 04</span>
          <h2 id="recommendation-heading">推荐文章</h2>
        </div>
      </header>

      {visibleArticles.length > 0 ? (
        <div className={styles.catalogue}>
          {visibleArticles.map((article) => {
            const recommendation = article.recommendation!;
            const busy = openingPublicArticleId === article.id || openingCover?.article.id === article.id;
            return (
              <button
                key={article.id}
                type="button"
                className={styles.article}
                disabled={Boolean(openingCover) || readerTransitioning}
                onPointerEnter={() => onPrefetchArticle(article.id)}
                onFocus={() => onPrefetchArticle(article.id)}
                onClick={(event) => void openArticle(event, article)}
              >
                <span className={styles.imageWrap}>
                  <img src={recommendation.coverImageUrl} alt={recommendation.coverImageAlt || `${article.title} 推荐封面`} />
                  <i>{busy ? "正在展开" : `${recommendation.readingMinutes} 分钟`}</i>
                </span>
                <span className={styles.articleCopy}>
                  <span className={styles.meta}>{recommendation.topics.slice(0, 2).join(" · ")}<em>{recommendation.difficulty}</em></span>
                  <strong>{article.title}</strong>
                  <span>{article.summary}</span>
                  <small>{article.sourceName || "Context Reader"} · CEFR {recommendation.cefr}</small>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>
          <div aria-hidden="true"><i /><i /><i /></div>
          <h3>推荐目录已经就位，公开书目仍是空的</h3>
          <p>候选文章必须补齐封面并由管理员审核发布，才会出现在游客和新用户眼前。这里不会用假文章填满版面。</p>
        </div>
      )}

      {openingCover && (
        <div className={`${styles.coverOverlay} ${coverExpanded ? styles.coverOverlayExpanded : ""}`} style={overlayStyle} aria-hidden="true">
          <img src={openingCover.article.recommendation?.coverImageUrl} alt="" />
          <div><span>{openingCover.article.sourceName || "Context Reader"}</span><strong>{openingCover.article.title}</strong></div>
        </div>
      )}
    </section>
  );
}
