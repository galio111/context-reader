"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { getVocabularyEntries } from "@/lib/vocabulary";
import { useAccount } from "@/components/AccountProvider";
import { BookLetterField } from "@/components/BookLetterField";
import ClearableField from "@/components/ClearableField";
import { BookDictionary } from "@/components/BookDictionary";
import { HomeOptionMenu, type PreviewKind } from "@/components/HomeOptionMenu";
import { PillNavAction } from "@/components/PillNavAction";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { PUBLIC_CONTACT } from "@/lib/publicContact";
import type { ImportedArticle, SavedArticle } from "@/types/article";
import type { PublicArticle } from "@/types/publicArticle";
import type { VocabularyEntry } from "@/types/vocabulary";
import type { TemporaryReading } from "@/lib/temporaryReading";
import Ballpit, { type BallpitHandle } from "@/components/Ballpit";
import { FallingWordOpening } from "@/components/FallingWordOpening";
import {
  audienceStagesForReadingLevel,
  articleMatchesRecommendationInterest,
  emptyRecommendationPreferences,
  readRecommendationPreferences,
  RECOMMENDATION_INTERESTS,
  RECOMMENDATION_READING_LEVELS,
  type RecommendationPreferences,
  writeRecommendationPreferences,
} from "@/lib/recommendationPreferences";
import { ARTICLE_DIFFICULTIES, type ArticleDifficulty } from "@/types/publicArticle";
import type { HomepageCuration } from "@/lib/homepageCurationShared";
import styles from "./HomeRedesign.module.css";

const BALL_COLORS = [
  0xffffff,
  0x171720,
  0x5227ff,
  0x2563eb,
  0x06b6d4,
  0x10b981,
  0xf59e0b,
  0xf43f5e,
];

const BALL_MATERIAL = {
  metalness: 0.22,
  roughness: 0.34,
  clearcoat: 1,
  clearcoatRoughness: 0.12,
  transparent: true,
  opacity: 0.84,
  depthWrite: false,
};

const HOME_PREFERENCES_KEY = "context-reader-home-ui-v1";
const HOME_VIEW_STATE_KEY = "context-reader-home-view-v1";
type HomeTheme = "day" | "night";

const CATEGORY_FILTERS = [
  { label: "推荐", test: () => true },
  { label: "时事", test: (article: PublicArticle) => article.recommendation?.topics.some((topic) => /社会/.test(topic)) ?? false },
  { label: "科技", test: (article: PublicArticle) => article.recommendation?.topics.some((topic) => /科技/.test(topic)) ?? false },
  { label: "文化", test: (article: PublicArticle) => article.recommendation?.topics.some((topic) => /文化|故事/.test(topic)) ?? false },
  { label: "商业", test: (article: PublicArticle) => /business|econom|finance|商业|经济/i.test(`${article.sourceName} ${article.title}`) },
] as const;

const FEATURE_ORBIT = [
  { key: "context", index: "01", title: "语境划词", copy: "词义留在句子里，理解不必离开正在读的这一段。", meta: "解释 · 翻译" },
  { key: "translation", index: "02", title: "全文翻译", copy: "读到真正困难的地方，再展开整篇文章的另一层。", meta: "全文翻译 · 摘要" },
  { key: "journals", index: "03", title: "精选外刊", copy: "从经过挑选的文章开始，不必先解决去哪里找的问题。", meta: "分类 · 难度" },
  { key: "import", index: "04", title: "自主导入", copy: "粘贴正文或输入网址，把那篇一直没读完的文章带进来。", meta: "正文 · 网址" },
  { key: "progress", index: "05", title: "继续阅读", copy: "保存阅读位置，下一次仍从这句话附近继续。", meta: "进度 · 跨设备" },
  { key: "vocabulary", index: "06", title: "生词与原句", copy: "留下真正遇见过的词，也留下它当时所在的句子。", meta: "生词本 · 原句" },
  { key: "anki", index: "07", title: "与 Anki 协作", copy: "把阅读中积累的词带进持续复习，而不是读完就散。", meta: "积累 · 复习" },
] as const;

const HERO_SUBTITLES = {
  a: "从精选外刊到你的长文，让每一处难懂，都能在语境里得到解释。",
  b: "从一篇精选外刊开始，让漫长而陌生的英文，在语境中渐渐清晰。",
  c: "精选值得读的外刊，也让你带来的长文，在语境中变得可读。",
} as const;

type InputMode = "paste" | "url";
type QuickActionKind = "import" | "dictionary" | "vocabulary" | "articles";

function QuickActionIcon({ kind }: { kind: QuickActionKind }) {
  if (kind === "import") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v10m0 0 3.5-3.5M10 12 6.5 8.5M3.5 14.5v2h13v-2" /></svg>;
  }
  if (kind === "dictionary") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.3 12.3 4.2 4.2" /></svg>;
  }
  if (kind === "vocabulary") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h10v13l-5-3-5 3z" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h12v12H4zM7 7h6M7 10h6M7 13h4" /></svg>;
}

function FeatureOrbitVisual({ kind }: { kind: (typeof FEATURE_ORBIT)[number]["key"] }) {
  if (kind === "context") {
    return <div className={styles.orbitContext}><p>The meaning becomes clear in <mark>context</mark>.</p><aside><strong>context</strong><span>语境，上下文</span></aside></div>;
  }
  if (kind === "translation") {
    return <div className={styles.orbitTranslation}><span>Original</span><p>Language carries more than a literal meaning.</p><span>译文</span><p>语言承载的，往往不止字面含义。</p></div>;
  }
  if (kind === "journals") {
    return <div className={styles.orbitJournals}><i>FA</i><i>1843</i><i>TIME</i><span>每周更新</span></div>;
  }
  if (kind === "import") {
    return <div className={styles.orbitImport}><span><b>粘贴文章</b><i>输入网址</i></span><p>Paste the article you want to finish reading…</p><em>开始阅读</em></div>;
  }
  if (kind === "progress") {
    return <div className={styles.orbitProgress}><span>CONTINUE READING</span><strong>The article you left yesterday</strong><i><b /></i><small>63% · 从上次位置继续</small></div>;
  }
  if (kind === "vocabulary") {
    return <div className={styles.orbitVocabulary}><span><strong>retain</strong><i>/rɪˈteɪn/</i></span><p>to keep something or continue to have it</p><small>保留原句与语境</small></div>;
  }
  return <div className={styles.orbitAnki}><span>Context Reader</span><strong>retain</strong><p>在真实原句里再次遇见它</p><em>添加到 Anki</em></div>;
}

interface HomeRedesignProps {
  forceGuestPreview?: boolean;
  forceMemberPreview?: boolean;
  skipMemberOpening?: boolean;
  article: string;
  articleUrl: string;
  urlPreview: ImportedArticle | null;
  error: string;
  urlError: string;
  importingUrl: boolean;
  openingPublicArticleId: string;
  publicArticles: PublicArticle[];
  homepageCuration?: HomepageCuration;
  savedArticles: SavedArticle[];
  temporaryReading: TemporaryReading | null;
  onArticleChange: (value: string) => void;
  onArticleUrlChange: (value: string) => void;
  onStartReading: () => Promise<void> | void;
  onPrepareUrlImport: () => Promise<void> | void;
  onConfirmUrlImport: () => Promise<void> | void;
  onOpenDemoArticle: (article: ImportedArticle) => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onOpenTemporaryReading: (article: TemporaryReading) => void;
  onOpenPublicArticle: (id: string) => Promise<void>;
  onPrefetchPublicArticle: (id: string) => void;
  onDeleteSavedArticle: (id: string) => void;
  onJumpToVocabularySource: (entry: VocabularyEntry) => Promise<boolean>;
  canJumpToVocabularySource: (entry: VocabularyEntry) => boolean;
}

interface OpeningArticle {
  article: PublicArticle;
  source: DOMRect;
  started: boolean;
}

function readingMinutes(article: PublicArticle): number {
  const words = article.recommendation?.wordCount ?? 0;
  return Math.max(1, Math.round(words / 180));
}

function visibleArticleCount(length: number): number {
  if (length <= 1) return length;
  return 1 + Math.floor((Math.min(length, 10) - 1) / 3) * 3;
}

function personalizeRecommendationOrder(
  articles: PublicArticle[],
  activeCategory: string,
  preferences: RecommendationPreferences,
): PublicArticle[] {
  if (activeCategory !== "推荐" || (!preferences.readingLevel && !preferences.interests.length)) return articles;
  const preferredStages = audienceStagesForReadingLevel(preferences.readingLevel);
  return articles
    .map((article, index) => {
      const metadata = article.recommendation;
      const levelScore = preferredStages.some((stage) => metadata?.audienceStages.includes(stage)) ? 4 : 0;
      const interestScore = preferences.interests.filter((interest) => articleMatchesRecommendationInterest(article, interest)).length * 2;
      return { article, index, score: levelScore + interestScore };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ article }) => article);
}

function ArticleCover({ article, featured = false, motion3dEnabled = true }: { article: PublicArticle; featured?: boolean; motion3dEnabled?: boolean }) {
  const surfaceRef = useRef<HTMLSpanElement | null>(null);
  const pointerFrameRef = useRef(0);
  const pointerTargetRef = useRef({ x: 0.5, y: 0.5 });
  const pointerCurrentRef = useRef({ x: 0.5, y: 0.5 });

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

  const coverUrl = article.recommendation?.coverImageUrl?.trim();
  return (
    <span
      ref={surfaceRef}
      className={`${styles.coverSurface} ${featured ? styles.coverFeatured : ""}`}
      data-tilt-disabled={!motion3dEnabled || undefined}
      onPointerMove={updatePointer}
      onPointerLeave={resetPointer}
    >
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt={article.recommendation?.coverImageAlt || article.title} draggable={false} />
      ) : (
        <span className={styles.coverFallback} aria-hidden="true"><i /><i /></span>
      )}
    </span>
  );
}

export function HomeRedesign(props: HomeRedesignProps) {
  const { account, loading: accountLoading, hasLocalAccountAccess, isOffline, localAccount } = useAccount();
  // This is a visual preview only: it never drops the real session or grants guest
  // permissions. Keeping it URL-driven lets the owner compare both home states
  // without repeatedly logging out and back in.
  const [guestPreviewAllowed, setGuestPreviewAllowed] = useState(Boolean(props.forceGuestPreview));
  const [memberPreviewAllowed, setMemberPreviewAllowed] = useState(Boolean(props.forceMemberPreview));
  const [journeyHomeMode, setJourneyHomeMode] = useState<"guest" | "member" | null>(() => (
    props.forceMemberPreview ? "member" : props.forceGuestPreview ? "guest" : null
  ));
  const journeyPending = !guestPreviewAllowed && !memberPreviewAllowed && journeyHomeMode === null;
  const memberHome = memberPreviewAllowed || (!guestPreviewAllowed && journeyHomeMode === "member");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuInitialPreview, setMenuInitialPreview] = useState<PreviewKind | null>(null);
  const [dictionaryMounted, setDictionaryMounted] = useState(false);
  const [dictionaryClosing, setDictionaryClosing] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [activeCategory, setActiveCategory] = useState("推荐");
  const [categorySwitching, setCategorySwitching] = useState(false);
  const [recommendationPreferences, setRecommendationPreferences] = useState<RecommendationPreferences>(emptyRecommendationPreferences);
  const [preferenceDraft, setPreferenceDraft] = useState<RecommendationPreferences>(emptyRecommendationPreferences);
  const [preferenceOpen, setPreferenceOpen] = useState(false);
  const [memberLibraryOpen, setMemberLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryDifficulty, setLibraryDifficulty] = useState<ArticleDifficulty | "">("");
  const [featurePosition, setFeaturePosition] = useState(0);
  const [featureDragging, setFeatureDragging] = useState(false);
  const [continueVariant, setContinueVariant] = useState<"editorial" | "cover">("cover");
  const [navMotion, setNavMotion] = useState<"slide" | "fill" | "icon">("icon");
  const [memberOpeningVariant, setMemberOpeningVariant] = useState<"spiral" | "wordfall">("wordfall");
  const [heroSubtitleVariant, setHeroSubtitleVariant] = useState<keyof typeof HERO_SUBTITLES>("a");
  const [memberOpeningVisible, setMemberOpeningVisible] = useState(false);
  const [letterMotionEnabled, setLetterMotionEnabled] = useState(true);
  const [recommendationMotionEnabled, setRecommendationMotionEnabled] = useState(true);
  const [homeTheme, setHomeTheme] = useState<HomeTheme>("day");
  const [memberBallpitReady, setMemberBallpitReady] = useState(false);
  const [openingArticle, setOpeningArticle] = useState<OpeningArticle | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [contactCopied, setContactCopied] = useState(false);
  const [wechatQrOpen, setWechatQrOpen] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [vocabularyEntries, setVocabularyEntries] = useState<VocabularyEntry[]>([]);
  const heroRef = useRef<HTMLElement | null>(null);
  const coverStageRef = useRef<HTMLElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const ballpitControllerRef = useRef<BallpitHandle | null>(null);
  const memberBallpitControllerRef = useRef<BallpitHandle | null>(null);
  const recommendationsRef = useRef<HTMLElement | null>(null);
  const articleGridRef = useRef<HTMLDivElement | null>(null);
  const preferenceControlRef = useRef<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLElement | null>(null);
  const coverProgressRef = useRef(0);
  const memberOpeningFrameRef = useRef(0);
  const memberOpeningStartRef = useRef(0);
  const memberOpeningProgressRef = useRef(0);
  const memberOpeningFastStartRef = useRef(0);
  const memberOpeningFastProgressRef = useRef(0);
  const openingTimerRef = useRef<number | null>(null);
  const dictionaryWindowRef = useRef<HTMLElement | null>(null);
  const dictionaryCloseTimerRef = useRef<number | null>(null);
  const categorySwitchTimerRef = useRef<number | null>(null);
  const coverScrollFrameRef = useRef(0);
  const coverScrollTargetRef = useRef<"cover" | "recommendations" | null>(null);
  const orbitDragRef = useRef({ pointerId: -1, startX: 0, lastX: 0, lastTime: 0, velocity: 0, startPosition: 0 });
  const orbitSuppressClickRef = useRef(false);

  const category = CATEGORY_FILTERS.find((item) => item.label === activeCategory) ?? CATEGORY_FILTERS[0];
  const allCategoryArticles = useMemo(
    () => props.publicArticles.filter(category.test),
    [category, props.publicArticles],
  );
  const categoryArticles = useMemo(
    () => {
      const filtered = allCategoryArticles;
      const curatedIds = props.homepageCuration?.categories[category.label] ?? [];
      if (!curatedIds.length) return filtered;
      const byId = new Map(filtered.map((article) => [article.id, article]));
      return curatedIds.map((id) => byId.get(id)).filter((article): article is PublicArticle => Boolean(article));
    },
    [allCategoryArticles, category, props.homepageCuration],
  );
  const personalizedCategoryArticles = useMemo(() => {
    return personalizeRecommendationOrder(categoryArticles, activeCategory, recommendationPreferences);
  }, [activeCategory, categoryArticles, recommendationPreferences]);
  const personalizedAllCategoryArticles = useMemo(
    () => personalizeRecommendationOrder(allCategoryArticles, activeCategory, recommendationPreferences),
    [activeCategory, allCategoryArticles, recommendationPreferences],
  );
  const showcaseArticleCount = visibleArticleCount(personalizedCategoryArticles.length);
  const libraryArticles = useMemo(() => {
    const term = librarySearch.trim().toLocaleLowerCase("zh-CN");
    return personalizedAllCategoryArticles.filter((article) => {
      if (libraryDifficulty && article.recommendation?.difficulty !== libraryDifficulty) return false;
      return !term || `${article.title} ${article.sourceName} ${article.summary}`.toLocaleLowerCase("zh-CN").includes(term);
    });
  }, [libraryDifficulty, librarySearch, personalizedAllCategoryArticles]);
  const displayArticles = memberHome && memberLibraryOpen
    ? libraryArticles
    : personalizedCategoryArticles.slice(0, showcaseArticleCount);
  const orderedSavedArticles = useMemo(
    () => [...props.savedArticles].sort((a, b) => Date.parse(b.lastOpenedAt || b.updatedAt) - Date.parse(a.lastOpenedAt || a.updatedAt)),
    [props.savedArticles],
  );
  const latestSavedArticle = orderedSavedArticles[0] ?? null;
  const hasReadingHistory = Boolean(props.temporaryReading || latestSavedArticle);
  const temporaryIsLatest = Boolean(
    props.temporaryReading
    && (!latestSavedArticle || Date.parse(props.temporaryReading.updatedAt) >= Date.parse(latestSavedArticle.lastOpenedAt || latestSavedArticle.updatedAt)),
  );
  const continueProgress = temporaryIsLatest
    ? props.temporaryReading?.readingProgress?.scrollRatio ?? 0
    : latestSavedArticle?.readingProgress?.scrollRatio ?? 0;
  const continueCover = latestSavedArticle?.importedArticle?.blocks.find((block) => block.type === "image");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preview = params.get("preview");
    setGuestPreviewAllowed(preview === "guest");
    setMemberPreviewAllowed(preview === "member");
    setContinueVariant(params.get("continue") === "editorial" ? "editorial" : "cover");
    const requestedNavMotion = params.get("navmotion");
    setNavMotion(requestedNavMotion === "fill" || requestedNavMotion === "slide" ? requestedNavMotion : "icon");
    setMemberOpeningVariant(params.get("opening") === "spiral" ? "spiral" : "wordfall");
    const requestedSubtitle = params.get("subtitle");
    setHeroSubtitleVariant(requestedSubtitle === "b" || requestedSubtitle === "c" ? requestedSubtitle : "a");
  }, [props.forceGuestPreview, props.forceMemberPreview]);

  useEffect(() => {
    if (guestPreviewAllowed || memberPreviewAllowed || accountLoading || journeyHomeMode !== null) return;
    // Resolve the journey once per mounted homepage. A guest who signs in halfway
    // through a visit stays in the same guest surface; a fresh visit resolves to
    // the member workbench. This avoids surprising route/state replacement.
    setJourneyHomeMode(account.authenticated ? "member" : "guest");
  }, [account.authenticated, accountLoading, guestPreviewAllowed, journeyHomeMode, memberPreviewAllowed]);

  useEffect(() => {
    const stored = readRecommendationPreferences();
    setRecommendationPreferences(stored);
    setPreferenceDraft(stored);
    try {
      const view = JSON.parse(window.sessionStorage.getItem(HOME_VIEW_STATE_KEY) || "null") as { category?: string } | null;
      if (CATEGORY_FILTERS.some((item) => item.label === view?.category)) setActiveCategory(view?.category ?? "推荐");
    } catch {
      // A stale view snapshot falls back to the recommendation category.
    }
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HOME_PREFERENCES_KEY) || "null") as {
        theme?: HomeTheme;
        letterMotionEnabled?: boolean;
        recommendationMotionEnabled?: boolean;
      } | null;
      if (stored?.theme === "night" || stored?.theme === "day") setHomeTheme(stored.theme);
      if (typeof stored?.letterMotionEnabled === "boolean") setLetterMotionEnabled(stored.letterMotionEnabled);
      if (typeof stored?.recommendationMotionEnabled === "boolean") setRecommendationMotionEnabled(stored.recommendationMotionEnabled);
    } catch {
      // Corrupt display preferences fall back to the calm daytime defaults.
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.contextTheme = homeTheme;
    document.documentElement.style.colorScheme = homeTheme === "night" ? "dark" : "light";
  }, [homeTheme]);

  useEffect(() => {
    if (!preferenceOpen) return;
    const closeFromOutside = (event: globalThis.PointerEvent) => {
      if (!preferenceControlRef.current?.contains(event.target as Node)) setPreferenceOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreferenceOpen(false);
    };
    window.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("keydown", closeFromKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeFromOutside);
      window.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [preferenceOpen]);

  useEffect(() => {
    const refreshVocabulary = () => setVocabularyEntries(getVocabularyEntries());
    refreshVocabulary();
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabulary);
    return () => window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabulary);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setCompactViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const grid = articleGridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(`.${styles.articleCard}`));
    if (!("IntersectionObserver" in window)) {
      cards.forEach((card) => { card.dataset.visible = "true"; });
      return;
    }
    cards.forEach((card) => { card.dataset.motionReady = "true"; });
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
    }, { rootMargin: "0px 0px 4% 0px", threshold: 0.001 });
    cards.forEach((card) => observer.observe(card));
    window.addEventListener("scroll", trackDirection, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", trackDirection);
    };
  }, [activeCategory, displayArticles.length]);

  useEffect(() => {
    if (memberHome) return;
    const section = importRef.current;
    if (!section) return;
    if (!("IntersectionObserver" in window)) {
      section.dataset.visible = "true";
      return;
    }
    section.dataset.motionReady = "true";
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) section.dataset.visible = "true";
      else delete section.dataset.visible;
    }, { rootMargin: "4% 0px 4%", threshold: 0.08 });
    observer.observe(section);
    return () => observer.disconnect();
  }, [memberHome]);

  useEffect(() => {
    const grid = articleGridRef.current;
    if (!grid) return;
    let lastY = window.scrollY;
    let lastTime = performance.now();
    let velocity = 0;
    let frame = 0;
    const renderVelocity = () => {
      velocity *= 0.86;
      const normalized = Math.max(-1, Math.min(1, velocity));
      grid.style.setProperty("--scroll-drift", (normalized * 12).toFixed(2));
      grid.style.setProperty("--scroll-skew", (normalized * -0.9).toFixed(2));
      grid.style.setProperty("--scroll-stretch", (1 + Math.abs(normalized) * 0.018).toFixed(4));
      grid.style.setProperty("--scroll-blur", `${(Math.abs(normalized) * 1.15).toFixed(2)}px`);
      if (Math.abs(velocity) > 0.008) frame = window.requestAnimationFrame(renderVelocity);
      else frame = 0;
    };
    const onScroll = () => {
      const now = performance.now();
      const deltaTime = Math.max(12, now - lastTime);
      const raw = (window.scrollY - lastY) / deltaTime;
      velocity = Math.max(-1, Math.min(1, velocity * 0.55 + raw * 0.45));
      lastY = window.scrollY;
      lastTime = now;
      if (!frame) frame = window.requestAnimationFrame(renderVelocity);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => () => {
    if (memberOpeningFrameRef.current) window.cancelAnimationFrame(memberOpeningFrameRef.current);
    if (openingTimerRef.current !== null) window.clearTimeout(openingTimerRef.current);
    if (dictionaryCloseTimerRef.current !== null) window.clearTimeout(dictionaryCloseTimerRef.current);
    if (categorySwitchTimerRef.current !== null) window.clearTimeout(categorySwitchTimerRef.current);
  }, []);

  useEffect(() => {
    if (!dictionaryMounted) return;
    const element = dictionaryWindowRef.current;
    if (!element) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem("context-reader-dictionary-window-v1") || "null") as {
        left?: number;
        top?: number;
        width?: number;
        height?: number;
      } | null;
      if (!saved) return;
      const width = Math.min(Math.max(saved.width ?? 370, 320), window.innerWidth - 32);
      const height = Math.min(Math.max(saved.height ?? 560, 380), window.innerHeight - 32);
      const visibleGrip = Math.min(104, width);
      const left = Math.min(
        Math.max(saved.left ?? 128, visibleGrip - width),
        window.innerWidth - visibleGrip,
      );
      const top = Math.min(Math.max(saved.top ?? 92, 16), window.innerHeight - 68);
      Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    } catch {
      // A stale local window preference must never block dictionary access.
    }
  }, [dictionaryMounted]);

  useEffect(() => {
    if (memberHome) return;
    let frame = 0;
    let stageTop = 0;
    let distance = 1;
    const measureCover = () => {
      const stage = coverStageRef.current;
      const recommendation = recommendationsRef.current;
      if (!stage || !recommendation) return;
      stageTop = stage.getBoundingClientRect().top + window.scrollY;
      const recommendationTop = recommendation.getBoundingClientRect().top + window.scrollY;
      distance = Math.max(1, recommendationTop - stageTop);
    };
    const updateCoverProgress = () => {
      frame = 0;
      const raw = Math.min(1, Math.max(0, (window.scrollY - stageTop) / distance));
      const eased = raw * raw * (3 - 2 * raw);
      coverProgressRef.current = raw;
      flowRef.current?.style.setProperty("--cover-progress", eased.toFixed(4));
      flowRef.current?.style.setProperty("--hero-opacity", Math.max(0, 1 - eased * 2.7).toFixed(4));
      flowRef.current?.style.setProperty("--hero-shift", `${(eased * -34).toFixed(2)}px`);
      flowRef.current?.style.setProperty("--cover-surface-opacity", Math.min(1, Math.max(0, (1 - raw) / 0.18)).toFixed(4));
      flowRef.current?.style.setProperty("--hero-pointer", raw > 0.94 ? "none" : "auto");
      const departureInput = Math.min(1, Math.max(0, (raw - 0.04) / 0.96));
      const departure = departureInput * departureInput * (3 - 2 * departureInput);
      ballpitControllerRef.current?.setDepartureProgress(departure);
    };
    const requestUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateCoverProgress);
    };
    const requestMeasure = () => {
      measureCover();
      requestUpdate();
    };
    measureCover();
    updateCoverProgress();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestMeasure, { passive: true });
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestMeasure);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [memberHome]);

  useEffect(() => {
    if (memberHome) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if ((event.target as Element | null)?.closest?.("[data-local-scroll-surface]")) return;
      const stage = coverStageRef.current;
      const recommendations = recommendationsRef.current;
      if (!stage || !recommendations) return;
      const stageTop = stage.getBoundingClientRect().top + window.scrollY;
      const recommendationsTop = recommendations.getBoundingClientRect().top + window.scrollY;
      const current = window.scrollY;
      const insideHandoff = current >= stageTop - 2 && current < recommendationsTop - 2;
      const atRecommendationStart = current >= recommendationsTop - 3 && current <= recommendationsTop + 56;
      if (event.deltaY > 0 && insideHandoff) {
        event.preventDefault();
        animateCoverSnap("recommendations");
      } else if (event.deltaY < 0 && (insideHandoff || atRecommendationStart)) {
        event.preventDefault();
        animateCoverSnap("cover");
      }
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", handleWheel);
      if (coverScrollFrameRef.current) window.cancelAnimationFrame(coverScrollFrameRef.current);
      coverScrollFrameRef.current = 0;
      coverScrollTargetRef.current = null;
    };
  }, [memberHome]);

  useEffect(() => {
    if (journeyPending || props.skipMemberOpening) {
      setMemberOpeningVisible(false);
      setMemberBallpitReady(false);
      return;
    }
    setMemberOpeningVisible(true);
    // Guests use the same readable word-fall opening. The alternate Ballpit
    // gathering path remains a member-only visual preview.
    if (!memberHome || memberOpeningVariant === "wordfall") return;
    if (!memberBallpitReady) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    memberOpeningStartRef.current = 0;
    memberOpeningProgressRef.current = 0;
    memberOpeningFastStartRef.current = 0;
    memberOpeningFastProgressRef.current = 0;

    const finishQuickly = () => {
      if (!memberOpeningFastStartRef.current) {
        memberOpeningFastStartRef.current = performance.now();
        memberOpeningFastProgressRef.current = memberOpeningProgressRef.current;
      }
    };
    const tick = (time: number) => {
      if (!memberOpeningStartRef.current) memberOpeningStartRef.current = time;
      const elapsed = time - memberOpeningStartRef.current;
      const naturalProgress = reducedMotion ? Math.min(1, elapsed / 360) : Math.min(1, Math.max(0, elapsed - 120) / 1_400);
      const quickProgress = memberOpeningFastStartRef.current
        ? memberOpeningFastProgressRef.current + (1 - memberOpeningFastProgressRef.current) * Math.min(1, (time - memberOpeningFastStartRef.current) / 220)
        : 0;
      const progress = Math.max(naturalProgress, quickProgress);
      memberOpeningProgressRef.current = progress;
      memberBallpitControllerRef.current?.setGatherProgress(progress);
      if (progress < 1) {
        memberOpeningFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        memberOpeningFrameRef.current = 0;
        setMemberOpeningVisible(false);
      }
    };
    memberOpeningFrameRef.current = window.requestAnimationFrame(tick);
    window.addEventListener("pointerdown", finishQuickly, { passive: true });
    window.addEventListener("wheel", finishQuickly, { passive: true });
    window.addEventListener("keydown", finishQuickly);
    return () => {
      window.removeEventListener("pointerdown", finishQuickly);
      window.removeEventListener("wheel", finishQuickly);
      window.removeEventListener("keydown", finishQuickly);
      if (memberOpeningFrameRef.current) window.cancelAnimationFrame(memberOpeningFrameRef.current);
    };
  }, [journeyPending, memberBallpitReady, memberHome, memberOpeningVariant, props.skipMemberOpening]);

  function beginArticleTransition(article: PublicArticle, event: ReactMouseEvent<HTMLButtonElement>) {
    if (openingArticle || props.openingPublicArticleId) return;
    const cover = event.currentTarget.querySelector<HTMLElement>(`.${styles.coverSurface}`);
    if (!cover) {
      void props.onOpenPublicArticle(article.id);
      return;
    }
    props.onPrefetchPublicArticle(article.id);
    const source = cover.getBoundingClientRect();
    setOpeningArticle({ article, source, started: false });
    window.requestAnimationFrame(() => {
      setOpeningArticle({ article, source, started: true });
    });
    openingTimerRef.current = window.setTimeout(() => {
      openingTimerRef.current = null;
      void props.onOpenPublicArticle(article.id).finally(() => {
        setOpeningArticle(null);
      });
    }, 1_720);
  }

  function submitImport() {
    if (inputMode === "url") {
      if (props.urlPreview) void props.onConfirmUrlImport();
      else void props.onPrepareUrlImport();
    }
    else void props.onStartReading();
  }

  function persistHomePreferences(nextTheme: HomeTheme, nextLetterMotionEnabled: boolean, nextRecommendationMotionEnabled: boolean) {
    try {
      window.localStorage.setItem(HOME_PREFERENCES_KEY, JSON.stringify({
        theme: nextTheme,
        letterMotionEnabled: nextLetterMotionEnabled,
        recommendationMotionEnabled: nextRecommendationMotionEnabled,
      }));
    } catch {
      // The controls still apply for this visit when browser storage is blocked.
    }
  }

  function changeHomeTheme(nextTheme: HomeTheme) {
    setHomeTheme(nextTheme);
    persistHomePreferences(nextTheme, letterMotionEnabled, recommendationMotionEnabled);
  }

  function changeLetterMotion(nextEnabled: boolean) {
    setLetterMotionEnabled(nextEnabled);
    persistHomePreferences(homeTheme, nextEnabled, recommendationMotionEnabled);
  }

  function changeRecommendationMotion(nextEnabled: boolean) {
    setRecommendationMotionEnabled(nextEnabled);
    persistHomePreferences(homeTheme, letterMotionEnabled, nextEnabled);
  }

  function animateCoverSnap(target: "cover" | "recommendations") {
    const stage = coverStageRef.current;
    const recommendations = recommendationsRef.current;
    if (!stage || !recommendations) return;
    if (coverScrollFrameRef.current && coverScrollTargetRef.current === target) return;
    if (coverScrollFrameRef.current) window.cancelAnimationFrame(coverScrollFrameRef.current);

    const stageTop = stage.getBoundingClientRect().top + window.scrollY;
    const recommendationsTop = recommendations.getBoundingClientRect().top + window.scrollY;
    const targetY = target === "cover" ? stageTop : recommendationsTop;
    const startY = window.scrollY;
    const fullDistance = Math.max(1, recommendationsTop - stageTop);
    const ratio = Math.min(1, Math.abs(targetY - startY) / fullDistance);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Keep one spatial velocity from either direction and from any interrupted
    // point in the handoff. A non-linear easing curve made the page visibly
    // accelerate and brake while the balls followed a different rhythm.
    const duration = reduced ? 220 : Math.max(200, 1_420 * ratio);
    const startedAt = performance.now();
    coverScrollTargetRef.current = target;

    const tick = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / duration);
      window.scrollTo({ top: startY + (targetY - startY) * progress, left: 0, behavior: "auto" });
      if (progress < 1) {
        coverScrollFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        coverScrollFrameRef.current = 0;
        coverScrollTargetRef.current = null;
      }
    };
    coverScrollFrameRef.current = window.requestAnimationFrame(tick);
  }

  function scrollToImport() {
    importRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openDictionary() {
    if (dictionaryCloseTimerRef.current !== null) window.clearTimeout(dictionaryCloseTimerRef.current);
    setDictionaryClosing(false);
    setDictionaryMounted(true);
  }

  function closeDictionary() {
    setDictionaryClosing(true);
    dictionaryCloseTimerRef.current = window.setTimeout(() => {
      dictionaryCloseTimerRef.current = null;
      setDictionaryMounted(false);
      setDictionaryClosing(false);
    }, 220);
  }

  function persistDictionaryWindow() {
    const element = dictionaryWindowRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    window.localStorage.setItem("context-reader-dictionary-window-v1", JSON.stringify({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }));
  }

  function startDictionaryDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const element = dictionaryWindowRef.current;
    if (!element) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const visibleGrip = Math.min(104, rect.width);
      const left = Math.min(
        Math.max(rect.left + moveEvent.clientX - startX, visibleGrip - rect.width),
        window.innerWidth - visibleGrip,
      );
      const top = Math.min(Math.max(rect.top + moveEvent.clientY - startY, 12), window.innerHeight - 58);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      persistDictionaryWindow();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }

  function openMenuPreview(preview: PreviewKind) {
    setMenuInitialPreview(preview);
    setMenuOpen(true);
  }

  function openRecommendationPreferences() {
    setPreferenceDraft(recommendationPreferences);
    setPreferenceOpen(true);
  }

  function toggleRecommendationInterest(topic: RecommendationPreferences["interests"][number]) {
    setPreferenceDraft((current) => ({
      ...current,
      interests: current.interests.includes(topic)
        ? current.interests.filter((item) => item !== topic)
        : [...current.interests, topic],
    }));
  }

  function saveRecommendationPreferences() {
    const saved = writeRecommendationPreferences(
      { readingLevel: preferenceDraft.readingLevel, interests: preferenceDraft.interests },
      { authenticated: account.authenticated },
    );
    setRecommendationPreferences(saved);
    setPreferenceDraft(saved);
    setPreferenceOpen(false);
    if (activeCategory !== "推荐") switchCategory("推荐");
  }

  function clearRecommendationPreferences() {
    setPreferenceDraft((current) => ({ ...current, readingLevel: "", interests: [] }));
  }

  function switchCategory(nextCategory: string) {
    if (nextCategory === activeCategory || categorySwitching) return;
    setCategorySwitching(true);
    categorySwitchTimerRef.current = window.setTimeout(() => {
      categorySwitchTimerRef.current = null;
      setActiveCategory(nextCategory);
      try {
        window.sessionStorage.setItem(HOME_VIEW_STATE_KEY, JSON.stringify({ category: nextCategory }));
      } catch {
        // The current in-memory category still survives while this page is mounted.
      }
      window.requestAnimationFrame(() => setCategorySwitching(false));
    }, 190);
  }

  function startOrbitDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    orbitDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0,
      startPosition: featurePosition,
    };
    orbitSuppressClickRef.current = false;
    setFeatureDragging(true);
  }

  function moveOrbitDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = orbitDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(8, now - drag.lastTime);
    drag.velocity = (event.clientX - drag.lastX) / elapsed;
    drag.lastX = event.clientX;
    drag.lastTime = now;
    const step = Math.min(330, Math.max(230, window.innerWidth * 0.22));
    const nextDrag = (event.clientX - drag.startX) / step;
    if (Math.abs(event.clientX - drag.startX) > 6) orbitSuppressClickRef.current = true;
    setFeaturePosition(drag.startPosition - nextDrag);
  }

  function finishOrbitDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = orbitDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const step = Math.min(330, Math.max(230, window.innerWidth * 0.22));
    const projected = (event.clientX - drag.startX) / step + drag.velocity * 170 / step;
    const shift = Math.max(-2, Math.min(2, Math.round(projected)));
    setFeaturePosition(drag.startPosition - shift);
    setFeatureDragging(false);
    orbitDragRef.current.pointerId = -1;
    window.setTimeout(() => { orbitSuppressClickRef.current = false; }, 0);
  }

  function centerOrbitCard(index: number) {
    setFeaturePosition((current) => {
      const count = FEATURE_ORBIT.length;
      const normalized = ((current % count) + count) % count;
      let delta = index - normalized;
      if (delta > count / 2) delta -= count;
      if (delta < -count / 2) delta += count;
      return current + delta;
    });
  }

  const previewCover = props.urlPreview?.blocks.find((block) => block.type === "image");
  const previewExcerpt = props.urlPreview?.text.replace(/\s+/g, " ").trim().slice(0, 210) ?? "";
  const previewWordCount = props.urlPreview?.text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
  async function copyWechat() {
    try {
      await navigator.clipboard.writeText(PUBLIC_CONTACT.wechat);
      setContactCopied(true);
      window.setTimeout(() => setContactCopied(false), 1_800);
    } catch {
      setContactCopied(false);
    }
  }

  const renderImportPanel = (compact = false) => (
      <div className={`${styles.importPanel} ${compact ? styles.memberImportPanel : ""}`}>
        <div className={styles.importModes}>
          <button type="button" aria-pressed={inputMode === "paste"} onClick={() => setInputMode("paste")}>粘贴文章</button>
          <button type="button" aria-pressed={inputMode === "url"} onClick={() => setInputMode("url")}>输入网址</button>
        </div>
        <div className={styles.importFieldSlot}>
          {inputMode === "paste" ? (
            <ClearableField value={props.article} onClear={() => props.onArticleChange("")} label="清空粘贴文章" multiline>
              <textarea
                value={props.article}
                onChange={(event) => props.onArticleChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void props.onStartReading();
                  }
                }}
                placeholder="粘贴英文文章内容"
              />
            </ClearableField>
          ) : (
            <>
              <div className={styles.urlFieldRow}>
                <ClearableField value={props.articleUrl} onClear={() => props.onArticleUrlChange("")} label="清空文章网址">
                  <input value={props.articleUrl} onChange={(event) => props.onArticleUrlChange(event.target.value)} placeholder="https://example.com/article" />
                </ClearableField>
                <span className={styles.urlHelp}>
                  <button type="button" aria-label="了解网址抓取范围" aria-describedby="url-import-help">?</button>
                  <span id="url-import-help" role="tooltip">多数公开文章可以直接读取。登录、订阅或限制访问的页面可能无法导入；遇到这种情况，复制正文会更可靠。</span>
                </span>
              </div>
              {props.urlPreview && (
                <article className={styles.urlPreview} aria-label="网址文章预览">
                  {previewCover?.type === "image" && previewCover.src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewCover.src} alt={previewCover.alt || ""} />
                  )}
                  <div>
                    <small>{props.urlPreview.siteName || "来源网站"} · 约 {previewWordCount.toLocaleString("zh-CN")} 词</small>
                    <h3>{props.urlPreview.title || "未命名文章"}</h3>
                    <p>{previewExcerpt}{props.urlPreview.text.length > previewExcerpt.length ? "…" : ""}</p>
                  </div>
                </article>
              )}
            </>
          )}
        </div>
        <button type="button" className={styles.importSubmit} onClick={submitImport} disabled={props.importingUrl}>
          {inputMode === "url" && props.importingUrl ? "正在读取文章…" : inputMode === "url" && props.urlPreview ? "确认并开始阅读" : "开始阅读"}
        </button>
        <p className={styles.importError} role="alert">{inputMode === "url" ? props.urlError : props.error}</p>
        {inputMode === "url" && props.urlError && (
          <button type="button" className={styles.pasteFallback} onClick={() => setInputMode("paste")}>改为粘贴文章正文</button>
        )}
      </div>
  );

  const renderImportSection = () => (
    <section ref={importRef} className={styles.importSection} aria-labelledby="import-heading">
      <div>
        <p>YOUR ARTICLE</p>
        <h2 id="import-heading">读完这些，也别忘了那篇一直没有读下去的文章。</h2>
      </div>
      {renderImportPanel()}
    </section>
  );

  const preferenceSummary = [
    recommendationPreferences.readingLevel,
    recommendationPreferences.interests.length
      ? `${recommendationPreferences.interests.length} 个兴趣`
      : "",
  ].filter(Boolean).join(" · ") || "设置阅读水平与兴趣";

  return (
    <main className={styles.root} data-theme={homeTheme} data-home-mode={memberHome ? "member" : "guest"} data-nav-motion={navMotion} data-guest-preview={guestPreviewAllowed || undefined} data-member-preview={memberPreviewAllowed || undefined}>
      {journeyPending && <div className={styles.accountResolving} role="status" aria-label="正在打开阅读空间"><span /><span /><span /></div>}
      <BookLetterField paused={memberOpeningVisible || !letterMotionEnabled} />
      <header className={styles.topbar}>
        <div className={`${styles.brandCluster} ${memberHome ? styles.brandClusterFixed : ""}`}>
          <PillNavAction className={styles.brand} href="/" label="Context Reader" ariaLabel="Context Reader 首页" />
          <nav className={styles.quickNav} aria-label="常用功能">
            <span className={styles.quickItem} data-tooltip="粘贴正文或输入文章网址">
              <PillNavAction motion="none" className={styles.quickButton} label="导入" ariaLabel="导入文章" onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); scrollToImport(); }} renderIcon={() => <QuickActionIcon kind="import" />} />
            </span>
            <span className={styles.quickItem} data-tooltip="打开可移动的单独查词窗口">
              <PillNavAction motion="none" className={styles.quickButton} label="查词" ariaLabel="单独查词" onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); openDictionary(); }} renderIcon={() => <QuickActionIcon kind="dictionary" />} />
            </span>
            <span className={styles.quickItem} data-tooltip="查看加入生词本的词与原句">
              <PillNavAction motion="none" className={styles.quickButton} label="生词本" ariaLabel="打开生词本" onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); openMenuPreview("vocabulary"); }} renderIcon={() => <QuickActionIcon kind="vocabulary" />} />
            </span>
            <span className={styles.quickItem} data-tooltip="查看保存和最近阅读的文章">
              <PillNavAction motion="none" className={styles.quickButton} label="我的文章" ariaLabel="打开我的文章" onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); openMenuPreview("saved"); }} renderIcon={() => <QuickActionIcon kind="articles" />} />
            </span>
          </nav>
        </div>
        <PillNavAction
          className={styles.menuButton}
          tone="dark"
          label="Menu"
          ariaExpanded={menuOpen}
          ariaControls="home-option-menu"
          onClick={() => setMenuOpen(true)}
          renderIcon={() => <span className={styles.menuGlyph} aria-hidden="true"><i /><i /></span>}
        />
      </header>

      {memberOpeningVisible && (
        <div className={styles.memberOpening} data-ready={memberOpeningVariant === "wordfall" || memberBallpitReady || undefined} aria-hidden="true">
          <div className={styles.memberOpeningBalls}>
            {!memberHome || memberOpeningVariant === "wordfall" ? (
              <FallingWordOpening
                className={styles.wordFallCanvas}
                onComplete={() => setMemberOpeningVisible(false)}
              />
            ) : (
              <Ballpit
                className={styles.ballCanvas}
                count={compactViewport ? 28 : 52}
                maxX={compactViewport ? 8 : 17}
                maxY={compactViewport ? 10 : 9}
                gravity={0}
                driftSpeed={0.012}
                friction={0.983}
                wallBounce={0.95}
                colors={BALL_COLORS}
                followCursor={false}
                showCursorBall={false}
                controllerRef={memberBallpitControllerRef}
                onReady={() => setMemberBallpitReady(true)}
              />
            )}
          </div>
        </div>
      )}

      <div ref={flowRef} className={styles.flow}>
        <section ref={coverStageRef} className={`${styles.coverStage} ${memberHome ? styles.memberStage : ""}`}>
        {!memberHome && <section ref={heroRef} className={styles.hero} aria-labelledby="home-redesign-title">
          <div className={styles.heroCopy}>
            <p>CONTEXT READER</p>
            <h1 id="home-redesign-title">在语境里，<br />读懂英文。</h1>
            <p className={styles.heroSubtitle}>{HERO_SUBTITLES[heroSubtitleVariant]}</p>
            <button type="button" className={styles.coverAction} onClick={() => animateCoverSnap("recommendations")}>
              <span>精选外刊</span><i aria-hidden="true">↓</i>
            </button>
          </div>
          <div className={styles.heroEdge} aria-hidden="true"><span>SELECTED READING</span><i /></div>
        </section>}

        {!memberHome && <div className={styles.ballField} aria-hidden="true">
          <Ballpit
            className={styles.ballCanvas}
            count={compactViewport ? 32 : 56}
            gravity={0}
            driftSpeed={0.012}
            friction={0.983}
            wallBounce={0.95}
            colors={BALL_COLORS}
            materialParams={BALL_MATERIAL}
            collectiveCenterX={0.23}
            collectiveCenterY={-0.08}
            collectiveHalfWidth={0.69}
            collectiveHalfHeight={0.81}
            collectiveStrength={0.00025}
            thermalMotion={0.000076}
            followCursor={!compactViewport}
            showCursorBall={false}
            initialLayout="right"
            controllerRef={ballpitControllerRef}
            onReady={() => {
              const departureInput = Math.min(1, Math.max(0, (coverProgressRef.current - 0.04) / 0.96));
              ballpitControllerRef.current?.setDepartureProgress(
                departureInput * departureInput * (3 - 2 * departureInput),
              );
            }}
          />
        </div>}

        {!memberHome && <div className={styles.coverBreath} aria-hidden="true" />}

        {memberHome && (
          <section ref={importRef} className={styles.memberWorkbench} aria-label="阅读工作台">
            <div className={styles.memberWorkbenchGrid} data-empty={!hasReadingHistory || undefined}>
              {hasReadingHistory && (
                <button
                  type="button"
                  className={styles.continueReadingCard}
                  data-variant={continueVariant === "cover" && continueCover?.type === "image" && continueCover.src ? "cover" : "editorial"}
                  onClick={() => temporaryIsLatest && props.temporaryReading
                    ? props.onOpenTemporaryReading(props.temporaryReading)
                    : latestSavedArticle && props.onOpenSavedArticle(latestSavedArticle)}
                >
                  {continueVariant === "cover" && continueCover?.type === "image" && continueCover.src && (
                    <span className={styles.continueReadingCover} aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={continueCover.src} alt="" />
                    </span>
                  )}
                  <span className={styles.continueReadingEyebrow}>{temporaryIsLatest ? "继续阅读 · 未保存" : "继续阅读"}</span>
                  <strong>{temporaryIsLatest ? props.temporaryReading?.title : latestSavedArticle?.title}</strong>
                  <p>{temporaryIsLatest
                    ? props.temporaryReading?.body.slice(0, 150)
                    : latestSavedArticle?.summary || latestSavedArticle?.body.slice(0, 150)}</p>
                  <span className={styles.progressTrack} aria-label={`阅读进度 ${Math.round(continueProgress * 100)}%`}>
                    <i style={{ width: `${Math.max(3, Math.round(continueProgress * 100))}%` }} />
                  </span>
                  <span className={styles.continueReadingMeta}>{Math.round(continueProgress * 100)}% · 从上次位置继续 <i aria-hidden="true">→</i></span>
                </button>
              )}
              <div className={styles.memberImport}>
                <header>
                  <p>YOUR ARTICLE</p>
                  <h1>导入文章</h1>
                </header>
                {renderImportPanel(true)}
              </div>
            </div>
          </section>
        )}

        <section ref={recommendationsRef} className={styles.recommendations} aria-labelledby="selected-reading-title">
          <div className={styles.sectionHead}>
            <p>SELECTED READING</p>
            <h2 id="selected-reading-title">精选外刊</h2>
            <div className={styles.preferenceBar}>
              <div ref={preferenceControlRef} className={styles.preferenceControl} data-open={preferenceOpen || undefined}>
                <span className={styles.updateCadence}><i aria-hidden="true" />外刊会定期更新</span>
                <button
                  type="button"
                  className={styles.preferenceTrigger}
                  aria-expanded={preferenceOpen}
                  aria-haspopup="dialog"
                  onClick={() => preferenceOpen ? setPreferenceOpen(false) : openRecommendationPreferences()}
                >
                  <strong>个性化推荐</strong>
                  <span>{preferenceSummary}</span>
                </button>
                {preferenceOpen && (
                  <div className={styles.preferencePanel} role="dialog" aria-modal="false" aria-label="个性化推荐设置">
                    <header>
                      <div><strong>按你的阅读现场来选</strong><span>只调整“推荐”页，不影响外刊分类。</span></div>
                      <button type="button" aria-label="关闭个性化推荐设置" onClick={() => setPreferenceOpen(false)}>×</button>
                    </header>
                    <fieldset>
                      <legend>当前最接近的英语阅读水平</legend>
                      <div className={styles.preferenceChoices}>
                        {RECOMMENDATION_READING_LEVELS.map((level) => (
                          <button
                            type="button"
                            key={level}
                            aria-pressed={preferenceDraft.readingLevel === level}
                            onClick={() => setPreferenceDraft((current) => ({ ...current, readingLevel: level }))}
                          >{level}</button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>想多读一些什么</legend>
                      <div className={styles.preferenceChoices}>
                        {RECOMMENDATION_INTERESTS.map((interest) => (
                          <button
                            type="button"
                            key={interest.id}
                            aria-pressed={preferenceDraft.interests.includes(interest.id)}
                            onClick={() => toggleRecommendationInterest(interest.id)}
                          >{interest.label}</button>
                        ))}
                      </div>
                    </fieldset>
                    <footer>
                      <button type="button" onClick={clearRecommendationPreferences}>清除选择</button>
                      <button type="button" onClick={saveRecommendationPreferences}>保存并查看推荐</button>
                    </footer>
                  </div>
                )}
              </div>
            </div>
            <nav aria-label="外刊分类">
              {CATEGORY_FILTERS.map((item) => (
                <button
                  type="button"
                  key={item.label}
                  aria-pressed={activeCategory === item.label}
                  onClick={() => switchCategory(item.label)}
                >{item.label}</button>
              ))}
            </nav>
            {memberHome && memberLibraryOpen && (
              <div className={styles.libraryFilters} aria-label="筛选外刊">
                <label>
                  <span>搜索</span>
                  <input type="search" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="标题、来源或内容" />
                </label>
                <label>
                  <span>难度</span>
                  <select value={libraryDifficulty} onChange={(event) => setLibraryDifficulty(event.target.value as ArticleDifficulty | "")}>
                    <option value="">全部难度</option>
                    {ARTICLE_DIFFICULTIES.map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>

          {displayArticles.length ? (
            <div ref={articleGridRef} className={styles.articleGrid} data-switching={categorySwitching || undefined}>
              {displayArticles.map((item, index) => {
                const featured = index === 0;
                const recommendation = item.recommendation;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`${styles.articleCard} ${featured ? styles.featuredCard : ""}`}
                    style={{ "--article-index": index } as CSSProperties}
                    onPointerEnter={() => props.onPrefetchPublicArticle(item.id)}
                    onFocus={() => props.onPrefetchPublicArticle(item.id)}
                    onClick={(event) => beginArticleTransition(item, event)}
                    disabled={Boolean(props.openingPublicArticleId || openingArticle)}
                  >
                  <ArticleCover article={item} featured={featured} motion3dEnabled={recommendationMotionEnabled} />
                    <span className={styles.cardCopy}>
                      <small>{item.sourceName || "Context Reader"}</small>
                      <strong>{item.title}</strong>
                      <span className={styles.cardMeta}>
                        <i>{recommendation?.difficulty || "难度待定"}</i>
                        <i>{readingMinutes(item)} 分钟</i>
                      </span>
                      <b aria-hidden="true">↗</b>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyArticles}>这一分类的首页外刊正在整理中。</div>
          )}
          {memberHome && personalizedAllCategoryArticles.length > showcaseArticleCount && (
            <div className={styles.libraryAction}>
              <button type="button" onClick={() => setMemberLibraryOpen((current) => !current)} aria-expanded={memberLibraryOpen}>
                {memberLibraryOpen ? "收起更多外刊" : "显示更多"}
              </button>
              <span>{memberLibraryOpen ? `当前显示 ${displayArticles.length} 篇` : `还有 ${personalizedAllCategoryArticles.length - showcaseArticleCount} 篇`}</span>
            </div>
          )}
        </section>
        </section>

        {!memberHome && renderImportSection()}

        {!memberHome && <section className={styles.featureOrbit} aria-labelledby="feature-orbit-heading">
          <header>
            <div className={styles.orbitHeading}>
              <p>HOW IT STAYS WITH YOU</p>
              <h2 id="feature-orbit-heading">让一篇文章，真正读下去。</h2>
            </div>
            <div className={styles.orbitControlGroup}>
              <span className={styles.featureZoneLabel}>功能展示区</span>
              <div className={styles.orbitControls} aria-label="切换功能介绍">
                <button type="button" aria-label="上一个功能" onClick={() => setFeaturePosition((current) => current - 1)}>←</button>
                <button type="button" aria-label="下一个功能" onClick={() => setFeaturePosition((current) => current + 1)}>→</button>
              </div>
            </div>
          </header>
          <div
            className={styles.orbitStage}
            data-dragging={featureDragging || undefined}
            onPointerDown={startOrbitDrag}
            onPointerMove={moveOrbitDrag}
            onPointerUp={finishOrbitDrag}
            onPointerCancel={finishOrbitDrag}
          >
            {FEATURE_ORBIT.map((feature, index) => {
              const count = FEATURE_ORBIT.length;
              const half = count / 2;
              const offset = ((((index - featurePosition) + half) % count) + count) % count - half;
              const distance = Math.abs(offset);
              return (
                <button
                  type="button"
                  key={feature.key}
                  className={styles.orbitCard}
                  data-active={distance < 0.001 || undefined}
                  data-hidden={distance > 2.55 || undefined}
                  data-offset={offset}
                  style={{
                    "--orbit-z": `${distance * -150}px`,
                    "--orbit-rotate": `${offset * -11}deg`,
                    "--orbit-x": `${(offset * (compactViewport ? 250 : 300)).toFixed(2)}px`,
                    "--orbit-scale": Math.max(0.82, 1 - distance * 0.055),
                    "--orbit-opacity": Math.max(0, 1 - distance * 0.2),
                    zIndex: distance < 0.001 ? 120 : 100 - Math.round(distance * 12),
                  } as CSSProperties}
                  aria-label={`查看功能：${feature.title}`}
                  tabIndex={distance > 2 ? -1 : 0}
                  onClick={() => { if (!orbitSuppressClickRef.current) centerOrbitCard(index); }}
                >
                  <div className={styles.orbitVisual} data-kind={feature.key} aria-hidden="true">
                    <FeatureOrbitVisual kind={feature.key} />
                  </div>
                  <div className={styles.orbitCopy}>
                    <h3>{feature.title}</h3>
                    <p>{feature.copy}</p>
                    <span>{feature.meta}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className={styles.orbitDragHint} aria-hidden="true">
            <span>←</span><i><b /></i><strong>拖动浏览</strong><span>→</span>
          </div>
        </section>}

        <section className={styles.closingSection} aria-labelledby="closing-heading">
          <div className={styles.closingCopy}>
            <p>STAY IN TOUCH</p>
            <h2 id="closing-heading"><span>如果哪里还不够好，</span><span>告诉我。</span></h2>
            <div><span>Context Reader 仍在持续完善。</span><a href="/guide#updates">查看更新记录</a></div>
          </div>
          <div className={styles.closingActions}>
            <div className={styles.wechatContact}>
              <button type="button" onClick={() => void copyWechat()}>
                <small>微信</small><strong onPointerEnter={() => setWechatQrOpen(true)} onPointerLeave={() => setWechatQrOpen(false)}>{PUBLIC_CONTACT.wechat}</strong><span>{contactCopied ? "已复制" : "复制微信号"}</span>
              </button>
              <button
                type="button"
                className={styles.qrToggle}
                aria-expanded={wechatQrOpen}
                aria-controls="wechat-contact-qr"
                onClick={() => setWechatQrOpen((open) => !open)}
              >{wechatQrOpen ? "收起二维码" : "二维码"}</button>
              <div id="wechat-contact-qr" className={`${styles.wechatQr} ${wechatQrOpen ? styles.wechatQrOpen : ""}`} aria-hidden={!wechatQrOpen}>
                <div>
                  {/* Keep the original QR image byte-for-byte so scanning remains reliable. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={PUBLIC_CONTACT.wechatQrPath} alt="微信号 LA060321o 的添加好友二维码" />
                </div>
              </div>
            </div>
            <button type="button" onClick={() => setFeedbackOpen((open) => !open)} aria-expanded={feedbackOpen}>
              <small>Feedback</small><strong>意见反馈</strong><span>{feedbackOpen ? "收起表单" : "在这里展开"}</span>
            </button>
          </div>
          <div className={`${styles.inlineFeedback} ${feedbackOpen ? styles.inlineFeedbackOpen : ""}`} aria-hidden={!feedbackOpen}>
            <FeedbackPanel open={feedbackOpen} embedded onClose={() => setFeedbackOpen(false)} />
          </div>
          <footer className={styles.siteFooter}>
            <a href={PUBLIC_CONTACT.icpFiling.href} target="_blank" rel="noreferrer">{PUBLIC_CONTACT.icpFiling.label}</a>
            <a href={PUBLIC_CONTACT.publicSecurityFiling.href} target="_blank" rel="noreferrer">{PUBLIC_CONTACT.publicSecurityFiling.label}</a>
            <a href={`mailto:${PUBLIC_CONTACT.email}`}>{PUBLIC_CONTACT.email}</a>
            <a href="/guide">使用说明</a>
            <button type="button" onClick={() => setFeedbackOpen(true)}>意见反馈</button>
            <span>© {new Date().getFullYear()} Context Reader</span>
          </footer>
        </section>
      </div>

      {openingArticle && (
        <div
          className={`${styles.openingLayer} ${openingArticle.started ? styles.openingLayerActive : ""}`}
          style={{
            "--source-left": `${openingArticle.source.left}px`,
            "--source-top": `${openingArticle.source.top}px`,
            "--source-width": `${openingArticle.source.width}px`,
            "--source-height": `${openingArticle.source.height}px`,
          } as CSSProperties}
          aria-live="polite"
        >
          <div className={styles.openingWash} />
          <div className={styles.openingImage}>
            {openingArticle.article.recommendation?.coverImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={openingArticle.article.recommendation.coverImageUrl} alt="" />
            )}
          </div>
          <div className={styles.openingTitle}>
            <small>{openingArticle.article.sourceName}</small>
            <strong>{openingArticle.article.title}</strong>
          </div>
        </div>
      )}

      {dictionaryMounted && (
        <aside
          ref={dictionaryWindowRef}
          className={`${styles.dictionaryWindow} ${dictionaryClosing ? styles.dictionaryWindowClosing : ""}`}
          aria-label="单独查词窗口"
          onPointerUp={persistDictionaryWindow}
        >
          <header onPointerDown={startDictionaryDrag}>
            <span><QuickActionIcon kind="dictionary" />单独查词</span>
            <button type="button" aria-label="隐藏单独查词窗口" onClick={closeDictionary}>×</button>
          </header>
          <div className={styles.dictionaryWindowBody} data-local-scroll-surface>
            <BookDictionary embedded panel offline={isOffline} />
          </div>
        </aside>
      )}

      <HomeOptionMenu
        open={menuOpen}
        isAdmin={account.plan?.id === "admin"}
        account={account}
        isOffline={isOffline}
        localAccount={localAccount}
        savedArticles={hasLocalAccountAccess ? props.savedArticles : []}
        vocabularyEntries={hasLocalAccountAccess ? vocabularyEntries : []}
        initialPreview={menuInitialPreview}
        theme={homeTheme}
        letterMotionEnabled={letterMotionEnabled}
        recommendationMotionEnabled={recommendationMotionEnabled}
        onThemeChange={changeHomeTheme}
        onLetterMotionChange={changeLetterMotion}
        onRecommendationMotionChange={changeRecommendationMotion}
        onOpenImport={scrollToImport}
        onOpenDictionary={openDictionary}
        onClose={() => {
          setMenuOpen(false);
          setMenuInitialPreview(null);
        }}
        onOpenSavedArticle={props.onOpenSavedArticle}
        onJumpToVocabularySource={props.onJumpToVocabularySource}
        canJumpToVocabularySource={props.canJumpToVocabularySource}
      />
    </main>
  );
}
