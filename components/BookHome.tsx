"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { BookDictionary } from "@/components/BookDictionary";
import { BookLetterField } from "@/components/BookLetterField";
import { BookRecommendations } from "@/components/BookRecommendations";
import { CurvedPageTurn, type CurvedPageTurnHandle } from "@/components/CurvedPageTurn";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { HomeOptionMenu } from "@/components/HomeOptionMenu";
import { PillNavAction } from "@/components/PillNavAction";
import { VocabularyPanel } from "@/components/VocabularyPanel";
import { useAccount } from "@/components/AccountProvider";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { createExplanationCacheKey, getCachedExplanation, setCachedExplanation } from "@/lib/cache";
import {
  requestContextExplanation,
  requestContextExplanationStream,
} from "@/lib/contextExplanationClient";
import { downloadVocabularyCsv } from "@/lib/csv";
import { explanationAsStreamText, mergeStreamDisplayIntoExplanation } from "@/lib/explanationDisplay";
import { savedArticleOpenTimestamp } from "@/lib/savedArticleMerge";
import { tokenizeArticle } from "@/lib/tokenizer";
import {
  addVocabularyEntry,
  clearVocabularyEntries,
  createVocabularyEntry,
  deleteVocabularyEntry,
  getVocabularyEntries,
  vocabularyIdentity,
} from "@/lib/vocabulary";
import type { ImportedArticle, SavedArticle } from "@/types/article";
import type { ArticleAudienceStage, PublicArticle } from "@/types/publicArticle";
import type { ReaderToken, WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";
import styles from "./BookHome.module.css";

const Ballpit = dynamic(() => import("@/components/Ballpit"), { ssr: false });

const COVER_BALLPIT_COLORS = [
  0xffffff,
  0x171720,
  0x5227ff,
  0x2563eb,
  0x06b6d4,
  0x10b981,
  0xf59e0b,
  0xf43f5e,
];

const DEMO_HINT_KEY = "context-reader:book-demo-hint-seen:v1";
const RECOMMENDATION_PROFILE_KEY = "context-reader:recommendation-profile:v1";

type BookChapter = "foreword" | "workbench" | "recommendations";
type TurnDirection = "forward" | "backward";
type CoverState = "closed" | "opening" | "open" | "closing";

interface RecommendationProfile {
  level: ArticleAudienceStage | "all";
  pace: "轻松" | "适中" | "挑战" | "";
  interests: string[];
  complete: boolean;
}

const INITIAL_RECOMMENDATION_PROFILE: RecommendationProfile = {
  level: "all",
  pace: "",
  interests: [],
  complete: false,
};

const PROFILE_LEVELS: Array<{ value: ArticleAudienceStage; label: string; group: string }> = [
  { value: "小学", label: "小学", group: "18 岁以下" },
  { value: "初中", label: "初中", group: "18 岁以下" },
  { value: "高中", label: "高中", group: "18 岁以下" },
  { value: "CET-4", label: "四级", group: "成人与大学" },
  { value: "CET-6", label: "六级", group: "成人与大学" },
  { value: "考研", label: "考研", group: "成人与大学" },
  { value: "IELTS", label: "雅思", group: "考试路线" },
  { value: "TOEFL", label: "托福", group: "考试路线" },
];

const PROFILE_INTERESTS = ["科技", "自然", "文化", "社会", "成长", "故事"];
const DEMO_TITLE = "A Railway Takes Root";
const DEMO_PARAGRAPH_ONE =
  "On the edge of Rotterdam, an abandoned railway has taken root as a ribbon of gardens.";
const DEMO_PARAGRAPH_TWO =
  "What once divided neighborhoods now carries cyclists, bees, and small acts of everyday life across the city.";
const DEMO_TEXT = `${DEMO_PARAGRAPH_ONE}\n\n${DEMO_PARAGRAPH_TWO}`;

const DEMO_IMPORTED_ARTICLE: ImportedArticle = {
  title: DEMO_TITLE,
  url: "",
  siteName: "Context Reader sample",
  text: DEMO_TEXT,
  blocks: [
    { id: "book-demo-heading", type: "heading", text: DEMO_TITLE },
    { id: "book-demo-paragraph-one", type: "paragraph", text: DEMO_PARAGRAPH_ONE },
    { id: "book-demo-paragraph-two", type: "paragraph", text: DEMO_PARAGRAPH_TWO },
  ],
};

const DEMO_PARAGRAPHS = tokenizeArticle(DEMO_TEXT);
const DEMO_WORD_TOKENS = DEMO_PARAGRAPHS.flatMap((paragraph) =>
  paragraph.tokens.filter((token): token is ReaderToken => token.type === "word"),
);
const INITIAL_TOKENS = DEMO_WORD_TOKENS.filter((token) =>
  ["taken", "root"].includes(token.value.toLowerCase()),
);
const INITIAL_CONTEXT: WordContext = {
  word: "taken root",
  paragraphIndex: INITIAL_TOKENS[0]?.paragraphIndex ?? 0,
  tokenIndex: INITIAL_TOKENS[0]?.tokenIndex ?? 0,
  sentence: INITIAL_TOKENS[0]?.sentence ?? DEMO_PARAGRAPH_ONE,
  previousSentence: INITIAL_TOKENS[0]?.previousSentence ?? "",
  nextSentence: INITIAL_TOKENS[0]?.nextSentence ?? DEMO_PARAGRAPH_TWO,
};

const INITIAL_EXPLANATION: WordExplanation = {
  word: "taken root",
  lemma: "take root",
  phonetic: "take /teɪk/ · root /ruːt/",
  partOfSpeech: "短语",
  basicMeaning: "生根；开始稳固生长或建立",
  contextMeaning: "废弃铁路被重新利用，并逐渐成为城市里稳定存在的花园空间",
  sentenceTranslation: "在鹿特丹边缘，一条废弃铁路已经扎根成一条带状花园。",
  usageNote: "这里把植物生根的画面借给城市更新，强调这个变化不是临时装饰，而是开始融入当地生活。",
  collocation: "take root in a community（在社区扎根）；ideas take root（观念逐渐形成）",
  exampleEnglish: "The project took root after residents began caring for the site.",
  exampleChinese: "居民开始照料这片场地后，这个项目逐渐扎下了根。",
  difficulty: "medium",
  shouldAddToVocabulary: true,
  anki: {
    canMakeCloze: true,
    cardMode: "cloze_context",
    clozeSentence: "An abandoned railway has {{c1::taken root}} as a ribbon of gardens.",
    contextCue: "逐渐扎根并成为稳定存在的空间",
    basicCue: "生根；建立",
    frontPreview: "An abandoned railway has [...] as a ribbon of gardens.",
    backPreview: "taken root · 生根；逐渐建立",
  },
};

interface BookHomeProps {
  article: string;
  articleUrl: string;
  error: string;
  urlError: string;
  importingUrl: boolean;
  openingPublicArticleId: string;
  publicArticles: PublicArticle[];
  savedArticles: SavedArticle[];
  readerTransitioning: boolean;
  onArticleChange: (article: string) => void;
  onArticleUrlChange: (url: string) => void;
  onStartReading: () => void;
  onImportUrl: () => void;
  onOpenDemoArticle: (article: ImportedArticle) => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onOpenPublicArticle: (id: string) => Promise<void>;
  onPrefetchPublicArticle: (id: string) => void;
  onDeleteSavedArticle: (id: string) => void;
  onJumpToVocabularySource: (entry: VocabularyEntry) => void;
  canJumpToVocabularySource: (entry: VocabularyEntry) => boolean;
}

interface DemoDrag {
  pointerId: number;
  target: HTMLButtonElement;
  startTokenId: string;
  currentTokenId: string;
  startX: number;
  startY: number;
  horizontal: boolean;
  cancelled: boolean;
}

function entryCopyText(entry: VocabularyEntry): string {
  const contextMeaningLabel = entry.word.trim().split(/\s+/).length > 1
    ? "所选短语在本句中的含义"
    : "所选词在本句中的含义";
  return [
    `${entry.word} (${entry.lemma})`,
    entry.phonetic ? `音标：${entry.phonetic}` : "",
    `词性：${entry.partOfSpeech}`,
    `基础释义：${entry.basicMeaning}`,
    `${contextMeaningLabel}：${entry.contextMeaning}`,
    `原句：${entry.sourceSentence}`,
    `自然翻译：${entry.sentenceTranslation}`,
    `用法说明：${entry.usageNote}`,
    entry.collocation ? `常见搭配：${entry.collocation}` : "",
    `例句：${entry.exampleEnglish}`,
    `例句翻译：${entry.exampleChinese}`,
  ].filter(Boolean).join("\n");
}

function savedArticlePreview(article: SavedArticle): string {
  return article.summary?.trim() || article.body.trim().replace(/\s+/g, " ").slice(0, 88);
}

function formatSavedDate(article: SavedArticle): string {
  const timestamp = savedArticleOpenTimestamp(article);
  if (!timestamp) return "尚未记录时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function BookHome({
  article,
  articleUrl,
  error,
  urlError,
  importingUrl,
  openingPublicArticleId,
  publicArticles,
  savedArticles,
  readerTransitioning,
  onArticleChange,
  onArticleUrlChange,
  onStartReading,
  onImportUrl,
  onOpenDemoArticle,
  onOpenSavedArticle,
  onOpenPublicArticle,
  onPrefetchPublicArticle,
  onDeleteSavedArticle,
  onJumpToVocabularySource,
  canJumpToVocabularySource,
}: BookHomeProps) {
  const { account, openLogin, requireAccount, refreshAccount } = useAccount();
  const [coverState, setCoverState] = useState<CoverState>("closed");
  const [chapter, setChapter] = useState<BookChapter>("foreword");
  const [turning, setTurning] = useState(false);
  const [turnDirection, setTurnDirection] = useState<TurnDirection>("forward");
  const [mobileWorkbenchPage, setMobileWorkbenchPage] = useState<"demo" | "desk">("demo");
  const [recommendationProfile, setRecommendationProfile] = useState<RecommendationProfile>(INITIAL_RECOMMENDATION_PROFILE);
  const [recommendationDraft, setRecommendationDraft] = useState<RecommendationProfile>(INITIAL_RECOMMENDATION_PROFILE);
  const [recommendationDialogOpen, setRecommendationDialogOpen] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const [inputMode, setInputMode] = useState<"paste" | "url" | "dictionary">("dictionary");
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  const [vocabularyEntries, setVocabularyEntries] = useState<VocabularyEntry[]>([]);
  const [vocabularyError, setVocabularyError] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>(() => INITIAL_TOKENS.map((token) => token.id));
  const [selectedContext, setSelectedContext] = useState<WordContext>(INITIAL_CONTEXT);
  const [explanation, setExplanation] = useState<WordExplanation | null>(INITIAL_EXPLANATION);
  const [explanationStreamText, setExplanationStreamText] = useState(() => explanationAsStreamText(INITIAL_EXPLANATION));
  const [explanationStreaming, setExplanationStreaming] = useState(false);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState("");
  const storyRef = useRef<HTMLElement | null>(null);
  const workbenchRef = useRef<HTMLElement | null>(null);
  const pageTurnRef = useRef<CurvedPageTurnHandle | null>(null);
  const spreadRefs = useRef<Record<BookChapter, HTMLElement | null>>({
    foreword: null,
    workbench: null,
    recommendations: null,
  });
  const chapterRef = useRef<BookChapter>("foreword");
  const turningRef = useRef(false);
  const queuedChapterRef = useRef<BookChapter | null>(null);
  const turnTimersRef = useRef<number[]>([]);
  const scrollFrameRef = useRef<number | null>(null);
  const dragRef = useRef<DemoDrag | null>(null);
  const suppressClickRef = useRef(false);
  const explanationAbortRef = useRef<AbortController | null>(null);

  const tokenById = useMemo(
    () => new Map(DEMO_WORD_TOKENS.map((token) => [token.id, token])),
    [],
  );
  const sortedSavedArticles = useMemo(
    () => [...savedArticles].sort((left, right) => savedArticleOpenTimestamp(right) - savedArticleOpenTimestamp(left)),
    [savedArticles],
  );
  const latestSavedArticle = sortedSavedArticles[0] ?? null;
  const selectedVocabularyIdentity = vocabularyIdentity({
    word: explanation?.word ?? selectedContext.word,
    sourceSentence: selectedContext.sentence,
  });
  const isInVocabulary = Boolean(explanation) && vocabularyEntries.some(
    (entry) => vocabularyIdentity(entry) === selectedVocabularyIdentity,
  );

  useEffect(() => {
    setClientReady(true);
    setShowHint(window.localStorage.getItem(DEMO_HINT_KEY) !== "1");
    try {
      const storedProfile = window.localStorage.getItem(RECOMMENDATION_PROFILE_KEY);
      if (storedProfile) {
        const parsed = JSON.parse(storedProfile) as Partial<RecommendationProfile>;
        setRecommendationProfile({
          level: parsed.level ?? "all",
          pace: parsed.pace ?? "",
          interests: Array.isArray(parsed.interests) ? parsed.interests : [],
          complete: Boolean(parsed.complete),
        });
      }
    } catch {
      // A malformed optional preference must not block the reading entry.
    }
    const refreshVocabularyEntries = () => setVocabularyEntries(getVocabularyEntries());
    refreshVocabularyEntries();
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabularyEntries);
    return () => {
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabularyEntries);
      turnTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const locked = menuOpen || vocabularyOpen || feedbackOpen || recommendationDialogOpen;
    document.documentElement.classList.toggle("cr-overlay-locked", locked);
    document.body.classList.toggle("cr-overlay-locked", locked);
    return () => {
      document.documentElement.classList.remove("cr-overlay-locked");
      document.body.classList.remove("cr-overlay-locked");
    };
  }, [feedbackOpen, menuOpen, recommendationDialogOpen, vocabularyOpen]);

  useEffect(() => {
    if (!menuOpen && !recommendationDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setRecommendationDialogOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen, recommendationDialogOpen]);

  useEffect(() => {
    chapterRef.current = chapter;
  }, [chapter]);

  const beginTurn = useCallback(function performTurn(nextChapter: BookChapter, direction: TurnDirection = "forward") {
    if (nextChapter === chapterRef.current && !turningRef.current) return;
    if (turningRef.current) {
      queuedChapterRef.current = nextChapter;
      return;
    }

    turningRef.current = true;
    const activeDrag = dragRef.current;
    if (activeDrag) {
      if (activeDrag.target.hasPointerCapture(activeDrag.pointerId)) {
        activeDrag.target.releasePointerCapture(activeDrag.pointerId);
      }
      dragRef.current = null;
    }
    setTurning(true);
    setTurnDirection(direction);
    window.requestAnimationFrame(() => {
      pageTurnRef.current?.flip(
        direction,
        spreadRefs.current[chapterRef.current],
        spreadRefs.current[nextChapter],
      );
    });

    const swapTimer = window.setTimeout(() => {
      chapterRef.current = nextChapter;
      setChapter(nextChapter);
      window.dispatchEvent(new Event("context-reader:book-layout-change"));
    }, 360);
    const settleTimer = window.setTimeout(() => {
      turningRef.current = false;
      setTurning(false);
      const queued = queuedChapterRef.current;
      queuedChapterRef.current = null;
      if (queued && queued !== chapterRef.current) {
        const ranks: Record<BookChapter, number> = { foreword: 0, workbench: 1, recommendations: 2 };
        performTurn(queued, ranks[queued] >= ranks[chapterRef.current] ? "forward" : "backward");
      }
      window.dispatchEvent(new Event("context-reader:book-layout-change"));
    }, 790);
    turnTimersRef.current.push(swapTimer, settleTimer);
  }, []);

  const scrollStoryTo = useCallback((progress: number, behavior: ScrollBehavior = "smooth") => {
    const story = storyRef.current;
    if (!story) return;
    const top = story.getBoundingClientRect().top + window.scrollY;
    const distance = Math.max(0, story.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top + distance * progress, behavior });
  }, []);

  const openBook = useCallback((afterOpen?: () => void) => {
    if (coverState !== "closed") {
      if (coverState === "open") afterOpen?.();
      return;
    }
    chapterRef.current = "foreword";
    setChapter("foreword");
    setCoverState("opening");
    const openTimer = window.setTimeout(() => {
      setCoverState("open");
      afterOpen?.();
    }, 2080);
    turnTimersRef.current.push(openTimer);
  }, [coverState]);

  const closeBook = useCallback(() => {
    if (coverState !== "open" || turningRef.current) return;
    setCoverState("closing");
    scrollStoryTo(0, "smooth");
    const closeTimer = window.setTimeout(() => {
      chapterRef.current = "foreword";
      setChapter("foreword");
      setCoverState("closed");
      window.dispatchEvent(new Event("context-reader:book-layout-change"));
    }, 1920);
    turnTimersRef.current.push(closeTimer);
  }, [coverState, scrollStoryTo]);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (menuOpen || vocabularyOpen || feedbackOpen || recommendationDialogOpen || readerTransitioning) return;
      if (Math.abs(event.deltaY) < 18) return;
      const story = storyRef.current;
      if (!story) return;
      const storyTop = story.getBoundingClientRect().top + window.scrollY;

      if (coverState === "closed" && event.deltaY > 0) {
        event.preventDefault();
        openBook();
        return;
      }

      if (coverState === "opening" || coverState === "closing") {
        event.preventDefault();
        return;
      }

      if (
        coverState === "open" &&
        chapterRef.current === "foreword" &&
        event.deltaY < 0 &&
        window.scrollY <= storyTop + 8
      ) {
        event.preventDefault();
        closeBook();
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [
    closeBook,
    coverState,
    feedbackOpen,
    menuOpen,
    openBook,
    readerTransitioning,
    recommendationDialogOpen,
    vocabularyOpen,
  ]);

  useEffect(() => {
    if (coverState !== "open") return;
    const story = storyRef.current;
    if (!story) return;

    const updateFromScroll = () => {
      scrollFrameRef.current = null;
      const storyTop = story.getBoundingClientRect().top + window.scrollY;
      const distance = Math.max(1, story.offsetHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, (window.scrollY - storyTop) / distance));
      let desired: BookChapter = "foreword";
      if (progress >= 0.28) desired = "workbench";
      if (progress >= 0.68) desired = "recommendations";
      if (turningRef.current) {
        queuedChapterRef.current = desired;
        return;
      }
      if (desired === chapterRef.current) return;
      const ranks: Record<BookChapter, number> = { foreword: 0, workbench: 1, recommendations: 2 };
      beginTurn(desired, ranks[desired] >= ranks[chapterRef.current] ? "forward" : "backward");
    };

    const onScroll = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(updateFromScroll);
    };
    updateFromScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [beginTurn, coverState]);

  useEffect(() => () => explanationAbortRef.current?.abort(), []);

  function rangeFromTokenIds(startTokenId: string, endTokenId: string): ReaderToken[] {
    const start = tokenById.get(startTokenId);
    const end = tokenById.get(endTokenId);
    if (!start || !end || start.paragraphIndex !== end.paragraphIndex) return end ? [end] : [];

    const firstIndex = Math.min(start.tokenIndex, end.tokenIndex);
    const lastIndex = Math.max(start.tokenIndex, end.tokenIndex);
    return DEMO_WORD_TOKENS.filter(
      (token) =>
        token.paragraphIndex === start.paragraphIndex &&
        token.tokenIndex >= firstIndex &&
        token.tokenIndex <= lastIndex,
    );
  }

  function contextFromTokens(tokens: ReaderToken[]): WordContext {
    const first = tokens[0];
    return {
      word: tokens.map((token) => token.value).join(" "),
      paragraphIndex: first.paragraphIndex,
      tokenIndex: first.tokenIndex,
      sentence: first.sentence,
      previousSentence: first.previousSentence,
      nextSentence: first.nextSentence,
    };
  }

  function markDemoHintSeen() {
    if (!showHint) return;
    setShowHint(false);
    window.localStorage.setItem(DEMO_HINT_KEY, "1");
  }

  const explainTokens = useCallback(async (tokens: ReaderToken[], force = false) => {
    if (!tokens.length) return;
    if (tokens.length > 8) {
      setExplanationError("一次请选择 1–8 个连续英文单词。");
      return;
    }

    markDemoHintSeen();
    const context = contextFromTokens(tokens);
    const tokenIds = tokens.map((token) => token.id);
    const cacheKey = createExplanationCacheKey(context.word, context.sentence);
    setSelectedTokenIds(tokenIds);
    setSelectedContext(context);
    setExplanationError("");

    explanationAbortRef.current?.abort();
    const cached = force ? null : getCachedExplanation(cacheKey);
    if (cached) {
      if (!account.authenticated) {
        const cachedUsageResponse = await fetch("/api/usage/cache-lookup", {
          method: "POST",
          headers: { "x-context-action-id": crypto.randomUUID() },
        });
        const cachedUsage = await cachedUsageResponse.json().catch(() => null) as { error?: string } | null;
        if (!cachedUsageResponse.ok) {
          setExplanationError(cachedUsage?.error || "游客试用额度记录失败，请登录后继续。");
          openLogin("游客每天可试用 10 次划词解释；登录后可继续阅读并同步学习数据。");
          return;
        }
      }
      setExplanation(cached);
      setExplanationStreamText(explanationAsStreamText(cached));
      setExplanationStreaming(false);
      setExplanationLoading(false);
      void refreshAccount();
      return;
    }

    const controller = new AbortController();
    const actionId = crypto.randomUUID();
    explanationAbortRef.current = controller;
    setExplanationLoading(true);
    setExplanation(null);
    setExplanationStreamText("");
    setExplanationStreaming(true);

    const streamPromise = requestContextExplanationStream(
      context,
      controller.signal,
      (chunk) => {
        if (!controller.signal.aborted) {
          setExplanationStreamText((current) => `${current}${chunk}`);
        }
      },
      actionId,
    ).catch(() => "");

    try {
      const [structuredExplanation, completedStreamText] = await Promise.all([
        requestContextExplanation(context, controller.signal, actionId),
        streamPromise,
      ]);
      const nextExplanation = completedStreamText
        ? mergeStreamDisplayIntoExplanation(structuredExplanation, completedStreamText)
        : structuredExplanation;
      setCachedExplanation(cacheKey, nextExplanation);
      setExplanation(nextExplanation);
      setExplanationStreamText(completedStreamText || explanationAsStreamText(nextExplanation));
      setExplanationStreaming(false);
      void refreshAccount();
    } catch (requestError) {
      if (controller.signal.aborted) return;
      const message = requestError instanceof Error ? requestError.message : "解释失败，请稍后重试。";
      setExplanationError(message);
      if (!account.authenticated && /登录|游客|额度/.test(message)) {
        openLogin("游客试用额度已用完，登录后可继续查词并跨设备同步学习数据。");
      }
    } finally {
      if (!controller.signal.aborted) {
        setExplanationLoading(false);
        setExplanationStreaming(false);
      }
    }
  }, [account.authenticated, openLogin, refreshAccount, showHint, tokenById]);

  function handleTokenPointerDown(event: ReactPointerEvent<HTMLButtonElement>, tokenId: string) {
    dragRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startTokenId: tokenId,
      currentTokenId: tokenId,
      startX: event.clientX,
      startY: event.clientY,
      horizontal: false,
      cancelled: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTokenPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      drag.cancelled = true;
      return;
    }
    if (Math.abs(deltaX) < 10) return;

    drag.horizontal = true;
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-demo-token]");
    const tokenId = hit?.dataset.demoToken;
    if (!tokenId || !tokenById.has(tokenId)) return;
    drag.currentTokenId = tokenId;
    const range = rangeFromTokenIds(drag.startTokenId, tokenId);
    if (range.length && range.length <= 8) setSelectedTokenIds(range.map((token) => token.id));
  }

  function handleTokenPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.horizontal || drag.cancelled) return;

    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    const range = rangeFromTokenIds(drag.startTokenId, drag.currentTokenId);
    void explainTokens(range);
  }

  function handleTokenPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
  }

  function handleTokenClick(token: ReaderToken) {
    if (suppressClickRef.current) return;
    void explainTokens([token]);
  }

  function handleOpenVocabulary() {
    if (!requireAccount("登录后才能使用生词本；登录时会把本机已有词条补充到账号中。")) return;
    setMenuOpen(false);
    setVocabularyEntries(getVocabularyEntries());
    setVocabularyError("");
    setVocabularyOpen(true);
  }

  function handleAddToVocabulary() {
    if (!requireAccount("登录后才能把词条加入生词本并跨设备同步。")) return;
    if (!explanation || !selectedContext) return;
    setVocabularyEntries(addVocabularyEntry(createVocabularyEntry(explanation, selectedContext)));
  }

  function handleClearVocabulary() {
    if (!window.confirm(`将删除生词本中的 ${vocabularyEntries.length} 条词条，此操作无法撤销。\n\n确定要清空生词本吗？`)) return;
    clearVocabularyEntries();
    setVocabularyEntries([]);
  }

  async function handleCopyVocabularyEntry(entry: VocabularyEntry) {
    try {
      await navigator.clipboard.writeText(entryCopyText(entry));
    } catch {
      setVocabularyError("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  function scrollToWorkbench() {
    setMenuOpen(false);
    const showWorkbench = () => {
      const direction: TurnDirection = chapterRef.current === "recommendations" ? "backward" : "forward";
      beginTurn("workbench", direction);
      setMobileWorkbenchPage("demo");
      scrollStoryTo(.42);
      window.setTimeout(() => workbenchRef.current?.focus({ preventScroll: true }), 900);
    };
    openBook(showWorkbench);
  }

  function scrollToForeword() {
    setMenuOpen(false);
    openBook(() => {
      beginTurn("foreword", "backward");
      scrollStoryTo(0);
    });
  }

  function scrollToCover() {
    setMenuOpen(false);
    if (coverState === "closed") {
      scrollStoryTo(0);
      return;
    }
    if (coverState !== "open") return;
    scrollStoryTo(0);
    if (chapterRef.current === "foreword") {
      closeBook();
      return;
    }
    beginTurn("foreword", "backward");
    const closeTimer = window.setTimeout(closeBook, 820);
    turnTimersRef.current.push(closeTimer);
  }

  function scrollToRecommendations() {
    setMenuOpen(false);
    openBook(() => {
      beginTurn("recommendations", "forward");
      scrollStoryTo(.82);
    });
  }

  function updateProfile(next: RecommendationProfile) {
    setRecommendationProfile(next);
    window.localStorage.setItem(RECOMMENDATION_PROFILE_KEY, JSON.stringify(next));
  }

  function openRecommendationDialog() {
    setRecommendationDraft(recommendationProfile);
    setRecommendationDialogOpen(true);
  }

  function toggleDraftInterest(interest: string) {
    setRecommendationDraft((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((item) => item !== interest)
        : [...current.interests, interest],
    }));
  }

  function applyRecommendationProfile() {
    const next = { ...recommendationDraft, complete: true };
    updateProfile(next);
    setRecommendationDialogOpen(false);
  }

  function resetRecommendationProfile() {
    updateProfile(INITIAL_RECOMMENDATION_PROFILE);
    setRecommendationDraft(INITIAL_RECOMMENDATION_PROFILE);
    setRecommendationDialogOpen(false);
  }

  return (
    <main className={`${styles.root} ${readerTransitioning ? styles.readerEntering : ""}`}>
      <BookLetterField paused={readerTransitioning} />
      <div className={styles.ambient} aria-hidden="true">
        <span>context</span>
        <span>meaning</span>
        <span>read</span>
      </div>

      <header className={styles.topbar}>
        <PillNavAction
          className={styles.brand}
          href="/home-v2"
          label="Context Reader"
          ariaLabel="Context Reader 书本主页"
        />
        <div className={styles.topActions}>
          <PillNavAction
            className={styles.textAction}
            label="开始阅读"
            onClick={scrollToWorkbench}
          />
          <PillNavAction
            className={styles.menuButton}
            tone="dark"
            label="Menu"
            ariaExpanded={menuOpen}
            ariaControls="book-home-menu"
            onClick={() => setMenuOpen(true)}
            renderIcon={() => (
              <span className={styles.menuGlyph} aria-hidden="true"><i /><i /></span>
            )}
          />
        </div>
      </header>

      <section
        ref={storyRef}
        className={`${styles.story} ${styles[`cover${coverState[0].toUpperCase()}${coverState.slice(1)}`]}`}
        data-book-cover-state={coverState}
        data-chapter={chapter}
        aria-label="Context Reader 连续书本空间"
      >
        <div className={styles.stickyStage}>
          <div className={styles.bookShell}>
            <div className={styles.book}>
              <div
                ref={(element) => { spreadRefs.current.foreword = element; }}
                data-book-spread="foreword"
                className={`${styles.forewordSpread} ${styles.spreadLayer} ${chapter === "foreword" ? styles.spreadActive : styles.spreadInactive}`}
                aria-hidden={chapter !== "foreword"}
                inert={chapter !== "foreword"}
              >
                <section className={`${styles.page} ${styles.leftPage} ${styles.forewordBlank}`} aria-hidden="true" />
                <div className={styles.spine} aria-hidden="true"><i /></div>
                <section className={`${styles.page} ${styles.rightPage} ${styles.forewordPage}`} aria-labelledby="book-foreword-heading">
                  <div className={styles.pageNumber}>Foreword · 01</div>
                  <p className={styles.sectionLabel}>开发者的话</p>
                  <h1 id="book-foreword-heading">写给正在翻开这本书的人</h1>
                  <div className={styles.forewordCopy}>
                    <p>我做 Context Reader，是因为查懂一个词，常常还不等于读懂一句话。</p>
                    <p>我希望这里能保留你正在阅读的上下文，让查词、理解和继续读下去发生在同一页里。你可以从一篇真正想读的文章开始，遇到陌生表达时停一下，再继续往前。</p>
                    <p>愿这本书帮你少一些被打断的时刻，多读完几篇原本想放弃的文章。</p>
                  </div>
                  <div className={styles.developerSignature}>
                    <span>Context Reader 开发者</span>
                    <strong>欧阳子浩</strong>
                  </div>
                </section>
              </div>

              <div
                ref={(element) => { spreadRefs.current.workbench = element; }}
                data-book-spread="workbench"
                data-mobile-page={mobileWorkbenchPage}
                className={`${styles.workbenchSpread} ${styles.spreadLayer} ${chapter === "workbench" ? styles.spreadActive : styles.spreadInactive}`}
                aria-hidden={chapter !== "workbench"}
                inert={chapter !== "workbench"}
              >
                  <section className={`${styles.page} ${styles.leftPage}`} aria-labelledby="book-demo-heading">
              <div className={styles.pageNumber}>Reading · 02</div>
              <div className={styles.demoHeader}>
                <div>
                  <p className={styles.sectionLabel}>真实划词体验</p>
                  <h1 id="book-demo-heading">不止一个词，也划过一段表达</h1>
                </div>
                <span className={styles.demoStatus}>可交互</span>
              </div>

              <article className={styles.demoArticle} aria-label="可划词的英文短文" data-pointer-mask>
                <h2>{DEMO_TITLE}</h2>
                {DEMO_PARAGRAPHS.map((paragraph) => (
                  <p key={paragraph.id}>
                    {paragraph.tokens.map((token) => token.type === "word" ? (
                      <button
                        key={token.id}
                        type="button"
                        className={selectedTokenIds.includes(token.id) ? styles.selectedWord : styles.word}
                        data-demo-token={token.id}
                        aria-pressed={selectedTokenIds.includes(token.id)}
                        onPointerDown={(event) => handleTokenPointerDown(event, token.id)}
                        onPointerMove={handleTokenPointerMove}
                        onPointerUp={handleTokenPointerUp}
                        onPointerCancel={handleTokenPointerCancel}
                        onClick={() => handleTokenClick(token)}
                      >
                        {token.value}
                      </button>
                    ) : <span key={token.id}>{token.value}</span>)}
                  </p>
                ))}
              </article>

              <div className={styles.demoInstruction} aria-live="polite">
                {showHint ? (
                  <span><i aria-hidden="true" />点一个词，或从左向右划过 2–8 个词</span>
                ) : (
                  <span>当前选择：<strong>{selectedContext.word}</strong></span>
                )}
                <button type="button" onClick={() => onOpenDemoArticle(DEMO_IMPORTED_ARTICLE)}>在阅读器中继续</button>
              </div>

              <div className={styles.explanationShell} data-pointer-mask>
                {clientReady ? (
                  <ExplanationPanel
                    explanation={explanation}
                    streamText={explanationStreamText}
                    streaming={explanationStreaming}
                    selectedContext={selectedContext}
                    loading={explanationLoading}
                    error={explanationError}
                    isInVocabulary={isInVocabulary}
                    showLearningActions={false}
                    onAddToVocabulary={handleAddToVocabulary}
                    onRegenerate={() => {
                      const tokens = selectedTokenIds.map((id) => tokenById.get(id)).filter((token): token is ReaderToken => Boolean(token));
                      void explainTokens(tokens, true);
                    }}
                  />
                ) : (
                  <div className={styles.explanationPlaceholder}>正在准备语境解释…</div>
                )}
              </div>

              <button className={styles.mobileNextPage} type="button" onClick={() => setMobileWorkbenchPage("desk")}>
                下一页：单独查词 <span aria-hidden="true">↓</span>
              </button>
                  </section>

                  <div className={styles.spine} aria-hidden="true"><i /></div>

                  <section ref={workbenchRef} tabIndex={-1} className={`${styles.page} ${styles.rightPage}`} aria-labelledby="book-workbench-heading">
              <div className={styles.pageNumber}>Dictionary · 02</div>
              <div className={styles.workbenchHeader}>
                <p className={styles.sectionLabel}>{inputMode === "dictionary" ? "独立查词" : "阅读起点"}</p>
                <h2 id="book-workbench-heading">
                  {inputMode === "dictionary" ? "单独查一个词或短语。" : "从你想读的内容开始。"}
                </h2>
                <p>
                  {inputMode === "dictionary"
                    ? "没有原句也可以深度查询；粘贴文章和网址导入仍保留在同一页。"
                    : "粘贴文章或输入公开网址，直接进入阅读器。"}
                </p>
              </div>

              {latestSavedArticle && (
                <button
                  className={styles.continueReading}
                  type="button"
                  onClick={() => onOpenSavedArticle(latestSavedArticle)}
                  disabled={readerTransitioning}
                >
                  <span className={styles.continueMarker} aria-hidden="true">↗</span>
                  <span>
                    <small>继续上次阅读</small>
                    <strong>{latestSavedArticle.title || "未命名文章"}</strong>
                    <em>{savedArticlePreview(latestSavedArticle)}</em>
                  </span>
                  <time>{formatSavedDate(latestSavedArticle)}</time>
                </button>
              )}

              <div className={styles.inputModes} role="tablist" aria-label="选择阅读或查词方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={inputMode === "dictionary"}
                  className={inputMode === "dictionary" ? styles.activeMode : ""}
                  onClick={() => setInputMode("dictionary")}
                >单独查词</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inputMode === "paste"}
                  className={inputMode === "paste" ? styles.activeMode : ""}
                  onClick={() => setInputMode("paste")}
                >粘贴文章</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inputMode === "url"}
                  className={inputMode === "url" ? styles.activeMode : ""}
                  onClick={() => setInputMode("url")}
                >输入网址</button>
              </div>

              {inputMode === "paste" ? (
                <form className={styles.articleForm} onSubmit={(event) => { event.preventDefault(); onStartReading(); }}>
                  <label htmlFor="book-home-article">英文文章</label>
                  <textarea
                    id="book-home-article"
                    value={article}
                    onChange={(event) => onArticleChange(event.target.value)}
                    placeholder="Paste an English article here…"
                    maxLength={120000}
                  />
                  <div className={styles.formFooter}>
                    <span>{article.trim() ? `${article.trim().split(/\s+/).length} 词` : "支持短文与长文章"}</span>
                    <button type="submit" disabled={!article.trim() || readerTransitioning}>打开文章</button>
                  </div>
                  {error && <p className={styles.formError} role="alert">{error}</p>}
                </form>
              ) : inputMode === "url" ? (
                <form className={styles.urlForm} onSubmit={(event) => { event.preventDefault(); onImportUrl(); }}>
                  <label htmlFor="book-home-url">公开文章网址</label>
                  <div>
                    <input
                      id="book-home-url"
                      type="url"
                      inputMode="url"
                      value={articleUrl}
                      onChange={(event) => onArticleUrlChange(event.target.value)}
                      placeholder="https://example.com/article"
                      autoComplete="url"
                    />
                    <button type="submit" disabled={!articleUrl.trim() || importingUrl || readerTransitioning}>
                      {importingUrl ? "正在读取…" : "读取网址"}
                    </button>
                  </div>
                  <p>会保留可读取的正文结构和原文配图；部分网站可能限制抓取。</p>
                  {urlError && <p className={styles.formError} role="alert">{urlError}</p>}
                </form>
              ) : (
                <BookDictionary compact />
              )}

              <div className={styles.workbenchFoot}>
                <button type="button" onClick={() => onOpenDemoArticle(DEMO_IMPORTED_ARTICLE)}>先用左页示例阅读</button>
              </div>
                  </section>
              </div>

              <div
                ref={(element) => { spreadRefs.current.recommendations = element; }}
                data-book-spread="recommendations"
                className={`${styles.recommendationSpread} ${styles.spreadLayer} ${chapter === "recommendations" ? styles.spreadActive : styles.spreadInactive}`}
                aria-hidden={chapter !== "recommendations"}
                inert={chapter !== "recommendations"}
              >
                <BookRecommendations
                  embedded
                  articles={publicArticles}
                  openingPublicArticleId={openingPublicArticleId}
                  readerTransitioning={readerTransitioning}
                  preferredLevel={recommendationProfile.level}
                  preferredPace={recommendationProfile.pace}
                  preferredInterests={recommendationProfile.interests}
                  personalized={recommendationProfile.complete}
                  onPersonalize={openRecommendationDialog}
                  onOpenArticle={onOpenPublicArticle}
                  onPrefetchArticle={onPrefetchPublicArticle}
                />
                <div className={`${styles.spine} ${styles.recommendationSpine}`} aria-hidden="true"><i /></div>
              </div>

              <CurvedPageTurn ref={pageTurnRef} active={turning} direction={turnDirection} />

              <button
                  type="button"
                  className={styles.coverAssembly}
                  data-pointer-live
                  onClick={() => openBook()}
                  disabled={coverState !== "closed"}
                  tabIndex={coverState === "open" ? -1 : 0}
                  aria-hidden={coverState === "open"}
                  aria-label={
                    coverState === "closed"
                      ? "打开 Context Reader"
                      : coverState === "closing"
                        ? "正在合上 Context Reader"
                        : "正在打开 Context Reader"
                  }
                >
                  <span className={styles.closedBook}>
                    <span className={styles.backBoard} />
                    <span className={`${styles.pageBlockEdges} ${styles.leftPageBlockEdges}`}><i /><i /><i /><i /></span>
                    <span className={styles.pageBlockEdges}><i /><i /><i /><i /></span>
                    <span className={styles.frontBoard}>
                      <span className={styles.frontBoardBack} />
                      <span className={styles.coverSpine} />
                      <span className={styles.coverFace}>
                        {coverState !== "open" && (
                          <span className={styles.coverBallpit} aria-hidden="true">
                            <Ballpit
                              className={styles.coverBallpitCanvas}
                              count={50}
                              gravity={0}
                              friction={0.983}
                              wallBounce={0.95}
                              colors={COVER_BALLPIT_COLORS}
                              followCursor={false}
                            />
                          </span>
                        )}
                        <span className={styles.coverTitle}>
                          <strong>Context Reader</strong>
                          <small>语境翻译魔法书</small>
                        </span>
                        <span className={styles.coverFooter}><span>语境英语阅读</span><span>Open the book</span></span>
                      </span>
                    </span>
                    <span className={styles.bookForeEdge} />
                  </span>
              </button>
            </div>
          </div>

          <div className={styles.stageGuidance} aria-live="polite">
            {coverState === "closed" && <><strong>点击封面或向下滚动，打开这本书</strong><span>向上滚动可以重新合上封面</span></>}
            {coverState === "opening" && <><strong>正在打开阅读空间</strong><span>封面、纸芯与光影会一起展开</span></>}
            {coverState === "closing" && <><strong>正在合上这本书</strong><span>书页、纸芯与封面会连续回到原位</span></>}
            {coverState === "open" && chapter === "foreword" && <><strong>开发者的话</strong><span>继续向下翻页，进入真实划词与查词</span></>}
            {coverState === "open" && chapter === "workbench" && <><strong>开始阅读</strong><span>左页体验语境划词，右页可以独立查词或导入文章</span></>}
            {coverState === "open" && chapter === "recommendations" && <><strong>推荐文章</strong><span>点击整篇文章，从图片连续展开进入阅读器</span></>}
          </div>

          <nav className={styles.chapterRail} aria-label="书本目录">
            <button type="button" aria-current={coverState === "closed" ? "step" : undefined} onClick={scrollToCover}><i />封面</button>
            <button type="button" aria-current={coverState === "open" && chapter === "foreword" ? "step" : undefined} onClick={scrollToForeword}><i />开发者的话</button>
            <button type="button" aria-current={coverState === "open" && chapter === "workbench" ? "step" : undefined} onClick={scrollToWorkbench}><i />开始阅读</button>
            <button type="button" aria-current={coverState === "open" && chapter === "recommendations" ? "step" : undefined} onClick={scrollToRecommendations}><i />推荐文章</button>
          </nav>
        </div>
      </section>

      <HomeOptionMenu
        open={menuOpen}
        isAdmin={account.plan?.id === "admin"}
        savedArticles={account.authenticated ? savedArticles : []}
        onClose={() => setMenuOpen(false)}
        onOpenVocabulary={handleOpenVocabulary}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenSavedArticle={onOpenSavedArticle}
      />

      {recommendationDialogOpen && (
        <div
          className={styles.profileDialogBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRecommendationDialogOpen(false);
          }}
        >
          <section
            className={styles.profileDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="recommendation-profile-heading"
            data-local-scroll-surface
          >
            <header className={styles.profileDialogHeader}>
              <div>
                <p className={styles.sectionLabel}>个性化推荐</p>
                <h2 id="recommendation-profile-heading">告诉这本书，你现在想读什么</h2>
                <p>选择大致阶段、阅读强度和感兴趣的内容。保存后，推荐文章会立即刷新。</p>
              </div>
              <button type="button" aria-label="关闭个性化推荐" onClick={() => setRecommendationDialogOpen(false)}>×</button>
            </header>

            <div className={styles.profileDialogBody}>
              <fieldset>
                <legend>1. 你目前更接近哪个阶段？</legend>
                <div className={styles.choiceGrid}>
                  {PROFILE_LEVELS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={recommendationDraft.level === item.value}
                      className={recommendationDraft.level === item.value ? styles.choiceSelected : ""}
                      onClick={() => setRecommendationDraft((current) => ({ ...current, level: item.value }))}
                    ><small>{item.group}</small><strong>{item.label}</strong></button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend>2. 这次想读到什么强度？</legend>
                <div className={styles.paceChoices}>
                  {(["轻松", "适中", "挑战"] as const).map((pace) => (
                    <button
                      key={pace}
                      type="button"
                      aria-pressed={recommendationDraft.pace === pace}
                      className={recommendationDraft.pace === pace ? styles.choiceSelected : ""}
                      onClick={() => setRecommendationDraft((current) => ({ ...current, pace }))}
                    >{pace === "轻松" ? "较轻松" : pace === "挑战" ? "想挑战" : pace}</button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend>3. 哪些内容更容易让你读下去？</legend>
                <div className={styles.interestChoices}>
                  {PROFILE_INTERESTS.map((interest) => (
                    <button
                      key={interest}
                      type="button"
                      aria-pressed={recommendationDraft.interests.includes(interest)}
                      className={recommendationDraft.interests.includes(interest) ? styles.choiceSelected : ""}
                      onClick={() => toggleDraftInterest(interest)}
                    >{interest}</button>
                  ))}
                </div>
              </fieldset>
            </div>

            <footer className={styles.profileDialogActions}>
              <button type="button" onClick={resetRecommendationProfile}>恢复默认推荐</button>
              <button type="button" onClick={applyRecommendationProfile}>应用个性化推荐</button>
            </footer>
          </section>
        </div>
      )}

      <VocabularyPanel
        entries={vocabularyEntries}
        open={vocabularyOpen}
        importingId=""
        importError={vocabularyError}
        placement="dialog"
        showAnkiActions={false}
        onClose={() => setVocabularyOpen(false)}
        onDelete={(id) => setVocabularyEntries(deleteVocabularyEntry(id))}
        onClear={handleClearVocabulary}
        onExportCsv={() => {
          try { downloadVocabularyCsv(vocabularyEntries); }
          catch (csvError) { setVocabularyError(csvError instanceof Error ? csvError.message : "CSV 导出失败，请稍后重试。"); }
        }}
        onCopy={handleCopyVocabularyEntry}
        onJumpToSource={(entry) => { setVocabularyOpen(false); onJumpToVocabularySource(entry); }}
        canJumpToSource={canJumpToVocabularySource}
        onImportAnki={() => undefined}
        onImportAllAnki={() => undefined}
      />

      <FeedbackPanel open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <div className={styles.readerTransitionStatus} aria-live="polite">
        {readerTransitioning ? "正在展开为阅读器…" : openingPublicArticleId ? "正在打开文章…" : ""}
      </div>
    </main>
  );
}
