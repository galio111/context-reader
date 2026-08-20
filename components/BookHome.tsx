"use client";

import dynamic from "next/dynamic";
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
import ClearableField from "@/components/ClearableField";
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
import { currentFormPhonetic } from "@/lib/pronunciation";
import { createStandaloneVocabularyEntry } from "@/lib/standaloneDictionary";
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
import type { DictionaryResult } from "@/types/dictionary";
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
const MOBILE_DESKTOP_HINT_KEY = "context-reader:mobile-desktop-hint-seen:v1";
const RECOMMENDATION_PROFILE_KEY = "context-reader:recommendation-profile:v1";
const COVER_SCROLL_END = .18;
const FOREWORD_SCROLL_POSITION = .22;
const FIRST_TURN_START = .28;
const FIRST_TURN_END = .42;
const EXPERIENCE_SCROLL_POSITION = .46;
const SECOND_TURN_START = .52;
const SECOND_TURN_END = .66;
const WORKBENCH_SCROLL_POSITION = .70;
const THIRD_TURN_START = .76;
const THIRD_TURN_END = .90;
const RECOMMENDATION_SCROLL_POSITION = THIRD_TURN_END;
const PAGE_TURN_SETTLE_IDLE_MS = 90;
const PAGE_TURN_SETTLE_MIN_MS = 180;
const PAGE_TURN_SETTLE_MAX_MS = 480;
const PAGE_TURN_EDGE_EPSILON = .0015;
const PROGRAMMATIC_TURN_MIN_MS = 260;
const PROGRAMMATIC_TURN_MAX_MS = 620;
const PAGE_SCROLL_BOUNDARY_IDLE_MS = 520;

type BookChapter = "foreword" | "experience" | "workbench" | "recommendations";
type RevealChapter = Exclude<BookChapter, "recommendations">;
type RevealPhase = "hidden" | "revealing" | "printed";
type TurnDirection = "forward" | "backward";
type CoverState = "closed" | "opening" | "open" | "closing";

const CHAPTER_ORDER: BookChapter[] = ["foreword", "experience", "workbench", "recommendations"];
const CHAPTER_SCROLL_POSITIONS: Record<BookChapter, number> = {
  foreword: FOREWORD_SCROLL_POSITION,
  experience: EXPERIENCE_SCROLL_POSITION,
  workbench: WORKBENCH_SCROLL_POSITION,
  recommendations: RECOMMENDATION_SCROLL_POSITION,
};
const INITIAL_REVEAL_PHASES: Record<RevealChapter, RevealPhase> = {
  foreword: "hidden",
  experience: "hidden",
  workbench: "hidden",
};

interface DirectorySeek {
  key: string;
  source: BookChapter;
  target: BookChapter;
  direction: TurnDirection;
  startProgress: number;
  targetProgress: number;
  closeAfter: boolean;
}

interface ActiveTurnRange {
  start: number;
  end: number;
}

interface PendingDirectoryTarget {
  target: BookChapter;
  closeAfter?: boolean;
}

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
const FOREWORD_SEGMENTS = [
  "写给正在翻开这本书的人",
  "我做 Context Reader，是因为查懂一个词，常常还不等于读懂一句话。",
  "我希望这里能保留你正在阅读的上下文，让查词、理解和继续读下去发生在同一页里。你可以从一篇真正想读的文章开始，遇到陌生表达时停一下，再继续往前。",
  "愿这本书帮你少一些被打断的时刻，多读完几篇原本想放弃的文章。",
  "Context Reader 开发者",
  "欧阳子浩",
] as const;
const FOREWORD_TITLE_LINES = ["写给正在翻开", "这本书的人"] as const;

function revealOrder(order: number): CSSProperties {
  return { "--reveal-order": order } as CSSProperties;
}

function revealPhaseClass(phase: RevealPhase): string {
  if (phase === "revealing") return styles.chapterRevealActive;
  if (phase === "printed") return styles.chapterRevealPrinted;
  return styles.chapterRevealHidden;
}

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
  phonetic: "taken /ˈteɪkən/ · root /ruːt/",
  phoneticFor: "taken root",
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
  const phonetic = currentFormPhonetic(entry);
  if (!entry.sourceSentence.trim()) {
    const isChineseToEnglish = entry.anki.cardMode === "basic_cn_to_en_dictionary";
    return [
      `${isChineseToEnglish ? "英文表达" : "当前词"}：${entry.word}`,
      entry.lemma ? `原型：${entry.lemma}` : "",
      phonetic ? `当前词音标（${entry.word}）：${phonetic}` : "",
      entry.partOfSpeech ? `词性：${entry.partOfSpeech}` : "",
      isChineseToEnglish ? `中文提示：${entry.contextMeaning}` : "",
      `${isChineseToEnglish ? "英文表达" : "中文释义"}：${entry.basicMeaning}`,
      entry.usageNote ? `用法与补充：${entry.usageNote}` : "",
      entry.collocation ? `常见搭配：${entry.collocation}` : "",
      entry.exampleEnglish ? `例句：${entry.exampleEnglish}` : "",
      entry.exampleChinese ? `例句翻译：${entry.exampleChinese}` : "",
    ].filter(Boolean).join("\n");
  }
  const contextMeaningLabel = entry.word.trim().split(/\s+/).length > 1
    ? "所选短语在本句中的含义"
    : "所选词在本句中的含义";
  return [
    `当前词：${entry.word}`,
    entry.lemma ? `原型：${entry.lemma}` : "",
    phonetic ? `当前词音标（${entry.word}）：${phonetic}` : "",
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
  const {
    account,
    hasLocalAccountAccess,
    isOffline,
    localAccount,
    openLogin,
    requireLocalAccount,
    refreshAccount,
  } = useAccount();
  const [coverState, setCoverState] = useState<CoverState>("closed");
  const [chapter, setChapter] = useState<BookChapter>("foreword");
  const [turning, setTurning] = useState(false);
  const [turnDirection, setTurnDirection] = useState<TurnDirection>("forward");
  const [recommendationProfile, setRecommendationProfile] = useState<RecommendationProfile>(INITIAL_RECOMMENDATION_PROFILE);
  const [recommendationDraft, setRecommendationDraft] = useState<RecommendationProfile>(INITIAL_RECOMMENDATION_PROFILE);
  const [recommendationDialogOpen, setRecommendationDialogOpen] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [showMobileDesktopHint, setShowMobileDesktopHint] = useState(false);
  const [inputMode, setInputMode] = useState<"paste" | "url">("paste");
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
  const [revealPhases, setRevealPhases] = useState<Record<RevealChapter, RevealPhase>>(INITIAL_REVEAL_PHASES);
  const storyRef = useRef<HTMLElement | null>(null);
  const coverAssemblyRef = useRef<HTMLButtonElement | null>(null);
  const coverFaceRef = useRef<HTMLSpanElement | null>(null);
  const workbenchRef = useRef<HTMLElement | null>(null);
  const explanationShellRef = useRef<HTMLDivElement | null>(null);
  const recommendationScrollRef = useRef<HTMLElement | null>(null);
  const pageTurnRef = useRef<CurvedPageTurnHandle | null>(null);
  const coverTurnRef = useRef<CurvedPageTurnHandle | null>(null);
  const spreadRefs = useRef<Record<BookChapter, HTMLElement | null>>({
    foreword: null,
    experience: null,
    workbench: null,
    recommendations: null,
  });
  const chapterRef = useRef<BookChapter>("foreword");
  const coverStateRef = useRef<CoverState>("closed");
  const coverProgressRef = useRef(0);
  const storyProgressRef = useRef(0);
  const turningRef = useRef(false);
  const turnDirectionRef = useRef<TurnDirection>("forward");
  const directorySeekRef = useRef<DirectorySeek | null>(null);
  const pendingDirectoryTargetRef = useRef<PendingDirectoryTarget | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const turnSettleFrameRef = useRef<number | null>(null);
  const turnSettleTimerRef = useRef<number | null>(null);
  const turnSettleTargetRef = useRef<number | null>(null);
  const turnCommitFrameRef = useRef<number | null>(null);
  const startIntentFrameRef = useRef<number | null>(null);
  const lastObservedStoryProgressRef = useRef(0);
  const lastScrollDirectionRef = useRef<TurnDirection>("forward");
  const dragRef = useRef<DemoDrag | null>(null);
  const suppressClickRef = useRef(false);
  const explanationAbortRef = useRef<AbortController | null>(null);
  const revealPhasesRef = useRef<Record<RevealChapter, RevealPhase>>(INITIAL_REVEAL_PHASES);
  const revealStartTimerRef = useRef<number | null>(null);
  const revealFinishTimerRef = useRef<number | null>(null);

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

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get("start") === "paste") {
      setInputMode("paste");
      startIntentFrameRef.current = window.requestAnimationFrame(() => {
        startIntentFrameRef.current = window.requestAnimationFrame(() => {
          startIntentFrameRef.current = null;
          scrollToWorkbench();
          currentUrl.searchParams.delete("start");
          window.history.replaceState(window.history.state, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
        });
      });
    }

    return () => {
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabularyEntries);
      pageTurnRef.current?.clear();
      coverTurnRef.current?.clear();
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      if (turnSettleFrameRef.current !== null) window.cancelAnimationFrame(turnSettleFrameRef.current);
      if (turnSettleTimerRef.current !== null) window.clearTimeout(turnSettleTimerRef.current);
      if (turnCommitFrameRef.current !== null) window.cancelAnimationFrame(turnCommitFrameRef.current);
      if (startIntentFrameRef.current !== null) window.cancelAnimationFrame(startIntentFrameRef.current);
      if (revealStartTimerRef.current !== null) window.clearTimeout(revealStartTimerRef.current);
      if (revealFinishTimerRef.current !== null) window.clearTimeout(revealFinishTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const syncMobileLayout = () => {
      const mobile = mobileQuery.matches;
      setIsMobileLayout(mobile);
      setShowMobileDesktopHint(
        mobile && window.localStorage.getItem(MOBILE_DESKTOP_HINT_KEY) !== "1",
      );
    };
    syncMobileLayout();
    mobileQuery.addEventListener("change", syncMobileLayout);
    return () => mobileQuery.removeEventListener("change", syncMobileLayout);
  }, []);

  const setRevealPhase = useCallback((target: RevealChapter, phase: RevealPhase) => {
    if (revealPhasesRef.current[target] === phase) return;
    revealPhasesRef.current = { ...revealPhasesRef.current, [target]: phase };
    setRevealPhases(revealPhasesRef.current);
  }, []);

  const ensureChapterPrinted = useCallback((target: BookChapter) => {
    if (target === "recommendations") return;
    if (revealStartTimerRef.current !== null) {
      window.clearTimeout(revealStartTimerRef.current);
      revealStartTimerRef.current = null;
    }
    if (revealFinishTimerRef.current !== null) {
      window.clearTimeout(revealFinishTimerRef.current);
      revealFinishTimerRef.current = null;
    }
    setRevealPhase(target, "printed");
  }, [setRevealPhase]);

  const ensureChapterPathPrinted = useCallback((source: BookChapter, target: BookChapter) => {
    const sourceIndex = CHAPTER_ORDER.indexOf(source);
    const targetIndex = CHAPTER_ORDER.indexOf(target);
    const start = Math.min(sourceIndex, targetIndex);
    const end = Math.max(sourceIndex, targetIndex);
    CHAPTER_ORDER.slice(start, end + 1).forEach(ensureChapterPrinted);
  }, [ensureChapterPrinted]);

  useEffect(() => {
    if (!isMobileLayout) return;
    CHAPTER_ORDER.forEach(ensureChapterPrinted);
  }, [ensureChapterPrinted, isMobileLayout]);

  useEffect(() => {
    if (isMobileLayout || coverState !== "open" || chapter === "recommendations") return;
    if (revealPhasesRef.current[chapter] !== "hidden") return;
    if (lastScrollDirectionRef.current === "backward") {
      ensureChapterPrinted(chapter);
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    revealStartTimerRef.current = window.setTimeout(() => {
      revealStartTimerRef.current = null;
      setRevealPhase(chapter, reducedMotion ? "printed" : "revealing");
    }, reducedMotion ? 80 : 240);
    return () => {
      if (revealStartTimerRef.current !== null) {
        window.clearTimeout(revealStartTimerRef.current);
        revealStartTimerRef.current = null;
      }
    };
  }, [chapter, coverState, ensureChapterPrinted, isMobileLayout, setRevealPhase]);

  useEffect(() => {
    if (chapter === "recommendations" || revealPhases[chapter] !== "revealing") return;
    revealFinishTimerRef.current = window.setTimeout(() => {
      revealFinishTimerRef.current = null;
      setRevealPhase(chapter, "printed");
    }, chapter === "foreword" ? 2100 : 1650);
    return () => {
      if (revealFinishTimerRef.current !== null) {
        window.clearTimeout(revealFinishTimerRef.current);
        revealFinishTimerRef.current = null;
      }
    };
  }, [chapter, revealPhases, setRevealPhase]);

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

  const setChapterImmediately = useCallback((nextChapter: BookChapter) => {
    if (chapterRef.current === nextChapter) return;
    chapterRef.current = nextChapter;
    setChapter(nextChapter);
    window.dispatchEvent(new Event("context-reader:book-layout-change"));
  }, []);

  const setTurnVisual = useCallback((active: boolean, direction: TurnDirection = "forward") => {
    if (active && turnCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(turnCommitFrameRef.current);
      turnCommitFrameRef.current = null;
    }
    if (turnDirectionRef.current !== direction) {
      turnDirectionRef.current = direction;
      setTurnDirection(direction);
    }
    if (turningRef.current === active) return;
    turningRef.current = active;
    setTurning(active);
  }, []);

  const finishTurnVisual = useCallback((nextChapter: BookChapter) => {
    if (!turningRef.current && chapterRef.current === nextChapter) return;
    if (turnCommitFrameRef.current !== null) {
      window.cancelAnimationFrame(turnCommitFrameRef.current);
    }
    setChapterImmediately(nextChapter);
    setTurnVisual(false);
    turnCommitFrameRef.current = window.requestAnimationFrame(() => {
      turnCommitFrameRef.current = null;
      if (turningRef.current || chapterRef.current !== nextChapter) return;
      pageTurnRef.current?.clear();
    });
  }, [setChapterImmediately, setTurnVisual]);

  const cancelTurnSettle = useCallback(() => {
    if (turnSettleTimerRef.current !== null) {
      window.clearTimeout(turnSettleTimerRef.current);
      turnSettleTimerRef.current = null;
    }
    if (turnSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(turnSettleFrameRef.current);
      turnSettleFrameRef.current = null;
    }
    turnSettleTargetRef.current = null;
  }, []);

  useEffect(() => {
    const shell = explanationShellRef.current;
    if (!shell || !clientReady) return;
    const scroller = shell.querySelector<HTMLElement>("aside");
    if (!scroller) return;

    const isolateExplanationWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      event.stopPropagation();
      cancelTurnSettle();
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? scroller.clientHeight
          : 1;
      scroller.scrollTop += event.deltaY * multiplier;
    };

    shell.addEventListener("wheel", isolateExplanationWheel, { passive: false });
    return () => shell.removeEventListener("wheel", isolateExplanationWheel);
  }, [cancelTurnSettle, clientReady]);

  useEffect(() => {
    if (!clientReady || window.innerWidth <= 760) return;
    const workbenchScroller = workbenchRef.current;
    const recommendationScroller = recommendationScrollRef.current;
    if (!workbenchScroller || !recommendationScroller) return;

    const boundaryState = new WeakMap<HTMLElement, { direction: "up" | "down"; lastWheelAt: number }>();
    const isolatePageWheel = (scroller: HTMLElement) => (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? scroller.clientHeight
          : 1;
      const delta = event.deltaY * multiplier;
      const direction = delta > 0 ? "down" : "up";
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (maxScroll <= 1) return;

      const nextScrollTop = Math.min(maxScroll, Math.max(0, scroller.scrollTop + delta));
      const canConsume = direction === "down"
        ? scroller.scrollTop < maxScroll - 1
        : scroller.scrollTop > 1;
      const now = performance.now();

      if (canConsume) {
        event.preventDefault();
        event.stopPropagation();
        cancelTurnSettle();
        scroller.scrollTop = nextScrollTop;
        if (nextScrollTop <= 1 || nextScrollTop >= maxScroll - 1) {
          boundaryState.set(scroller, { direction, lastWheelAt: now });
        } else {
          boundaryState.delete(scroller);
        }
        return;
      }

      const state = boundaryState.get(scroller);
      if (state?.direction === direction && now - state.lastWheelAt < PAGE_SCROLL_BOUNDARY_IDLE_MS) {
        event.preventDefault();
        event.stopPropagation();
        cancelTurnSettle();
        boundaryState.set(scroller, { direction, lastWheelAt: now });
        return;
      }

      boundaryState.delete(scroller);
    };

    const isolateWorkbenchWheel = isolatePageWheel(workbenchScroller);
    const isolateRecommendationWheel = isolatePageWheel(recommendationScroller);
    workbenchScroller.addEventListener("wheel", isolateWorkbenchWheel, { passive: false });
    recommendationScroller.addEventListener("wheel", isolateRecommendationWheel, { passive: false });
    return () => {
      workbenchScroller.removeEventListener("wheel", isolateWorkbenchWheel);
      recommendationScroller.removeEventListener("wheel", isolateRecommendationWheel);
    };
  }, [cancelTurnSettle, clientReady]);

  const scrollStoryTo = useCallback((progress: number, behavior: ScrollBehavior = "smooth") => {
    const story = storyRef.current;
    if (!story) return;
    cancelTurnSettle();
    const top = story.getBoundingClientRect().top + window.scrollY;
    const distance = Math.max(1, story.offsetHeight - window.innerHeight);
    const startProgress = Math.min(1, Math.max(0, (window.scrollY - top) / distance));
    const targetProgress = Math.min(1, Math.max(0, progress));
    if (
      behavior === "auto"
      || window.matchMedia("(max-width: 760px)").matches
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || Math.abs(targetProgress - startProgress) < .001
    ) {
      window.scrollTo({ top: top + distance * targetProgress, behavior: "auto" });
      return;
    }

    const travelFraction = Math.min(1, Math.abs(targetProgress - startProgress) / .3);
    const duration = PROGRAMMATIC_TURN_MIN_MS
      + (PROGRAMMATIC_TURN_MAX_MS - PROGRAMMATIC_TURN_MIN_MS) * travelFraction;
    const startedAt = performance.now();
    turnSettleTargetRef.current = targetProgress;
    const tick = (now: number) => {
      if (turnSettleTargetRef.current !== targetProgress) return;
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = .5 - Math.cos(Math.PI * elapsed) / 2;
      const currentTop = story.getBoundingClientRect().top + window.scrollY;
      const currentDistance = Math.max(1, story.offsetHeight - window.innerHeight);
      const currentProgress = startProgress + (targetProgress - startProgress) * eased;
      window.scrollTo({ top: currentTop + currentDistance * currentProgress, behavior: "auto" });
      if (elapsed < 1) {
        turnSettleFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      turnSettleFrameRef.current = null;
      turnSettleTargetRef.current = null;
    };
    turnSettleFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelTurnSettle]);

  const openBook = useCallback(() => {
    pendingDirectoryTargetRef.current = null;
    directorySeekRef.current = null;
    setChapterImmediately("foreword");
    if (window.matchMedia("(max-width: 760px)").matches) {
      coverStateRef.current = "open";
      setCoverState("open");
      ensureChapterPrinted("foreword");
      spreadRefs.current.foreword?.scrollIntoView({ behavior: "auto", block: "start" });
      return;
    }
    scrollStoryTo(FOREWORD_SCROLL_POSITION);
  }, [ensureChapterPrinted, scrollStoryTo, setChapterImmediately]);

  const closeBook = useCallback(() => {
    pendingDirectoryTargetRef.current = null;
    directorySeekRef.current = null;
    if (window.matchMedia("(max-width: 760px)").matches) {
      coverStateRef.current = "closed";
      setCoverState("closed");
      coverAssemblyRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
      return;
    }
    scrollStoryTo(0, "smooth");
  }, [scrollStoryTo]);

  const startDirectorySeek = useCallback((
    target: BookChapter,
    targetProgress: number,
    closeAfter = false,
  ) => {
    const source = chapterRef.current;
    if (window.matchMedia("(max-width: 760px)").matches) {
      directorySeekRef.current = null;
      pendingDirectoryTargetRef.current = null;
      pageTurnRef.current?.clear();
      setTurnVisual(false);
      ensureChapterPrinted(target);
      setChapterImmediately(target);
      spreadRefs.current[target]?.scrollIntoView({ behavior: "auto", block: "start" });
      if (closeAfter) window.requestAnimationFrame(() => closeBook());
      return;
    }
    if (source === target) {
      directorySeekRef.current = null;
      setTurnVisual(false);
      pageTurnRef.current?.clear();
      ensureChapterPrinted(target);
      scrollStoryTo(targetProgress);
      if (closeAfter) window.requestAnimationFrame(() => closeBook());
      return;
    }

    const ranks = Object.fromEntries(CHAPTER_ORDER.map((item, index) => [item, index])) as Record<BookChapter, number>;
    const direction: TurnDirection = ranks[target] >= ranks[source] ? "forward" : "backward";
    ensureChapterPathPrinted(source, target);
    directorySeekRef.current = {
      key: `directory:${source}:${target}:${performance.now().toFixed(0)}`,
      source,
      target,
      direction,
      startProgress: storyProgressRef.current,
      targetProgress,
      closeAfter,
    };
    setTurnVisual(true, direction);
    pageTurnRef.current?.seek(
      directorySeekRef.current.key,
      direction,
      spreadRefs.current[source],
      spreadRefs.current[target],
      0,
    );
    scrollStoryTo(targetProgress);
  }, [closeBook, ensureChapterPathPrinted, ensureChapterPrinted, scrollStoryTo, setTurnVisual]);

  useEffect(() => {
    const story = storyRef.current;
    if (!story) return;

    if (window.matchMedia("(max-width: 760px)").matches) {
      cancelTurnSettle();
      pageTurnRef.current?.clear();
      setTurnVisual(false);

      const mobileSections: Array<[Element | null, BookChapter | "cover"]> = [
        [coverAssemblyRef.current, "cover"],
        [spreadRefs.current.foreword, "foreword"],
        [spreadRefs.current.experience, "experience"],
        [spreadRefs.current.workbench, "workbench"],
        [spreadRefs.current.recommendations, "recommendations"],
      ];
      const visibleRatios = new Map<Element, number>();
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) visibleRatios.set(entry.target, entry.intersectionRatio);
        const visible = mobileSections
          .filter(([element]) => element)
          .map(([element, section]) => ({
            element: element as Element,
            section,
            ratio: visibleRatios.get(element as Element) ?? 0,
          }))
          .sort((left, right) => right.ratio - left.ratio)[0];
        if (!visible || visible.ratio < .18) return;
        if (visible.section === "cover") {
          if (coverStateRef.current !== "closed") {
            coverStateRef.current = "closed";
            setCoverState("closed");
          }
          return;
        }
        if (coverStateRef.current !== "open") {
          coverStateRef.current = "open";
          setCoverState("open");
        }
        ensureChapterPrinted(visible.section);
        setChapterImmediately(visible.section);
      }, {
        rootMargin: "-72px 0px -22% 0px",
        threshold: [0, .18, .35, .55, .75],
      });

      for (const [element] of mobileSections) {
        if (element) observer.observe(element);
      }
      return () => observer.disconnect();
    }

    let recommendationSyncFrame: number | null = null;
    let syncingRecommendationFromStory = false;

    const activeTurnRangeAt = (
      progress: number,
      directorySeek: DirectorySeek | null,
    ): ActiveTurnRange | null => {
      if (directorySeek) {
        const start = Math.min(directorySeek.startProgress, directorySeek.targetProgress);
        const end = Math.max(directorySeek.startProgress, directorySeek.targetProgress);
        if (progress > start + PAGE_TURN_EDGE_EPSILON && progress < end - PAGE_TURN_EDGE_EPSILON) {
          return { start, end };
        }
        return null;
      }
      if (progress > PAGE_TURN_EDGE_EPSILON && progress < COVER_SCROLL_END - PAGE_TURN_EDGE_EPSILON) {
        return { start: 0, end: COVER_SCROLL_END };
      }
      if (progress > FIRST_TURN_START + PAGE_TURN_EDGE_EPSILON && progress < FIRST_TURN_END - PAGE_TURN_EDGE_EPSILON) {
        return { start: FIRST_TURN_START, end: FIRST_TURN_END };
      }
      if (progress > SECOND_TURN_START + PAGE_TURN_EDGE_EPSILON && progress < SECOND_TURN_END - PAGE_TURN_EDGE_EPSILON) {
        return { start: SECOND_TURN_START, end: SECOND_TURN_END };
      }
      if (progress > THIRD_TURN_START + PAGE_TURN_EDGE_EPSILON && progress < THIRD_TURN_END - PAGE_TURN_EDGE_EPSILON) {
        return { start: THIRD_TURN_START, end: THIRD_TURN_END };
      }
      return null;
    };

    const scrollToStoryProgress = (progress: number) => {
      const storyTop = story.getBoundingClientRect().top + window.scrollY;
      const distance = Math.max(1, story.offsetHeight - window.innerHeight);
      window.scrollTo({ top: storyTop + distance * progress, behavior: "auto" });
    };

    const syncRecommendationScrollFromStory = (progress: number) => {
      const scroller = recommendationScrollRef.current;
      if (!scroller) return;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const recommendationProgress = Math.min(
        1,
        Math.max(0, (progress - THIRD_TURN_END) / (1 - THIRD_TURN_END)),
      );
      const nextScrollTop = maxScroll * recommendationProgress;
      if (Math.abs(scroller.scrollTop - nextScrollTop) < 1) return;

      syncingRecommendationFromStory = true;
      scroller.scrollTop = nextScrollTop;
      if (recommendationSyncFrame !== null) window.cancelAnimationFrame(recommendationSyncFrame);
      recommendationSyncFrame = window.requestAnimationFrame(() => {
        recommendationSyncFrame = null;
        syncingRecommendationFromStory = false;
      });
    };

    const syncStoryFromRecommendationScroll = () => {
      if (syncingRecommendationFromStory) return;
      if (chapterRef.current !== "recommendations" || turningRef.current || directorySeekRef.current) return;
      const scroller = recommendationScrollRef.current;
      if (!scroller) return;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (maxScroll <= 0) return;
      const recommendationProgress = Math.min(1, Math.max(0, scroller.scrollTop / maxScroll));
      scrollToStoryProgress(
        THIRD_TURN_END + recommendationProgress * (1 - THIRD_TURN_END),
      );
    };

    const beginTurnSettle = (reducedMotion: boolean) => {
      turnSettleTimerRef.current = null;
      const startProgress = storyProgressRef.current;
      const range = activeTurnRangeAt(startProgress, directorySeekRef.current);
      if (!range) return;

      const targetProgress = lastScrollDirectionRef.current === "forward" ? range.end : range.start;
      const rangeLength = Math.max(.0001, range.end - range.start);
      const remainingFraction = Math.min(1, Math.abs(targetProgress - startProgress) / rangeLength);
      const duration = reducedMotion
        ? 0
        : PAGE_TURN_SETTLE_MIN_MS
          + (PAGE_TURN_SETTLE_MAX_MS - PAGE_TURN_SETTLE_MIN_MS) * remainingFraction;

      turnSettleTargetRef.current = targetProgress;
      if (duration === 0) {
        scrollToStoryProgress(targetProgress);
        turnSettleTargetRef.current = null;
        return;
      }

      const startedAt = performance.now();
      const tick = (now: number) => {
        if (turnSettleTargetRef.current !== targetProgress) return;
        const elapsed = Math.min(1, (now - startedAt) / duration);
        const eased = Math.sin(elapsed * Math.PI / 2);
        scrollToStoryProgress(startProgress + (targetProgress - startProgress) * eased);
        if (elapsed < 1) {
          turnSettleFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }
        turnSettleFrameRef.current = null;
        turnSettleTargetRef.current = null;
      };
      turnSettleFrameRef.current = window.requestAnimationFrame(tick);
    };

    const queueTurnSettle = (progress: number, reducedMotion: boolean) => {
      if (turnSettleFrameRef.current !== null) return;
      if (turnSettleTimerRef.current !== null) {
        window.clearTimeout(turnSettleTimerRef.current);
        turnSettleTimerRef.current = null;
      }
      if (!activeTurnRangeAt(progress, directorySeekRef.current)) return;
      turnSettleTimerRef.current = window.setTimeout(
        () => beginTurnSettle(reducedMotion),
        PAGE_TURN_SETTLE_IDLE_MS,
      );
    };

    const updateFromScroll = () => {
      scrollFrameRef.current = null;
      const storyTop = story.getBoundingClientRect().top + window.scrollY;
      const distance = Math.max(1, story.offsetHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, (window.scrollY - storyTop) / distance));
      const previousStoryProgress = lastObservedStoryProgressRef.current;
      const progressDelta = progress - previousStoryProgress;
      if (Math.abs(progressDelta) > .00005) {
        lastScrollDirectionRef.current = progressDelta > 0 ? "forward" : "backward";
      }
      lastObservedStoryProgressRef.current = progress;
      storyProgressRef.current = progress;

      if (window.matchMedia("(max-width: 760px)").matches) {
        story.dataset.coverTurning = "false";
        cancelTurnSettle();
        directorySeekRef.current = null;
        pageTurnRef.current?.clear();
        setTurnVisual(false);
        const coverOpen = progress >= COVER_SCROLL_END * .5;
        const nextCoverState: CoverState = coverOpen ? "open" : "closed";
        story.style.setProperty("--cover-progress", coverOpen ? "1" : "0");
        coverProgressRef.current = coverOpen ? 1 : 0;
        if (coverStateRef.current !== nextCoverState) {
          coverStateRef.current = nextCoverState;
          setCoverState(nextCoverState);
        }
        if (!coverOpen) {
          setChapterImmediately("foreword");
          return;
        }
        ensureChapterPrinted("foreword");
        const mobileChapter: BookChapter = progress >= THIRD_TURN_START
          ? "recommendations"
          : progress >= SECOND_TURN_START
            ? "workbench"
            : progress >= FIRST_TURN_START
              ? "experience"
              : "foreword";
        setChapterImmediately(mobileChapter);
        return;
      }

      syncRecommendationScrollFromStory(progress);

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      queueTurnSettle(progress, reducedMotion);
      const rawCoverProgress = Math.min(1, Math.max(0, progress / COVER_SCROLL_END));
      story.dataset.coverTurning = rawCoverProgress > .002 && rawCoverProgress < .998 ? "true" : "false";
      const visualCoverProgress = reducedMotion
        ? (rawCoverProgress >= .5 ? 1 : 0)
        : rawCoverProgress;
      story.style.setProperty("--cover-progress", visualCoverProgress.toFixed(5));

      const previousCoverProgress = coverProgressRef.current;
      coverProgressRef.current = rawCoverProgress;
      let nextCoverState: CoverState;
      if (rawCoverProgress <= .002) {
        nextCoverState = "closed";
      } else if (rawCoverProgress >= .998) {
        nextCoverState = "open";
      } else {
        nextCoverState = rawCoverProgress >= previousCoverProgress ? "opening" : "closing";
      }
      if (coverStateRef.current !== nextCoverState) {
        coverStateRef.current = nextCoverState;
        setCoverState(nextCoverState);
      }

      const directorySeek = directorySeekRef.current;
      if (directorySeek) {
        const denominator = directorySeek.targetProgress - directorySeek.startProgress;
        const rawDirectoryProgress = Math.abs(denominator) < .0001
          ? 1
          : (progress - directorySeek.startProgress) / denominator;
        const directoryProgress = Math.min(1, Math.max(0, rawDirectoryProgress));
        const movingTowardTarget = denominator >= 0
          ? lastScrollDirectionRef.current === "forward"
          : lastScrollDirectionRef.current === "backward";

        if (rawDirectoryProgress < -.025) {
          directorySeekRef.current = null;
          pageTurnRef.current?.clear();
          setTurnVisual(false);
        } else if (
          directoryProgress <= .002
          && !movingTowardTarget
          && Math.abs(progress - directorySeek.startProgress) <= .004
        ) {
          directorySeekRef.current = null;
          finishTurnVisual(directorySeek.source);
          return;
        } else if (directoryProgress >= .998) {
          directorySeekRef.current = null;
          finishTurnVisual(directorySeek.target);
          if (directorySeek.target === "workbench") {
            window.requestAnimationFrame(() => workbenchRef.current?.focus({ preventScroll: true }));
          }
          if (directorySeek.closeAfter) {
            window.requestAnimationFrame(() => scrollStoryTo(0));
          }
          return;
        } else {
          setTurnVisual(true, directorySeek.direction);
          pageTurnRef.current?.seek(
            directorySeek.key,
            directorySeek.direction,
            spreadRefs.current[directorySeek.source],
            spreadRefs.current[directorySeek.target],
            reducedMotion ? (directoryProgress >= .5 ? 1 : 0) : directoryProgress,
          );
          return;
        }
      }

      if (rawCoverProgress < .998) {
        pageTurnRef.current?.clear();
        setTurnVisual(false);
        setChapterImmediately("foreword");
        coverTurnRef.current?.seek(
          "cover:foreword",
          "forward",
          coverFaceRef.current,
          spreadRefs.current.foreword,
          visualCoverProgress,
        );
        return;
      }
      coverTurnRef.current?.clear();

      const pendingTarget = pendingDirectoryTargetRef.current;
      if (pendingTarget && progress >= FOREWORD_SCROLL_POSITION - .008) {
        pendingDirectoryTargetRef.current = null;
        const targetProgress = CHAPTER_SCROLL_POSITIONS[pendingTarget.target];
        window.requestAnimationFrame(() => {
          startDirectorySeek(pendingTarget.target, targetProgress, Boolean(pendingTarget.closeAfter));
        });
        return;
      }

      if (
        progress > FIRST_TURN_START + PAGE_TURN_EDGE_EPSILON
        && progress < FIRST_TURN_END - PAGE_TURN_EDGE_EPSILON
      ) {
        const turnProgress = (progress - FIRST_TURN_START) / (FIRST_TURN_END - FIRST_TURN_START);
        ensureChapterPrinted(lastScrollDirectionRef.current === "forward" ? "foreword" : "experience");
        setTurnVisual(true, "forward");
        pageTurnRef.current?.seek(
          "scroll:foreword:experience",
          "forward",
          spreadRefs.current.foreword,
          spreadRefs.current.experience,
          reducedMotion ? (turnProgress >= .5 ? 1 : 0) : turnProgress,
        );
        return;
      }

      if (
        progress > SECOND_TURN_START + PAGE_TURN_EDGE_EPSILON
        && progress < SECOND_TURN_END - PAGE_TURN_EDGE_EPSILON
      ) {
        const turnProgress = (progress - SECOND_TURN_START) / (SECOND_TURN_END - SECOND_TURN_START);
        ensureChapterPrinted(lastScrollDirectionRef.current === "forward" ? "experience" : "workbench");
        setTurnVisual(true, "forward");
        pageTurnRef.current?.seek(
          "scroll:experience:workbench",
          "forward",
          spreadRefs.current.experience,
          spreadRefs.current.workbench,
          reducedMotion ? (turnProgress >= .5 ? 1 : 0) : turnProgress,
        );
        return;
      }

      if (
        progress > THIRD_TURN_START + PAGE_TURN_EDGE_EPSILON
        && progress < THIRD_TURN_END - PAGE_TURN_EDGE_EPSILON
      ) {
        const turnProgress = (progress - THIRD_TURN_START) / (THIRD_TURN_END - THIRD_TURN_START);
        if (lastScrollDirectionRef.current === "forward") ensureChapterPrinted("workbench");
        setTurnVisual(true, "forward");
        pageTurnRef.current?.seek(
          "scroll:workbench:recommendations",
          "forward",
          spreadRefs.current.workbench,
          spreadRefs.current.recommendations,
          reducedMotion ? (turnProgress >= .5 ? 1 : 0) : turnProgress,
        );
        return;
      }

      const settledChapter: BookChapter = progress >= THIRD_TURN_END - PAGE_TURN_EDGE_EPSILON
        ? "recommendations"
        : progress >= SECOND_TURN_END - PAGE_TURN_EDGE_EPSILON
          ? "workbench"
          : progress >= FIRST_TURN_END - PAGE_TURN_EDGE_EPSILON
            ? "experience"
            : "foreword";
      finishTurnVisual(settledChapter);
    };

    const onScroll = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(updateFromScroll);
    };
    const measureAfterUserIntent = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(updateFromScroll);
    };
    const cancelSettleOnWheelIntent = () => {
      cancelTurnSettle();
      measureAfterUserIntent();
    };
    const cancelSettleOnTouchStart = () => cancelTurnSettle();
    const cancelSettleOnScrollKey = (event: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
      cancelTurnSettle();
      measureAfterUserIntent();
    };
    updateFromScroll();
    const recommendationScroller = recommendationScrollRef.current;
    recommendationScroller?.addEventListener("scroll", syncStoryFromRecommendationScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", cancelSettleOnWheelIntent, { passive: true });
    window.addEventListener("touchstart", cancelSettleOnTouchStart, { passive: true });
    window.addEventListener("touchend", measureAfterUserIntent, { passive: true });
    window.addEventListener("keydown", cancelSettleOnScrollKey);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", cancelSettleOnWheelIntent);
      window.removeEventListener("touchstart", cancelSettleOnTouchStart);
      window.removeEventListener("touchend", measureAfterUserIntent);
      window.removeEventListener("keydown", cancelSettleOnScrollKey);
      recommendationScroller?.removeEventListener("scroll", syncStoryFromRecommendationScroll);
      cancelTurnSettle();
      if (recommendationSyncFrame !== null) window.cancelAnimationFrame(recommendationSyncFrame);
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [cancelTurnSettle, ensureChapterPrinted, finishTurnVisual, isMobileLayout, scrollStoryTo, setChapterImmediately, setTurnVisual, startDirectorySeek]);

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
      if (!account.authenticated && !(isOffline && hasLocalAccountAccess)) {
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

    if (isOffline) {
      setExplanationError("当前离线，未找到这次选择的已有解释。联网后可生成新的查词结果。");
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
  }, [account.authenticated, hasLocalAccountAccess, isOffline, openLogin, refreshAccount, showHint, tokenById]);

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
    if (!requireLocalAccount("登录后才能使用生词本；登录时会把本机已有词条补充到账号中。")) return;
    setMenuOpen(false);
    setVocabularyEntries(getVocabularyEntries());
    setVocabularyError("");
    setVocabularyOpen(true);
  }

  function handleAddToVocabulary() {
    if (!requireLocalAccount("登录后才能把词条加入生词本并跨设备同步。")) return;
    if (!explanation || !selectedContext) return;
    setVocabularyEntries(addVocabularyEntry(createVocabularyEntry(explanation, selectedContext)));
  }

  function isStandaloneDictionaryInVocabulary(result: DictionaryResult): boolean {
    const identity = vocabularyIdentity({
      word: result.direction === "cn_to_en" ? result.lemma : result.query,
      sourceSentence: "",
    });
    return vocabularyEntries.some((entry) => vocabularyIdentity(entry) === identity);
  }

  function handleAddStandaloneDictionaryToVocabulary(result: DictionaryResult) {
    if (!requireLocalAccount("登录后才能把独立查词结果加入生词本并跨设备同步。")) return;
    setVocabularyEntries(addVocabularyEntry(createStandaloneVocabularyEntry(result)));
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
    if (coverProgressRef.current < .998) {
      pendingDirectoryTargetRef.current = { target: "workbench" };
      scrollStoryTo(FOREWORD_SCROLL_POSITION);
      return;
    }
    startDirectorySeek("workbench", WORKBENCH_SCROLL_POSITION);
  }

  function scrollToExperience() {
    setMenuOpen(false);
    if (coverProgressRef.current < .998) {
      pendingDirectoryTargetRef.current = { target: "experience" };
      scrollStoryTo(FOREWORD_SCROLL_POSITION);
      return;
    }
    startDirectorySeek("experience", EXPERIENCE_SCROLL_POSITION);
  }

  function scrollToForeword() {
    setMenuOpen(false);
    pendingDirectoryTargetRef.current = null;
    if (coverProgressRef.current < .998) {
      ensureChapterPrinted("foreword");
      scrollStoryTo(FOREWORD_SCROLL_POSITION);
      return;
    }
    startDirectorySeek("foreword", FOREWORD_SCROLL_POSITION);
  }

  function scrollToCover() {
    setMenuOpen(false);
    pendingDirectoryTargetRef.current = null;
    if (coverProgressRef.current <= .002) {
      scrollStoryTo(0);
      return;
    }
    if (chapterRef.current === "foreword") {
      closeBook();
      return;
    }
    startDirectorySeek("foreword", FOREWORD_SCROLL_POSITION, true);
  }

  function scrollToRecommendations() {
    setMenuOpen(false);
    if (coverProgressRef.current < .998) {
      pendingDirectoryTargetRef.current = { target: "recommendations" };
      scrollStoryTo(FOREWORD_SCROLL_POSITION);
      return;
    }
    startDirectorySeek("recommendations", RECOMMENDATION_SCROLL_POSITION);
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
          href="/"
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
            ariaControls="home-option-menu"
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
                aria-hidden={!isMobileLayout && chapter !== "foreword"}
                inert={!isMobileLayout && chapter !== "foreword"}
              >
                <section className={`${styles.page} ${styles.leftPage} ${styles.forewordBlank}`} aria-hidden="true" />
                <div className={styles.spine} aria-hidden="true"><i /></div>
                <section className={`${styles.page} ${styles.rightPage} ${styles.forewordPage}`} aria-labelledby="book-foreword-heading">
                  <div
                    className={`${styles.forewordContent} ${styles.chapterReveal} ${revealPhaseClass(revealPhases.foreword)} ${revealPhases.foreword === "revealing" ? styles.forewordContentVisible : ""} ${revealPhases.foreword === "printed" ? styles.forewordContentPrinted : ""}`}
                    data-foreword-content
                    data-page-reveal-state={revealPhases.foreword}
                  >
                  <div className={styles.pageNumber} data-foreword-reveal-part data-page-reveal-part>Foreword · 01</div>
                  <p className={styles.sectionLabel} data-foreword-reveal-part data-page-reveal-part>开发者的话</p>
                  <h1 id="book-foreword-heading" aria-label={FOREWORD_SEGMENTS[0]}>
                    {FOREWORD_TITLE_LINES.map((line, lineIndex) => {
                      const precedingGlyphs = FOREWORD_TITLE_LINES
                        .slice(0, lineIndex)
                        .reduce((total, titleLine) => total + titleLine.length, 0);
                      return (
                        <span key={line} className={styles.forewordTitleLine} aria-hidden="true">
                          {Array.from(line).map((glyph, glyphIndex) => (
                            <span
                              key={`${glyph}-${glyphIndex}`}
                              className={styles.forewordTitleGlyph}
                              data-foreword-reveal-part
                              data-page-reveal-part
                              style={{ animationDelay: `${115 + (precedingGlyphs + glyphIndex) * 52}ms` }}
                            >
                              {glyph}
                            </span>
                          ))}
                        </span>
                      );
                    })}
                  </h1>
                  <div className={styles.forewordCopy}>
                    {FOREWORD_SEGMENTS.slice(1, 4).map((segment, offset) => (
                      <p key={segment} style={{ animationDelay: `${790 + offset * 145}ms` }}>
                        <span data-foreword-reveal-part data-page-reveal-part>{segment}</span>
                      </p>
                    ))}
                  </div>
                  <div className={styles.developerSignature}>
                    <span data-foreword-reveal-part data-page-reveal-part>{FOREWORD_SEGMENTS[4]}</span>
                    <strong data-foreword-reveal-part data-page-reveal-part data-foreword-signature>{FOREWORD_SEGMENTS[5]}</strong>
                  </div>
                  </div>
                </section>
              </div>

              <div
                ref={(element) => { spreadRefs.current.experience = element; }}
                data-book-spread="experience"
                className={`${styles.experienceSpread} ${styles.spreadLayer} ${chapter === "experience" ? styles.spreadActive : styles.spreadInactive}`}
                aria-hidden={!isMobileLayout && chapter !== "experience"}
                inert={!isMobileLayout && chapter !== "experience"}
              >
                <section className={`${styles.page} ${styles.leftPage} ${styles.experienceArticlePage}`} aria-labelledby="book-demo-heading">
                  <div
                    className={`${styles.chapterReveal} ${revealPhaseClass(revealPhases.experience)}`}
                    data-page-reveal-state={revealPhases.experience}
                  >
                    <div className={styles.pageNumber} data-page-reveal-part style={revealOrder(0)}>Reading · 02</div>
                    <div className={styles.demoHeader} data-page-reveal-part style={revealOrder(1)}>
                      <div>
                        <p className={styles.sectionLabel}>真实划词体验</p>
                        <h1 id="book-demo-heading">不止一个词，也划过一段表达</h1>
                      </div>
                      <span className={styles.demoStatus}>可交互</span>
                    </div>

                    <article className={styles.demoArticle} aria-label="可划词的英文短文" data-pointer-mask data-page-reveal-part style={revealOrder(2)}>
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

                    <div className={styles.demoInstruction} aria-live="polite" data-page-reveal-part style={revealOrder(3)}>
                      {showHint ? (
                        <span><i aria-hidden="true" />点一个词，或从左向右划过 2–8 个词</span>
                      ) : (
                        <span>当前选择：<strong>{selectedContext.word}</strong></span>
                      )}
                      <button type="button" onClick={() => onOpenDemoArticle(DEMO_IMPORTED_ARTICLE)}>在阅读器中继续</button>
                    </div>
                  </div>
                </section>

                <div className={styles.spine} aria-hidden="true"><i /></div>

                <section className={`${styles.page} ${styles.rightPage} ${styles.contextExplanationPage}`} aria-labelledby="book-context-heading">
                  <div
                    className={`${styles.chapterReveal} ${revealPhaseClass(revealPhases.experience)}`}
                    data-page-reveal-state={revealPhases.experience}
                  >
                    <div className={styles.pageNumber} data-page-reveal-part style={revealOrder(4)}>Context · 03</div>
                    <header className={styles.contextPageHeader} data-page-reveal-part style={revealOrder(5)}>
                      <p className={styles.sectionLabel}>语境解释</p>
                      <h2 id="book-context-heading">把表达放回它的句子里。</h2>
                      <p>左页的选择会在这里展开，解释词义，也保留它在当前语境里的作用。</p>
                    </header>
                    <div ref={explanationShellRef} className={`${styles.explanationShell} ${styles.experienceExplanationShell}`} data-pointer-mask data-page-reveal-part style={revealOrder(6)}>
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
                  </div>
                </section>
              </div>

              <div
                ref={(element) => { spreadRefs.current.workbench = element; }}
                data-book-spread="workbench"
                className={`${styles.workbenchSpread} ${styles.spreadLayer} ${chapter === "workbench" ? styles.spreadActive : styles.spreadInactive}`}
                aria-hidden={!isMobileLayout && chapter !== "workbench"}
                inert={!isMobileLayout && chapter !== "workbench"}
              >
                <section ref={workbenchRef} tabIndex={-1} className={`${styles.page} ${styles.leftPage} ${styles.articleEntryPage}`} aria-labelledby="book-workbench-heading">
                  <div
                    className={`${styles.chapterReveal} ${revealPhaseClass(revealPhases.workbench)}`}
                    data-page-reveal-state={revealPhases.workbench}
                  >
                    <div className={styles.pageNumber} data-page-reveal-part style={revealOrder(0)}>Start · 04</div>
                    <div className={styles.workbenchHeader} data-page-reveal-part style={revealOrder(1)}>
                      <p className={styles.sectionLabel}>阅读起点</p>
                      <h2 id="book-workbench-heading">带一篇文章来。</h2>
                      <p>粘贴英文文章或输入公开网址，直接进入阅读器。</p>
                    </div>

                    {latestSavedArticle && (
                      <button
                        className={styles.continueReading}
                        type="button"
                        onClick={() => onOpenSavedArticle(latestSavedArticle)}
                        disabled={readerTransitioning}
                        data-page-reveal-part
                        style={revealOrder(2)}
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

                    <div className={`${styles.inputModes} ${styles.articleInputModes}`} role="tablist" aria-label="选择文章导入方式" data-page-reveal-part style={revealOrder(3)}>
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

                    <div className={styles.entryModeArea} data-page-reveal-part style={revealOrder(4)}>
                      <div className={styles.modePanel} hidden={inputMode !== "paste"} inert={inputMode !== "paste"}>
                        <form className={styles.articleForm} onSubmit={(event) => { event.preventDefault(); onStartReading(); }}>
                          <label htmlFor="book-home-article">英文文章</label>
                          <ClearableField value={article} onClear={() => onArticleChange("")} label="清空粘贴文章" multiline>
                            <textarea
                              id="book-home-article"
                              value={article}
                              onChange={(event) => onArticleChange(event.target.value)}
                              placeholder="Paste an English article here…"
                              maxLength={120000}
                            />
                          </ClearableField>
                          <div className={styles.formFooter}>
                            <span>{article.trim() ? `${article.trim().split(/\s+/).length} 词` : "支持短文与长文章"}</span>
                            <button type="submit" disabled={!article.trim() || readerTransitioning}>打开文章</button>
                          </div>
                          {error && <p className={styles.formError} role="alert">{error}</p>}
                        </form>
                      </div>
                      <div className={styles.modePanel} hidden={inputMode !== "url"} inert={inputMode !== "url"}>
                        <form className={styles.urlForm} onSubmit={(event) => { event.preventDefault(); onImportUrl(); }}>
                          <label htmlFor="book-home-url">公开文章网址</label>
                          <div>
                            <ClearableField className={styles.urlInputField} value={articleUrl} onClear={() => onArticleUrlChange("")} label="清空文章网址">
                              <input
                                id="book-home-url"
                                type="url"
                                inputMode="url"
                                value={articleUrl}
                                onChange={(event) => onArticleUrlChange(event.target.value)}
                                placeholder="https://example.com/article"
                                autoComplete="url"
                              />
                            </ClearableField>
                            <button type="submit" disabled={!articleUrl.trim() || importingUrl || readerTransitioning}>
                              {importingUrl ? "正在读取…" : "读取网址"}
                            </button>
                          </div>
                          <p>会保留可读取的正文结构和原文配图；部分网站可能限制抓取。</p>
                          {urlError && <p className={styles.formError} role="alert">{urlError}</p>}
                        </form>
                      </div>
                    </div>
                  </div>
                </section>

                <div className={styles.spine} aria-hidden="true"><i /></div>

                <section className={`${styles.page} ${styles.rightPage} ${styles.dictionaryPage}`} aria-labelledby="book-dictionary-heading">
                  <div
                    className={`${styles.chapterReveal} ${revealPhaseClass(revealPhases.workbench)}`}
                    data-page-reveal-state={revealPhases.workbench}
                  >
                    <div className={styles.pageNumber} data-page-reveal-part style={revealOrder(5)}>Dictionary · 05</div>
                    <div className={`${styles.workbenchHeader} ${styles.dictionaryHeader}`} data-page-reveal-part style={revealOrder(6)}>
                      <p className={styles.sectionLabel}>独立查词</p>
                      <h2 id="book-dictionary-heading">单独查一个词或短语。</h2>
                      <p>输入英文看中文释义，输入中文看可用的英文表达。</p>
                    </div>
                    <div className={styles.dictionaryStage} data-page-reveal-part style={revealOrder(7)}>
                      <BookDictionary
                        compact
                        offline={isOffline}
                        onAddToVocabulary={handleAddStandaloneDictionaryToVocabulary}
                        isInVocabulary={isStandaloneDictionaryInVocabulary}
                      />
                    </div>
                    <div className={styles.workbenchFoot} data-page-reveal-part style={revealOrder(8)}>
                      <button type="button" onClick={scrollToExperience}>返回划词体验</button>
                    </div>
                  </div>
                </section>
              </div>

              <div
                ref={(element) => { spreadRefs.current.recommendations = element; }}
                data-book-spread="recommendations"
                className={`${styles.recommendationSpread} ${styles.spreadLayer} ${chapter === "recommendations" ? styles.spreadActive : styles.spreadInactive}`}
                aria-hidden={!isMobileLayout && chapter !== "recommendations"}
                inert={!isMobileLayout && chapter !== "recommendations"}
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
                  scrollContainerRef={recommendationScrollRef}
                  onOpenArticle={onOpenPublicArticle}
                  onPrefetchArticle={onPrefetchPublicArticle}
                />
                <div className={`${styles.spine} ${styles.recommendationSpine}`} aria-hidden="true"><i /></div>
              </div>

              {!isMobileLayout && <CurvedPageTurn ref={pageTurnRef} active={turning} direction={turnDirection} />}
              {!isMobileLayout && (
                <CurvedPageTurn
                  ref={coverTurnRef}
                  active={coverState === "opening" || coverState === "closing"}
                  direction={coverState === "closing" ? "backward" : "forward"}
                  mode="cover"
                />
              )}

              <button
                  ref={coverAssemblyRef}
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
                      <span ref={coverFaceRef} className={styles.coverFace}>
                        <span className={styles.coverBallpit} aria-hidden="true">
                          {!isMobileLayout && (
                            <Ballpit
                              className={styles.coverBallpitCanvas}
                              count={90}
                              gravity={0}
                              driftSpeed={0.012}
                              friction={0.983}
                              wallBounce={0.95}
                              colors={COVER_BALLPIT_COLORS}
                              followCursor
                              showCursorBall={false}
                            />
                          )}
                        </span>
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

              {showMobileDesktopHint && (
                <aside className={styles.mobileDesktopHint} aria-label="电脑端体验提示">
                  <p><strong>手机端专注流畅阅读。</strong>电脑端可体验完整书页动效与更宽工具区。</p>
                  <button
                    type="button"
                    onClick={() => {
                      window.localStorage.setItem(MOBILE_DESKTOP_HINT_KEY, "1");
                      setShowMobileDesktopHint(false);
                    }}
                  >
                    知道了
                  </button>
                </aside>
              )}
            </div>
          </div>

          <div className={styles.stageGuidance} aria-live="polite">
            {coverState === "closed" && <><strong>点击封面或向下滚动，打开这本书</strong><span>向上滚动可以重新合上封面</span></>}
            {coverState === "opening" && <><strong>正在打开阅读空间</strong><span>封面像纸页一样弯曲，落定后内容开始显现</span></>}
            {coverState === "closing" && <><strong>正在合上这本书</strong><span>书页、纸芯与封面会连续回到原位</span></>}
            {coverState === "open" && chapter === "foreword" && <><strong>开发者的话</strong><span>继续向下翻页，进入真实划词体验</span></>}
            {coverState === "open" && chapter === "experience" && <><strong>划词体验</strong><span>左页选择表达，右页查看完整语境解释</span></>}
            {coverState === "open" && chapter === "workbench" && <><strong>开始阅读</strong><span>左页导入文章，右页可以随时单独查词</span></>}
            {coverState === "open" && chapter === "recommendations" && <><strong>推荐文章</strong><span>点击整篇文章，从图片连续展开进入阅读器</span></>}
          </div>

          <nav className={styles.chapterRail} aria-label="书本目录">
            <button type="button" aria-current={coverState === "closed" ? "step" : undefined} onClick={scrollToCover}><i />封面</button>
            <button type="button" aria-current={coverState === "open" && chapter === "foreword" ? "step" : undefined} onClick={scrollToForeword}><i />开发者的话</button>
            <button type="button" aria-current={coverState === "open" && chapter === "experience" ? "step" : undefined} onClick={scrollToExperience}><i />划词体验</button>
            <button type="button" aria-current={coverState === "open" && chapter === "workbench" ? "step" : undefined} onClick={scrollToWorkbench}><i />开始阅读</button>
            <button type="button" aria-current={coverState === "open" && chapter === "recommendations" ? "step" : undefined} onClick={scrollToRecommendations}><i />推荐文章</button>
          </nav>
        </div>
      </section>

      <HomeOptionMenu
        open={menuOpen}
        isAdmin={account.plan?.id === "admin"}
        account={account}
        isOffline={isOffline}
        localAccount={localAccount}
        savedArticles={hasLocalAccountAccess ? savedArticles : []}
        vocabularyEntries={hasLocalAccountAccess ? vocabularyEntries : []}
        onClose={() => setMenuOpen(false)}
        onOpenSavedArticle={onOpenSavedArticle}
        onJumpToVocabularySource={onJumpToVocabularySource}
        canJumpToVocabularySource={canJumpToVocabularySource}
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

      <a
        className={styles.icpLink}
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noreferrer"
      >
        蜀ICP备2026045148号-1
      </a>

      <div className={styles.readerTransitionStatus} aria-live="polite">
        {readerTransitioning ? "正在展开为阅读器…" : openingPublicArticleId ? "正在打开文章…" : ""}
      </div>
    </main>
  );
}
