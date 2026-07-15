"use client";

import Link from "next/link";
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
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { VocabularyPanel } from "@/components/VocabularyPanel";
import { useAccount } from "@/components/AccountProvider";
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
import type { PublicArticle } from "@/types/publicArticle";
import type { ReaderToken, WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";
import styles from "./BookHome.module.css";

const BOOK_OPENED_KEY = "context-reader:book-home-opened:2026-07-book-space-v3";
const DEMO_HINT_KEY = "context-reader:book-demo-hint-seen:v1";

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
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverVisible, setCoverVisible] = useState(true);
  const [fastOpen, setFastOpen] = useState(false);
  const [clientReady, setClientReady] = useState(false);
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
  const workbenchRef = useRef<HTMLElement | null>(null);
  const dictionaryRef = useRef<HTMLDivElement | null>(null);
  const recommendationRef = useRef<HTMLDivElement | null>(null);
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
    const hasOpened = window.localStorage.getItem(BOOK_OPENED_KEY) === "1";
    setFastOpen(hasOpened);
    setShowHint(window.localStorage.getItem(DEMO_HINT_KEY) !== "1");
    const openTimer = window.setTimeout(() => {
      setCoverOpen(true);
      window.localStorage.setItem(BOOK_OPENED_KEY, "1");
    }, hasOpened ? 90 : 170);
    const settleTimer = window.setTimeout(() => setCoverVisible(false), hasOpened ? 1120 : 2180);
    setVocabularyEntries(getVocabularyEntries());
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(settleTimer);
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
    workbenchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function scrollToSection(target: "dictionary" | "recommendations") {
    setMenuOpen(false);
    const ref = target === "dictionary" ? dictionaryRef : recommendationRef;
    window.setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  return (
    <main className={`${styles.root} ${readerTransitioning ? styles.readerEntering : ""}`}>
      <BookLetterField paused={coverVisible || readerTransitioning || menuOpen || vocabularyOpen || feedbackOpen} />
      <div className={styles.ambient} aria-hidden="true">
        <span>context</span>
        <span>meaning</span>
        <span>read</span>
      </div>

      <header className={styles.topbar}>
        <Link className={styles.brand} href="/home-v2" aria-label="Context Reader 书本主页">
          <span className={styles.brandMark}>CR</span>
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

      <section className={styles.stage} aria-label="Context Reader 书本工作台">
        <div className={`${styles.bookShell} ${coverOpen ? styles.open : ""} ${fastOpen ? styles.fast : ""}`}>
          <div className={styles.book}>
            <section className={`${styles.page} ${styles.leftPage}`} aria-labelledby="book-demo-heading">
              <div className={styles.pageNumber}>Context note · 01</div>
              <div className={styles.demoHeader}>
                <div>
                  <p className={styles.sectionLabel}>真实划词体验</p>
                  <h1 id="book-demo-heading">读懂词，也读懂它在这里的意思。</h1>
                </div>
                <span className={styles.demoStatus}>可交互</span>
              </div>

              <article className={styles.demoArticle} aria-label="可划词的英文短文">
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

              <div className={styles.explanationShell}>
                {clientReady ? (
                  <ExplanationPanel
                    explanation={explanation}
                    streamText={explanationStreamText}
                    streaming={explanationStreaming}
                    selectedContext={selectedContext}
                    loading={explanationLoading}
                    error={explanationError}
                    isInVocabulary={isInVocabulary}
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

            <section ref={workbenchRef} className={`${styles.page} ${styles.rightPage}`} aria-labelledby="book-workbench-heading">
              <div className={styles.pageNumber}>Reading desk · 02</div>
              <div className={styles.workbenchHeader}>
                <p className={styles.sectionLabel}>阅读起点</p>
                <h2 id="book-workbench-heading">从你想读的内容开始。</h2>
                <p>粘贴文章或输入公开网址，进入同一个阅读器。</p>
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

              <div className={styles.inputModes} role="tablist" aria-label="选择文章输入方式">
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
              ) : (
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
              )}

              <div className={styles.workbenchFoot}>
                <span>不上传图片，不锁定滚动。</span>
                <button type="button" onClick={() => onOpenDemoArticle(DEMO_IMPORTED_ARTICLE)}>先用左页示例阅读</button>
              </div>
            </section>

            {coverVisible && (
              <div className={styles.cover} aria-hidden="true">
                <div className={styles.coverSpine} />
                <div className={styles.coverFace}>
                  <span className={styles.coverMonogram}>CR</span>
                  <div>
                    <p>Context Reader</p>
                    <h2>Read beyond<br />the word.</h2>
                  </div>
                  <footer>
                    <span>语境英语阅读</span>
                    <span>{fastOpen ? "Welcome back" : "Opening the reading space"}</span>
                  </footer>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div ref={dictionaryRef} className={styles.sectionAnchor}>
        <BookDictionary />
      </div>

      <div ref={recommendationRef} className={styles.sectionAnchor}>
        <BookRecommendations
          articles={publicArticles}
          openingPublicArticleId={openingPublicArticleId}
          readerTransitioning={readerTransitioning}
          onOpenArticle={onOpenPublicArticle}
          onPrefetchArticle={onPrefetchPublicArticle}
        />
      </div>

      <section className={styles.closing} aria-labelledby="book-closing-heading">
        <div>
          <span>Context Reader</span>
          <h2 id="book-closing-heading">下一页，由你选一篇文章开始。</h2>
        </div>
        <p>首页保持有表达力，真正进入阅读器后，背景字母和翻页动效都会退出，让文字安静下来。</p>
        <div>
          <button type="button" onClick={scrollToWorkbench}>粘贴文章或输入网址</button>
          <button type="button" onClick={() => scrollToSection("recommendations")}>浏览推荐文章</button>
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
              <button type="button" onClick={() => scrollToSection("dictionary")}>
                <span>独立深度词典</span><em>查单词或短语</em>
              </button>
              <button type="button" onClick={() => scrollToSection("recommendations")}>
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
