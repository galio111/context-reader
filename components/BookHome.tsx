"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { BookDictionary } from "@/components/BookDictionary";
import { BookLetterField } from "@/components/BookLetterField";
import { BookRecommendations } from "@/components/BookRecommendations";
import { FeedbackPanel } from "@/components/FeedbackPanel";
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

const DEMO_HINT_KEY = "context-reader:book-demo-hint-seen:v1";
const RECOMMENDATION_PROFILE_KEY = "context-reader:recommendation-profile:v1";

type BookChapter = "workbench" | "preferences" | "recommendations";
type TurnDirection = "forward" | "backward";

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
const PAGE_STRIPS = Array.from({ length: 18 }, (_, index) => index);

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
  const { account, loading: accountLoading, openLogin, requireAccount, logout, refreshAccount } = useAccount();
  const [coverState, setCoverState] = useState<"closed" | "opening" | "open">("closed");
  const [chapter, setChapter] = useState<BookChapter>("workbench");
  const [turning, setTurning] = useState(false);
  const [turnDirection, setTurnDirection] = useState<TurnDirection>("forward");
  const [turnTarget, setTurnTarget] = useState<BookChapter | null>(null);
  const [mobileWorkbenchPage, setMobileWorkbenchPage] = useState<"demo" | "desk">("demo");
  const [recommendationProfile, setRecommendationProfile] = useState<RecommendationProfile>(INITIAL_RECOMMENDATION_PROFILE);
  const [clientReady, setClientReady] = useState(false);
  const [inputMode, setInputMode] = useState<"paste" | "url" | "dictionary">("paste");
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
  const chapterRef = useRef<BookChapter>("workbench");
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
    const locked = menuOpen || vocabularyOpen || feedbackOpen;
    document.documentElement.classList.toggle("cr-overlay-locked", locked);
    document.body.classList.toggle("cr-overlay-locked", locked);
    return () => {
      document.documentElement.classList.remove("cr-overlay-locked");
      document.body.classList.remove("cr-overlay-locked");
    };
  }, [feedbackOpen, menuOpen, vocabularyOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

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
    setTurning(true);
    setTurnDirection(direction);
    setTurnTarget(nextChapter);

    const swapTimer = window.setTimeout(() => {
      chapterRef.current = nextChapter;
      setChapter(nextChapter);
    }, 430);
    const settleTimer = window.setTimeout(() => {
      turningRef.current = false;
      setTurning(false);
      setTurnTarget(null);
      const queued = queuedChapterRef.current;
      queuedChapterRef.current = null;
      if (queued && queued !== chapterRef.current) {
        const ranks: Record<BookChapter, number> = { workbench: 0, preferences: 1, recommendations: 2 };
        performTurn(queued, ranks[queued] >= ranks[chapterRef.current] ? "forward" : "backward");
      }
    }, 1120);
    turnTimersRef.current.push(swapTimer, settleTimer);
  }, []);

  function openBook(afterOpen?: () => void) {
    if (coverState !== "closed") {
      afterOpen?.();
      return;
    }
    setCoverState("opening");
    const openTimer = window.setTimeout(() => {
      setCoverState("open");
      afterOpen?.();
    }, 1680);
    turnTimersRef.current.push(openTimer);
  }

  useEffect(() => {
    if (coverState !== "open") return;
    const story = storyRef.current;
    if (!story) return;

    const updateFromScroll = () => {
      scrollFrameRef.current = null;
      const storyTop = story.getBoundingClientRect().top + window.scrollY;
      const distance = Math.max(1, story.offsetHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, (window.scrollY - storyTop) / distance));
      let desired: BookChapter = "workbench";
      if (progress >= 0.31) desired = "preferences";
      if (progress >= 0.64 && recommendationProfile.complete) desired = "recommendations";
      if (desired === chapterRef.current) return;
      const ranks: Record<BookChapter, number> = { workbench: 0, preferences: 1, recommendations: 2 };
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
  }, [beginTurn, coverState, recommendationProfile.complete]);

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
      beginTurn("workbench", "backward");
      setMobileWorkbenchPage("desk");
      storyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => workbenchRef.current?.focus({ preventScroll: true }), 900);
    };
    openBook(showWorkbench);
  }

  function openDictionary() {
    setMenuOpen(false);
    setInputMode("dictionary");
    scrollToWorkbench();
  }

  function scrollToRecommendations() {
    setMenuOpen(false);
    openBook(() => {
      const story = storyRef.current;
      if (!story) return;
      if (!recommendationProfile.complete) {
        beginTurn("preferences", "forward");
      } else {
        beginTurn("recommendations", "forward");
      }
      const top = story.getBoundingClientRect().top + window.scrollY;
      const distance = Math.max(0, story.offsetHeight - window.innerHeight);
      window.scrollTo({ top: top + distance * (recommendationProfile.complete ? 0.77 : 0.46), behavior: "smooth" });
    });
  }

  function updateProfile(next: RecommendationProfile) {
    setRecommendationProfile(next);
    window.localStorage.setItem(RECOMMENDATION_PROFILE_KEY, JSON.stringify(next));
  }

  function toggleProfileInterest(interest: string) {
    const interests = recommendationProfile.interests.includes(interest)
      ? recommendationProfile.interests.filter((item) => item !== interest)
      : [...recommendationProfile.interests, interest];
    updateProfile({ ...recommendationProfile, interests });
  }

  function completeRecommendationProfile() {
    const next = { ...recommendationProfile, complete: true };
    updateProfile(next);
    beginTurn("recommendations", "forward");
    const story = storyRef.current;
    if (story) {
      const top = story.getBoundingClientRect().top + window.scrollY;
      const distance = Math.max(0, story.offsetHeight - window.innerHeight);
      window.setTimeout(() => window.scrollTo({ top: top + distance * 0.78, behavior: "smooth" }), 260);
    }
  }

  return (
    <main className={`${styles.root} ${readerTransitioning ? styles.readerEntering : ""}`}>
      <BookLetterField paused={readerTransitioning || menuOpen || vocabularyOpen || feedbackOpen} />
      <div className={styles.ambient} aria-hidden="true">
        <span>context</span>
        <span>meaning</span>
        <span>read</span>
      </div>

      <header className={styles.topbar}>
        <Link className={styles.brand} href="/home-v2" aria-label="Context Reader 书本主页">
          <span>Context Reader</span>
        </Link>
        <div className={styles.topActions}>
          <button className={styles.textAction} type="button" onClick={scrollToWorkbench}>开始阅读</button>
          <button
            className={styles.menuButton}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="book-home-menu"
            onClick={() => setMenuOpen(true)}
          >
            <span>Menu</span>
            <span className={styles.menuGlyph} aria-hidden="true"><i /><i /></span>
          </button>
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
              {chapter === "workbench" && (
                <div className={styles.workbenchSpread} data-mobile-page={mobileWorkbenchPage}>
                  <section className={`${styles.page} ${styles.leftPage}`} aria-labelledby="book-demo-heading">
              <div className={styles.pageNumber}>Context note · 01</div>
              <div className={styles.demoHeader}>
                <div>
                  <p className={styles.sectionLabel}>真实划词体验</p>
                  <h1 id="book-demo-heading">不止一个词，也划过一段表达</h1>
                </div>
                <span className={styles.demoStatus}>可交互</span>
              </div>

              <article className={styles.demoArticle} aria-label="可划词的英文短文" data-pointer-quiet>
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
                        onPointerCancel={() => { dragRef.current = null; }}
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

              <div className={styles.explanationShell} data-pointer-quiet>
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

              <button className={styles.mobileNextPage} type="button" onClick={scrollToWorkbench}>
                下一页：开始阅读 <span aria-hidden="true">↓</span>
              </button>
                  </section>

                  <div className={styles.spine} aria-hidden="true"><i /></div>

                  <section ref={workbenchRef} tabIndex={-1} className={`${styles.page} ${styles.rightPage}`} aria-labelledby="book-workbench-heading">
              <div className={styles.pageNumber}>Reading desk · 02</div>
              <div className={styles.workbenchHeader}>
                <p className={styles.sectionLabel}>阅读起点</p>
                <h2 id="book-workbench-heading">从你想读的内容开始。</h2>
                <p>粘贴文章、输入公开网址或单独查一个词，选择一种方式开始。</p>
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
                <button
                  type="button"
                  role="tab"
                  aria-selected={inputMode === "dictionary"}
                  className={inputMode === "dictionary" ? styles.activeMode : ""}
                  onClick={openDictionary}
                >单独查词</button>
              </div>

              {inputMode === "paste" ? (
                <form className={styles.articleForm} data-pointer-quiet onSubmit={(event) => { event.preventDefault(); onStartReading(); }}>
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
                <form className={styles.urlForm} data-pointer-quiet onSubmit={(event) => { event.preventDefault(); onImportUrl(); }}>
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
              )}

              {chapter === "preferences" && (
                <section className={styles.preferenceSpread} aria-labelledby="recommendation-profile-heading">
                  <div className={`${styles.page} ${styles.preferenceIntro}`}>
                    <div className={styles.pageNumber}>Reading note · 04</div>
                    <p className={styles.sectionLabel}>推荐前的简单选择</p>
                    <h2 id="recommendation-profile-heading">先告诉这本书，你现在想读什么。</h2>
                    <p>不用做词汇量测试。选择大致学习阶段、阅读强度和兴趣，之后可以随时修改。</p>
                    <dl className={styles.profileSummary}>
                      <div><dt>学习阶段</dt><dd>{recommendationProfile.level === "all" ? "尚未选择" : recommendationProfile.level}</dd></div>
                      <div><dt>阅读强度</dt><dd>{recommendationProfile.pace || "尚未选择"}</dd></div>
                      <div><dt>兴趣</dt><dd>{recommendationProfile.interests.length ? recommendationProfile.interests.join("、") : "尚未选择"}</dd></div>
                    </dl>
                    <button type="button" className={styles.backToDesk} onClick={scrollToWorkbench}>返回阅读工作台</button>
                  </div>
                  <div className={styles.preferenceLeaf} aria-hidden="true" />
                  <div className={`${styles.page} ${styles.preferenceForm}`} data-pointer-quiet>
                    <fieldset>
                      <legend>1. 你目前更接近哪个阶段？</legend>
                      <div className={styles.choiceGrid}>
                        {PROFILE_LEVELS.map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            aria-pressed={recommendationProfile.level === item.value}
                            className={recommendationProfile.level === item.value ? styles.choiceSelected : ""}
                            onClick={() => updateProfile({ ...recommendationProfile, level: item.value })}
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
                            aria-pressed={recommendationProfile.pace === pace}
                            className={recommendationProfile.pace === pace ? styles.choiceSelected : ""}
                            onClick={() => updateProfile({ ...recommendationProfile, pace })}
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
                            aria-pressed={recommendationProfile.interests.includes(interest)}
                            className={recommendationProfile.interests.includes(interest) ? styles.choiceSelected : ""}
                            onClick={() => toggleProfileInterest(interest)}
                          >{interest}</button>
                        ))}
                      </div>
                    </fieldset>
                    <div className={styles.profileActions}>
                      <button type="button" onClick={completeRecommendationProfile}>暂时跳过</button>
                      <button type="button" onClick={completeRecommendationProfile}>生成我的推荐目录</button>
                    </div>
                  </div>
                </section>
              )}

              {chapter === "recommendations" && (
                <BookRecommendations
                  embedded
                  articles={publicArticles}
                  openingPublicArticleId={openingPublicArticleId}
                  readerTransitioning={readerTransitioning}
                  preferredLevel={recommendationProfile.level}
                  onOpenArticle={onOpenPublicArticle}
                  onPrefetchArticle={onPrefetchPublicArticle}
                />
              )}

              {turning && (
                <div className={`${styles.pageTurn} ${turnDirection === "backward" ? styles.pageTurnBackward : ""}`} aria-hidden="true" data-target={turnTarget ?? ""}>
                  <div className={styles.pageTurnShadow} />
                  {PAGE_STRIPS.map((index) => <i key={index} style={{ "--strip": index } as CSSProperties} />)}
                  <span className={styles.pageTurnEdge} />
                </div>
              )}

              {coverState !== "open" && (
                <button
                  type="button"
                  className={styles.coverAssembly}
                  data-pointer-live
                  onClick={() => openBook()}
                  disabled={coverState === "opening"}
                  aria-label={coverState === "closed" ? "打开 Context Reader" : "正在打开 Context Reader"}
                >
                  <span className={styles.closedBook}>
                    <span className={styles.backBoard} />
                    <span className={styles.pageBlockEdges}><i /><i /><i /><i /></span>
                    <span className={styles.frontBoard}>
                      <span className={styles.frontBoardBack} />
                      <span className={styles.coverSpine} />
                      <span className={styles.coverFace}>
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
              )}
            </div>
          </div>

          <div className={styles.stageGuidance} aria-live="polite">
            {coverState === "closed" && <><strong>点击封面，打开这本书</strong><span>真实划词、文章导入和推荐都在书里</span></>}
            {coverState === "opening" && <><strong>正在打开阅读空间</strong><span>封面、纸芯与光影会一起展开</span></>}
            {coverState === "open" && chapter === "workbench" && <><strong>先阅读，也可以继续向下翻页</strong><span>下一页会询问你的阅读偏好</span></>}
            {coverState === "open" && chapter === "preferences" && <><strong>阅读偏好夹页</strong><span>完成选择后进入推荐目录</span></>}
            {coverState === "open" && chapter === "recommendations" && <><strong>推荐目录</strong><span>点击整篇文章，从封面展开进入阅读器</span></>}
          </div>

          {coverState === "open" && (
            <nav className={styles.chapterRail} aria-label="书本章节">
              <button type="button" aria-current={chapter === "workbench" ? "step" : undefined} onClick={scrollToWorkbench}><i />开始阅读</button>
              <button type="button" aria-current={chapter === "preferences" ? "step" : undefined} onClick={() => { beginTurn("preferences", "forward"); const story = storyRef.current; if (story) { const top = story.getBoundingClientRect().top + window.scrollY; window.scrollTo({ top: top + (story.offsetHeight - window.innerHeight) * .46, behavior: "smooth" }); } }}><i />阅读偏好</button>
              <button type="button" aria-current={chapter === "recommendations" ? "step" : undefined} onClick={scrollToRecommendations}><i />推荐目录</button>
            </nav>
          )}
        </div>
      </section>

      {menuOpen && (
        <div className={styles.menuOverlay} role="presentation" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setMenuOpen(false);
        }}>
          <aside id="book-home-menu" className={styles.menuPanel} role="dialog" aria-modal="true" aria-labelledby="book-home-menu-title">
            <header>
              <div>
                <span>Context Reader</span>
                <h2 id="book-home-menu-title">Menu</h2>
              </div>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="关闭菜单">×</button>
            </header>

            <nav className={styles.menuLinks} aria-label="产品功能">
              <button type="button" onClick={openDictionary}>
                <span>独立深度词典</span><em>查单词或短语</em>
              </button>
              <button type="button" onClick={scrollToRecommendations}>
                <span>分级推荐文章</span><em>{publicArticles.length ? `${publicArticles.length} 篇已发布` : "等待首批发布"}</em>
              </button>
              <button type="button" onClick={handleOpenVocabulary}>
                <span>生词本</span><em>{account.authenticated ? `${vocabularyEntries.length} 条` : "登录后使用"}</em>
              </button>
              <Link href="/guide" onClick={() => setMenuOpen(false)}><span>使用说明</span><em>打开指南</em></Link>
              <button type="button" onClick={() => { setMenuOpen(false); setFeedbackOpen(true); }}>
                <span>意见反馈</span><em>提交建议或问题</em>
              </button>
              {account.authenticated ? (
                <Link href="/account/usage" onClick={() => setMenuOpen(false)}><span>账号、用量与同步</span><em>查看状态</em></Link>
              ) : (
                <button type="button" onClick={() => { setMenuOpen(false); openLogin("登录后可同步生词本、文章和翻译缓存。"); }}>
                  <span>登录与同步</span><em>{accountLoading ? "正在读取" : "游客模式"}</em>
                </button>
              )}
            </nav>

            <section className={styles.savedSection} aria-labelledby="book-saved-heading">
              <div><h3 id="book-saved-heading">已保存文章</h3><span>{sortedSavedArticles.length} 篇</span></div>
              {sortedSavedArticles.length ? (
                <div className={styles.savedList} data-local-scroll-surface>
                  {sortedSavedArticles.map((savedArticle) => (
                    <article key={savedArticle.id}>
                      <button type="button" onClick={() => { setMenuOpen(false); onOpenSavedArticle(savedArticle); }}>
                        <strong>{savedArticle.title || "未命名文章"}</strong>
                        <span>{savedArticlePreview(savedArticle)}</span>
                        <time>{formatSavedDate(savedArticle)}</time>
                      </button>
                      <button type="button" aria-label={`删除 ${savedArticle.title || "这篇文章"}`} onClick={() => onDeleteSavedArticle(savedArticle.id)}>删除</button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.savedEmpty}>保存过的文章会按最近打开时间出现在这里。</p>
              )}
            </section>

            {account.authenticated && (
              <footer className={styles.menuAccount}>
                <span>{account.profile?.nickname || "已登录账号"}</span>
                <button type="button" onClick={() => { setMenuOpen(false); void logout(); }}>退出登录</button>
              </footer>
            )}
          </aside>
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
