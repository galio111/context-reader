"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
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
  preferredPace?: "轻松" | "适中" | "挑战" | "";
  preferredInterests?: string[];
  personalized?: boolean;
  onPersonalize?: () => void;
  scrollContainerRef?: { current: HTMLElement | null };
}

const DEFAULT_RECOMMENDATION_STAGES: ArticleAudienceStage[] = ["CET-4", "CET-6", "考研", "IELTS", "TOEFL"];

function dailyArticleRank(articleId: string): number {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  let hash = 2166136261;
  for (const character of `${day}:${articleId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function BookRecommendations({
  articles,
  openingPublicArticleId,
  readerTransitioning,
  onOpenArticle,
  onPrefetchArticle,
  embedded = false,
  preferredLevel,
  preferredPace = "",
  preferredInterests = [],
  personalized = false,
  onPersonalize,
  scrollContainerRef,
}: BookRecommendationsProps) {
  const [openingCover, setOpeningCover] = useState<OpeningCover | null>(null);
  const [coverExpanded, setCoverExpanded] = useState(false);
  const [sectionEntered, setSectionEntered] = useState(false);
  const [failedCoverIds, setFailedCoverIds] = useState<Set<string>>(() => new Set());
  const sectionRef = useRef<HTMLElement | null>(null);
  const setSectionRef = useCallback((element: HTMLElement | null) => {
    sectionRef.current = element;
    if (scrollContainerRef) scrollContainerRef.current = element;
  }, [scrollContainerRef]);

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
  const visibleArticles = useMemo(() => {
    if (!personalized) {
      const defaultPool = coveredArticles.filter((article) =>
        article.recommendation?.audienceStages.some((stage) => DEFAULT_RECOMMENDATION_STAGES.includes(stage)),
      );
      return [...(defaultPool.length ? defaultPool : coveredArticles)]
        .sort((left, right) => dailyArticleRank(left.id) - dailyArticleRank(right.id));
    }

    const ranked = coveredArticles.map((article) => {
      const recommendation = article.recommendation!;
      let score = 0;
      if (level !== "all" && recommendation.audienceStages.includes(level)) score += 8;
      for (const interest of preferredInterests) {
        if (recommendation.topics.some((topic) => topic.includes(interest))) score += 3;
      }
      const difficulty = recommendation.difficulty;
      if (preferredPace === "轻松" && /(小学|初中|高中|CET-4)/.test(difficulty)) score += 2;
      if (preferredPace === "挑战" && /(CET-6|考研|雅思|托福)/.test(difficulty)) score += 2;
      if (preferredPace === "适中") score += 1;
      return { article, score, dailyRank: dailyArticleRank(article.id) };
    });

    const matched = ranked.filter((item) => item.score > 0);
    return (matched.length ? matched : ranked)
      .sort((left, right) => right.score - left.score || left.dailyRank - right.dailyRank)
      .map((item) => item.article);
  }, [coveredArticles, level, personalized, preferredInterests, preferredPace]);

  async function openArticle(event: MouseEvent<HTMLButtonElement>, article: PublicArticle) {
    if (openingCover || openingPublicArticleId || readerTransitioning) return;
    const image = event.currentTarget.querySelector("img");
    const rect = (image ?? event.currentTarget).getBoundingClientRect();
    setOpeningCover({ article, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setCoverExpanded(true)));
    const articleRequest = onOpenArticle(article.id);
    await Promise.all([
      articleRequest,
      new Promise((resolve) => window.setTimeout(resolve, 480)),
    ]);
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

  const markCoverUnavailable = useCallback((articleId: string) => {
    setFailedCoverIds((current) => {
      if (current.has(articleId)) return current;
      const next = new Set(current);
      next.add(articleId);
      return next;
    });
  }, []);

  return (
    <section ref={setSectionRef} className={`${styles.section} ${embedded ? styles.embedded : ""} ${sectionEntered ? styles.entered : ""}`} aria-labelledby="recommendation-heading">
      {!embedded && <div className={styles.turnLeaf} aria-hidden="true" />}
      <header className={styles.header}>
        <div>
          <span>Reading list · 03</span>
          <h2 id="recommendation-heading">推荐文章</h2>
        </div>
        <div className={styles.recommendationControls}>
          <span className={styles.dailyBadge}><i aria-hidden="true" />每日更新</span>
          {onPersonalize && (
            <button type="button" className={styles.personalizeButton} onClick={onPersonalize}>
              {personalized ? "修改个性化推荐" : "个性化推荐"}
            </button>
          )}
          <small>{personalized ? "正在按照你的阶段、强度和兴趣排序" : "当前为四级及以上默认推荐"}</small>
        </div>
      </header>

      {visibleArticles.length > 0 ? (
        <div className={styles.catalogue}>
          {visibleArticles.map((article) => {
            const recommendation = article.recommendation!;
            const busy = openingPublicArticleId === article.id || openingCover?.article.id === article.id;
            const coverUnavailable = failedCoverIds.has(article.id);
            return (
              <button
                key={article.id}
                type="button"
                className={styles.article}
                disabled={Boolean(openingCover) || readerTransitioning}
                onPointerEnter={() => onPrefetchArticle(article.id)}
                onPointerDown={() => onPrefetchArticle(article.id)}
                onFocus={() => onPrefetchArticle(article.id)}
                onClick={(event) => void openArticle(event, article)}
              >
                <span className={styles.imageWrap}>
                  {coverUnavailable ? (
                    <span className={styles.coverFallback} aria-hidden="true">
                      <span>封面暂时无法加载</span>
                      <small>{article.sourceName || "Context Reader"}</small>
                    </span>
                  ) : (
                    <img
                      src={recommendation.coverImageUrl}
                      alt={recommendation.coverImageAlt || `${article.title} 推荐封面`}
                      onError={() => markCoverUnavailable(article.id)}
                    />
                  )}
                  <i>{busy ? "正在展开" : `${recommendation.wordCount.toLocaleString("zh-CN")} 词`}</i>
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
          {failedCoverIds.has(openingCover.article.id) ? (
            <span className={styles.coverOverlayFallback}>封面暂时无法加载</span>
          ) : (
            <img
              src={openingCover.article.recommendation?.coverImageUrl}
              alt=""
              onError={() => markCoverUnavailable(openingCover.article.id)}
            />
          )}
          <div><span>{openingCover.article.sourceName || "Context Reader"}</span><strong>{openingCover.article.title}</strong></div>
        </div>
      )}
    </section>
  );
}
