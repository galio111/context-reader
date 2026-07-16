"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnkiSettingsPanel, defaultAnkiSettings } from "@/components/AnkiSettingsPanel";
import { ArticleTranslationPanel } from "@/components/ArticleTranslationPanel";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { VocabularyPanel } from "@/components/VocabularyPanel";
import { WordToken } from "@/components/WordToken";
import { addVocabularyNote, checkAnki } from "@/lib/ankiConnect";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import { findSavedArticle, isValidArticleSummary, saveArticle, saveEditedArticle } from "@/lib/articles";
import {
  createArticleTranslationBlockCacheKey,
  createArticleTranslationCacheKey,
  createExplanationCacheKey,
  getCachedArticleTranslation,
  getCachedArticleTranslationForBlocks,
  getCachedExplanation,
  setCachedExplanation,
} from "@/lib/cache";
import {
  getArticleTranslationJobSnapshot,
  startArticleTranslationJob,
  subscribeArticleTranslationJob,
} from "@/lib/articleTranslationJobs";
import { fetchJson } from "@/lib/apiClient";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { downloadVocabularyCsv } from "@/lib/csv";
import {
  explanationAsStreamText,
  mergeStreamDisplayIntoExplanation,
} from "@/lib/explanationDisplay";
import {
  findBestSourceSentenceMatch,
  findSimilarVocabularyEntry,
  normalizeForSourceMatch,
} from "@/lib/sourceMatching";
import { tokenizeArticle, tokenToWordContext } from "@/lib/tokenizer";
import {
  addVocabularyEntry,
  clearVocabularyEntries,
  createVocabularyEntry,
  deleteVocabularyEntry,
  getVocabularyEntries,
  markVocabularyEntryImported,
  replaceMatchingVocabularyEntry,
  vocabularyIdentity,
} from "@/lib/vocabulary";
import type { AnkiSettings } from "@/types/anki";
import type { ArticleReadingStyle, ImportedArticle, ImportedArticleBlock, ImportedArticleInlineBaseline, ImportedArticleInlineText } from "@/types/article";
import type { PublicExplanation } from "@/types/publicArticle";
import type { ArticleTranslationBlock, ArticleTranslationItem, ReaderToken, WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";
import { useAccount } from "@/components/AccountProvider";

interface ReaderViewProps {
  article: string;
  importedArticle?: ImportedArticle | null;
  preloadedExplanations?: PublicExplanation[];
  sourceSentenceToHighlight?: string;
  sourceWordToHighlight?: string;
  sourceJumpRequestId?: number;
  onBack: () => void;
  backLabel?: string;
  onArticleSaved: () => void;
  onArticleChange?: (article: string, importedArticle: ImportedArticle | null) => void;
  onArticleEditCommit?: (article: string, importedArticle: ImportedArticle | null) => Promise<void> | void;
  onImportedArticleChange?: (article: ImportedArticle) => void;
  onJumpToVocabularySourceOutsideArticle?: (entry: VocabularyEntry) => boolean;
  canJumpToVocabularySourceOutsideArticle?: (entry: VocabularyEntry) => boolean;
}

interface RenderableArticleBlock {
  id: string;
  type: ImportedArticleBlock["type"];
  tokens?: ReaderToken[];
  tokenGroups?: RenderableTokenGroup[];
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  ocrStatus?: ImageOcrStatus;
  ocrError?: string;
  layoutWords?: ImageLayoutWord[];
  layoutError?: string;
}

interface RenderableTokenGroup {
  id: string;
  baseline?: ImportedArticleInlineBaseline;
  tokens: ReaderToken[];
}

interface ImageLayoutWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lineText: string;
}

interface TouchInteraction {
  token: ReaderToken;
  currentToken: ReaderToken;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  cancelled: boolean;
  selecting: boolean;
}

interface ResizeInteraction {
  startY: number;
  startHeight: number;
}

interface ArticleEditSnapshot {
  article: string;
  importedArticle: ImportedArticle | null;
}

type ImageOcrStatus = "idle" | "loading" | "ready" | "error";
type RightPanelMode = "explanation" | "translation";

const IMAGE_OCR_ENABLED = false;
const DEFAULT_ARTICLE_STYLE: Required<ArticleReadingStyle> = {
  fontFamily: "system",
  fontSize: "default",
  lineHeight: "default",
  paragraphSpacing: "default",
  contentWidth: "default",
  imageWidth: "medium",
};

interface ImageOcrState {
  status: ImageOcrStatus;
  text: string;
  error: string;
}

function normalizeArticleStyle(style?: ArticleReadingStyle): Required<ArticleReadingStyle> {
  return {
    ...DEFAULT_ARTICLE_STYLE,
    ...(style ?? {}),
  };
}

function articleTextFromBlocks(blocks: ImportedArticleBlock[]): string {
  return blocks
    .filter((block) => block.type !== "image")
    .map((block) => block.text ?? "")
    .join("\n\n");
}

function createImportedArticleFromBlocks(
  blocks: ImportedArticleBlock[],
  fallbackArticle: string,
  importedArticle: ImportedArticle | null,
  style: ArticleReadingStyle,
): ImportedArticle {
  const text = articleTextFromBlocks(blocks) || fallbackArticle.trim();
  const firstTextBlock = blocks.find((block) => block.type !== "image" && block.text?.trim());
  return {
    title: importedArticle?.title?.trim() || firstTextBlock?.text?.trim().slice(0, 80) || "Edited Article",
    url: importedArticle?.url ?? "",
    siteName: importedArticle?.siteName ?? "",
    text,
    blocks,
    style,
  };
}

function cloneImportedArticle(article: ImportedArticle | null): ImportedArticle | null {
  return article ? JSON.parse(JSON.stringify(article)) as ImportedArticle : null;
}

function consumeFallbackGuestLookup(): boolean {
  if (typeof window === "undefined") return true;
  const key = "context-reader:guest-trial:fallback:v1";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  try {
    const current = JSON.parse(window.localStorage.getItem(key) || "{}") as { day?: string; count?: number };
    const count = current.day === day ? Number(current.count || 0) : 0;
    if (count >= 10) return false;
    window.localStorage.setItem(key, JSON.stringify({ day, count: count + 1 }));
    return true;
  } catch {
    return true;
  }
}

async function requestExplanation(
  context: WordContext,
  signal: AbortSignal,
  actionId: string,
): Promise<WordExplanation> {
  const { response, data } = await fetchJson<{ explanation?: WordExplanation; error?: string }>("/api/explain-word", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-context-action-id": actionId,
    },
    body: JSON.stringify({
      word: context.word,
      sentence: context.sentence,
      previousSentence: context.previousSentence,
      nextSentence: context.nextSentence,
    }),
    signal,
  }, "解释失败，请稍后重试。");

  if (!response.ok) {
    throw new Error(data?.error || "解释失败，请稍后重试。");
  }

  if (!data?.explanation?.anki) {
    throw new Error("解释结果缺少 Anki 制卡字段，请重新点击该词。");
  }

  return data.explanation;
}

async function requestExplanationStream(
  context: WordContext,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  actionId: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/explain-word-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-context-action-id": actionId,
      },
      body: JSON.stringify({
        word: context.word,
        sentence: context.sentence,
        previousSentence: context.previousSentence,
        nextSentence: context.nextSentence,
      }),
      signal,
    });
  } catch {
    return "";
  }

  if (!response.ok || !response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        fullText += chunk;
        onChunk(chunk);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return fullText;
}

function buildEntryText(entry: VocabularyEntry): string {
  const contextMeaningLabel = entry.word.trim().split(/\s+/).filter(Boolean).length > 1
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
  ]
    .filter(Boolean)
    .join("\n");
}

async function requestArticleSummary(article: string): Promise<string> {
  const { response, data } = await fetchJson<{ summary?: string; error?: string }>("/api/summarize-article", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ article }),
  }, "文章摘要生成失败，请稍后重试。");

  if (!response.ok || !data?.summary?.trim()) {
    throw new Error(data?.error || "文章摘要生成失败，请稍后重试。");
  }

  return data.summary.trim();
}

async function requestImageOcr(src: string): Promise<string> {
  const response = await fetch("/api/ocr-image-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: src }),
  });
  const data = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;

  if (!response.ok || !data?.text?.trim()) {
    throw new Error(data?.error || "图片文字识别失败。");
  }

  return data.text.trim();
}

function textBlockClassName(type: ImportedArticleBlock["type"]): string {
  if (type === "heading") {
    return "mb-7 text-[34px] font-semibold leading-[1.12] tracking-normal text-[#1d1d1f] sm:text-[48px] sm:leading-[1.08] lg:text-[56px] lg:leading-[1.07] lg:tracking-[-0.28px]";
  }
  if (type === "subheading") {
    return "mb-4 mt-9 text-[24px] font-semibold leading-[1.24] tracking-normal text-[#1d1d1f] sm:text-[28px] sm:leading-[1.19]";
  }
  if (type === "quote") {
    return "my-7 border-l-2 border-[#0066cc] pl-4 text-[21px] font-light leading-[1.5] tracking-normal text-[#333333] sm:pl-5 sm:text-[24px]";
  }
  if (type === "list-item") {
    return "mb-3 ml-5 list-item text-[17px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]";
  }
  return "mb-6 whitespace-pre-wrap text-[18px] leading-[1.58] tracking-[-0.224px] text-[#1d1d1f] sm:mb-7 sm:text-[20px] sm:leading-[1.6] sm:tracking-[-0.374px]";
}

function inlinePlainText(inline: ImportedArticleInlineText[]): string {
  return inline.map((item) => item.text).join("");
}

function normalizeSentence(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function groupTokensByInline(tokens: ReaderToken[], inline: ImportedArticleInlineText[]): RenderableTokenGroup[] {
  const groups: RenderableTokenGroup[] = [];
  let cursor = 0;

  inline.forEach((item, index) => {
    const start = cursor;
    const end = start + item.text.length;
    const groupTokens = tokens.filter((token) => token.start >= start && token.start < end);
    if (groupTokens.length > 0) {
      groups.push({
        id: `inline-${index}`,
        baseline: item.baseline,
        tokens: groupTokens,
      });
    }
    cursor = end;
  });

  return groups;
}

export function ReaderView({
  article,
  importedArticle,
  preloadedExplanations = [],
  sourceSentenceToHighlight = "",
  sourceWordToHighlight = "",
  sourceJumpRequestId = 0,
  onBack,
  backLabel = "返回首页",
  onArticleSaved,
  onArticleChange,
  onArticleEditCommit,
  onImportedArticleChange,
  onJumpToVocabularySourceOutsideArticle,
  canJumpToVocabularySourceOutsideArticle,
}: ReaderViewProps) {
  const { account, openLogin, requireAccount, refreshAccount } = useAccount();
  const [currentArticle, setCurrentArticle] = useState(article);
  const [currentImportedArticle, setCurrentImportedArticle] = useState<ImportedArticle | null>(importedArticle ?? null);
  const [editingArticle, setEditingArticle] = useState(false);
  const [draftPlainArticle, setDraftPlainArticle] = useState("");
  const [draftBlocks, setDraftBlocks] = useState<ImportedArticleBlock[]>([]);
  const [editStatus, setEditStatus] = useState("");
  const [savingArticleEdit, setSavingArticleEdit] = useState(false);
  const [articleUndoStack, setArticleUndoStack] = useState<ArticleEditSnapshot[]>([]);
  const [articleRedoStack, setArticleRedoStack] = useState<ArticleEditSnapshot[]>([]);
  const articleUndoStackRef = useRef<ArticleEditSnapshot[]>([]);
  const articleRedoStackRef = useRef<ArticleEditSnapshot[]>([]);
  const articleHistoryRef = useRef<ArticleEditSnapshot[]>([]);
  const articleHistoryIndexRef = useRef(0);
  const [imageOcr, setImageOcr] = useState<Record<string, ImageOcrState>>({});
  const [activeImageBlockId, setActiveImageBlockId] = useState<string | null>(null);
  const [activeImageZoom, setActiveImageZoom] = useState(1);
  const [activeImageZoomOrigin, setActiveImageZoomOrigin] = useState({ x: 50, y: 50 });
  const paragraphs = useMemo(
    () => (currentImportedArticle?.blocks?.length
      ? []
      : tokenizeArticle(currentArticle)),
    [currentArticle, currentImportedArticle?.blocks?.length],
  );
  const effectiveImportedArticle = useMemo<ImportedArticle | null>(() => {
    if (!currentImportedArticle?.blocks?.length) {
      return currentImportedArticle ?? null;
    }

    return {
      ...currentImportedArticle,
      blocks: currentImportedArticle.blocks.map((block) => {
        if (block.type !== "image") {
          return block;
        }
        const recognizedText = IMAGE_OCR_ENABLED ? imageOcr[block.id]?.text || block.ocrText || "" : "";
        return {
          ...block,
          ...(recognizedText ? { ocrText: recognizedText } : {}),
        };
      }),
    };
  }, [imageOcr, currentImportedArticle]);
  const renderableBlocks = useMemo<RenderableArticleBlock[]>(() => {
    if (!effectiveImportedArticle?.blocks?.length) {
      return paragraphs.map((paragraph) => ({
        id: paragraph.id,
        type: "paragraph",
        tokens: paragraph.tokens,
      }));
    }

    let textBlockIndex = 0;
    return effectiveImportedArticle.blocks
      .map((block): RenderableArticleBlock | null => {
        if (block.type === "image") {
          const ocrState = imageOcr[block.id];
          const ocrText = IMAGE_OCR_ENABLED ? ocrState?.text || block.ocrText?.trim() || "" : "";
          const tokenized = ocrText ? tokenizeArticle(ocrText)[0] : null;
          const tokens = tokenized
            ? tokenized.tokens.map((token) => ({
                ...token,
                id: `${block.id}-ocr-${token.id}`,
                paragraphIndex: textBlockIndex,
              }))
            : undefined;
          if (tokens) {
            textBlockIndex += 1;
          }
          return {
            id: block.id,
            type: "image",
            src: block.src,
            alt: block.alt,
            width: block.width,
            height: block.height,
            tokens,
            ocrStatus: ocrText ? "ready" : ocrState?.status ?? "idle",
            ocrError: ocrState?.error,
            layoutWords: block.layoutWords,
            layoutError: block.layoutError,
          };
        }

        const text = block.text ?? "";
        if (!text.trim()) {
          textBlockIndex += 1;
          return {
            id: block.id,
            type: block.type,
            tokens: [],
          };
        }

        const tokenized = tokenizeArticle(text)[0];
        const tokens = tokenized.tokens.map((token) => ({
          ...token,
          id: `${block.id}-${token.id}`,
          paragraphIndex: textBlockIndex,
        }));
        const inline = block.inline?.length && inlinePlainText(block.inline) === text ? block.inline : null;
        textBlockIndex += 1;

        return {
          id: block.id,
          type: block.type,
          tokens,
          ...(inline ? { tokenGroups: groupTokensByInline(tokens, inline) } : {}),
        };
      })
      .filter((block): block is RenderableArticleBlock => Boolean(block));
  }, [effectiveImportedArticle, imageOcr, paragraphs]);
  const wordTokens = useMemo(
    () => renderableBlocks.flatMap((block) => block.tokens?.filter((token) => token.type === "word") ?? []),
    [renderableBlocks],
  );
  const translationBlocks = useMemo<ArticleTranslationBlock[]>(
    () => createArticleTranslationBlocks(currentArticle, effectiveImportedArticle),
    [currentArticle, effectiveImportedArticle],
  );
  const translationSourceKey = useMemo(
    () => createArticleTranslationCacheKey(translationBlocks),
    [translationBlocks],
  );
  const tokenById = useMemo(
    () => new Map(wordTokens.map((token) => [token.id, token])),
    [wordTokens],
  );
  const wordTokensByParagraph = useMemo(() => {
    const tokensByParagraph = new Map<number, ReaderToken[]>();
    for (const token of wordTokens) {
      const tokens = tokensByParagraph.get(token.paragraphIndex) ?? [];
      tokens.push(token);
      tokensByParagraph.set(token.paragraphIndex, tokens);
    }
    return tokensByParagraph;
  }, [wordTokens]);
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  const selectedTokenIdSet = useMemo(() => new Set(selectedTokenIds), [selectedTokenIds]);
  const [highlightedSourceSentence, setHighlightedSourceSentence] = useState(sourceSentenceToHighlight);
  const [highlightedTargetTokenIds, setHighlightedTargetTokenIds] = useState<string[]>([]);
  const highlightedTargetTokenIdSet = useMemo(() => new Set(highlightedTargetTokenIds), [highlightedTargetTokenIds]);
  const highlightedSentenceTokenIdSet = useMemo(() => {
    const normalizedSourceSentence = normalizeForSourceMatch(highlightedSourceSentence);
    if (!normalizedSourceSentence) {
      return new Set<string>();
    }
    return new Set(
      wordTokens
        .filter((token) => normalizeForSourceMatch(token.sentence) === normalizedSourceSentence)
        .map((token) => token.id),
    );
  }, [highlightedSourceSentence, wordTokens]);
  const sourceSentenceSet = useMemo(
    () => new Set(wordTokens.map((token) => normalizeForSourceMatch(token.sentence)).filter(Boolean)),
    [wordTokens],
  );
  const [dragStartToken, setDragStartToken] = useState<ReaderToken | null>(null);
  const [dragCurrentToken, setDragCurrentToken] = useState<ReaderToken | null>(null);
  const [selectedContext, setSelectedContext] = useState<WordContext | null>(null);
  const [explanation, setExplanation] = useState<WordExplanation | null>(null);
  const [explanationStreamText, setExplanationStreamText] = useState("");
  const [explanationStreaming, setExplanationStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [vocabularyOpen, setVocabularyOpen] = useState(false);
  const [vocabularyEntries, setVocabularyEntries] = useState<VocabularyEntry[]>([]);
  const [ankiSettings, setAnkiSettings] = useState<AnkiSettings>(defaultAnkiSettings());
  const [ankiStatus, setAnkiStatus] = useState("");
  const [checkingAnki, setCheckingAnki] = useState(false);
  const [importingId, setImportingId] = useState("");
  const [importError, setImportError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [savingArticle, setSavingArticle] = useState(false);
  const [mobileExplanationOpen, setMobileExplanationOpen] = useState(false);
  const [mobileExplanationHeight, setMobileExplanationHeight] = useState(50);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("explanation");
  const [articleTranslations, setArticleTranslations] = useState<ArticleTranslationItem[]>([]);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [translationRequested, setTranslationRequested] = useState(false);
  const [translationEstimatedSecondsRemaining, setTranslationEstimatedSecondsRemaining] = useState<number | null>(null);
  const [staleTranslationBlockIds, setStaleTranslationBlockIds] = useState<string[]>([]);
  const [removedTranslationCount, setRemovedTranslationCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const activeExplanationKeyRef = useRef("");
  const suppressNextClickRef = useRef(false);
  const touchInteractionRef = useRef<TouchInteraction | null>(null);
  const touchSelectTimerRef = useRef<number | null>(null);
  const resizeInteractionRef = useRef<ResizeInteraction | null>(null);
  const propagatedImportedArticleRef = useRef("");
  const plainArticleEditRef = useRef<HTMLDivElement | null>(null);
  const importedArticleEditRef = useRef<HTMLDivElement | null>(null);
  const activeImageScrollRef = useRef<HTMLDivElement | null>(null);
  const sourceAlignmentTargetIdRef = useRef("");
  const sourceAlignmentLockUntilRef = useRef(0);
  const blockEditRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setCurrentArticle(article);
    setCurrentImportedArticle(importedArticle ?? null);
    if (articleHistoryRef.current.length === 0) {
      articleHistoryRef.current = [
        {
          article,
          importedArticle: cloneImportedArticle(importedArticle ?? null),
        },
      ];
      articleHistoryIndexRef.current = 0;
      articleUndoStackRef.current = [];
      articleRedoStackRef.current = [];
      setArticleUndoStack([]);
      setArticleRedoStack([]);
    }
  }, [article, importedArticle]);

  useEffect(() => {
    const refreshVocabularyEntries = () => setVocabularyEntries(getVocabularyEntries());
    refreshVocabularyEntries();
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabularyEntries);
    return () => window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshVocabularyEntries);
  }, []);

  useEffect(() => {
    if (!activeImageBlockId) {
      return;
    }
    setActiveImageZoom(1);
    setActiveImageZoomOrigin({ x: 50, y: 50 });
    activeImageScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeImageBlockId]);

  useEffect(() => {
    function applyTranslationSnapshot(snapshot: {
      translations: ArticleTranslationItem[];
      loading: boolean;
      error: string;
      requested: boolean;
      estimatedSecondsRemaining: number | null;
    }) {
      setArticleTranslations(snapshot.translations);
      setTranslationLoading(snapshot.loading);
      setTranslationError(snapshot.error);
      setTranslationRequested(snapshot.requested);
      setTranslationEstimatedSecondsRemaining(snapshot.estimatedSecondsRemaining);
      if (!snapshot.loading && !snapshot.error) {
        setStaleTranslationBlockIds([]);
        setRemovedTranslationCount(0);
      }
    }

    const runningSnapshot = getArticleTranslationJobSnapshot(translationSourceKey);
    if (runningSnapshot) {
      applyTranslationSnapshot(runningSnapshot);
      setStaleTranslationBlockIds([]);
      setRemovedTranslationCount(0);
    } else {
      const exactBlockTranslations = getCachedArticleTranslationForBlocks(translationBlocks);
      const exactTranslationIds = new Set(exactBlockTranslations.map((item) => item.id));
      const currentById = new Map(articleTranslations.map((item) => [item.id, item.translation]));
      const currentBlockIds = new Set(translationBlocks.map((block) => block.id));
      const removedCount = articleTranslations.filter((item) => !currentBlockIds.has(item.id)).length;
      const staleTranslations = translationBlocks
        .filter((block) => !exactTranslationIds.has(block.id) && currentById.has(block.id))
        .map((block) => ({ id: block.id, translation: currentById.get(block.id) ?? "" }))
        .filter((item) => item.translation.trim());
      const staleIds = staleTranslations.map((item) => item.id);
      const mergedTranslations = [
        ...exactBlockTranslations,
        ...staleTranslations,
      ];
      const cached = mergedTranslations.length > 0 ? mergedTranslations : getCachedArticleTranslation(translationSourceKey);
      setArticleTranslations(cached ?? []);
      setStaleTranslationBlockIds(staleIds);
      setRemovedTranslationCount(removedCount);
      setTranslationError("");
      setTranslationLoading(false);
      setTranslationRequested(Boolean(cached));
      setTranslationEstimatedSecondsRemaining(null);
    }

    return subscribeArticleTranslationJob(translationSourceKey, applyTranslationSnapshot);
  }, [translationSourceKey, translationBlocks]);

  useEffect(() => {
    for (const item of preloadedExplanations) {
      setCachedExplanation(item.cacheKey, item.explanation);
    }
  }, [preloadedExplanations]);

  function targetTokenIdsInSentence(sourceSentence: string, selectedText: string): string[] {
    const normalizedSentence = normalizeForSourceMatch(sourceSentence);
    const targetTerms = normalizeForSourceMatch(selectedText).match(/[a-z]+(?:['-][a-z]+)*/g) ?? [];
    if (!normalizedSentence || targetTerms.length === 0) {
      return [];
    }

    const sentenceTokens = wordTokens.filter(
      (token) => normalizeForSourceMatch(token.sentence) === normalizedSentence,
    );
    const sentenceTerms = sentenceTokens.map(
      (token) => normalizeForSourceMatch(token.value).match(/[a-z]+(?:['-][a-z]+)*/)?.[0] ?? "",
    );

    for (let index = 0; index <= sentenceTerms.length - targetTerms.length; index += 1) {
      if (targetTerms.every((term, offset) => sentenceTerms[index + offset] === term)) {
        return sentenceTokens.slice(index, index + targetTerms.length).map((token) => token.id);
      }
    }
    return [];
  }

  function alignSourceToken(tokenId: string) {
    if (typeof document === "undefined") {
      return false;
    }

    const selector = `[data-token-id="${CSS.escape(tokenId)}"]`;
    const tokenElement = document.querySelector<HTMLElement>(selector);
    if (!tokenElement) {
      return false;
    }
    const blockElement = tokenElement.closest<HTMLElement>("[data-reader-block]");
    if (blockElement) {
      blockElement.style.contentVisibility = "visible";
    }
    sourceAlignmentTargetIdRef.current = tokenId;
    sourceAlignmentLockUntilRef.current = Date.now() + 8000;
    for (const image of document.querySelectorAll<HTMLImageElement>("[data-reader-image]")) {
      if (image.compareDocumentPosition(tokenElement) & Node.DOCUMENT_POSITION_FOLLOWING) {
        image.loading = "eager";
      }
    }
    tokenElement.scrollIntoView({
      behavior: "instant",
      block: "center",
      inline: "nearest",
    });
    window.requestAnimationFrame(() => {
      tokenElement.scrollIntoView({
        behavior: "instant",
        block: "center",
        inline: "nearest",
      });
    });
    return true;
  }

  function preserveSourceAlignmentAfterImageLayout(image: HTMLImageElement) {
    if (Date.now() > sourceAlignmentLockUntilRef.current || !sourceAlignmentTargetIdRef.current) {
      return;
    }
    const targetElement = document.querySelector<HTMLElement>(
      `[data-token-id="${CSS.escape(sourceAlignmentTargetIdRef.current)}"]`,
    );
    if (
      !targetElement ||
      !(image.compareDocumentPosition(targetElement) & Node.DOCUMENT_POSITION_FOLLOWING)
    ) {
      return;
    }
    targetElement.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
    window.requestAnimationFrame(() => {
      targetElement.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
    });
  }

  function scrollToSourceSentence(sourceSentence: string, selectedText = "") {
    const normalizedSourceSentence = normalizeForSourceMatch(sourceSentence);
    if (!normalizedSourceSentence) {
      return false;
    }

    const firstToken = wordTokens.find((token) => normalizeForSourceMatch(token.sentence) === normalizedSourceSentence);
    if (!firstToken || typeof document === "undefined") {
      return false;
    }

    setHighlightedSourceSentence(sourceSentence);
    const targetTokenIds = targetTokenIdsInSentence(firstToken.sentence, selectedText);
    setHighlightedTargetTokenIds(targetTokenIds);
    return alignSourceToken(targetTokenIds[0] ?? firstToken.id);
  }

  function scrollToBestSourceSentence(sourceSentence: string, selectedText: string): boolean {
    if (scrollToSourceSentence(sourceSentence, selectedText)) {
      return true;
    }

    const similarMatch = findBestSourceSentenceMatch(sourceSentence, selectedText, wordTokens);
    if (!similarMatch || typeof document === "undefined") {
      return false;
    }

    setHighlightedSourceSentence(similarMatch.sentence);
    const targetTokenIds = targetTokenIdsInSentence(similarMatch.sentence, selectedText);
    setHighlightedTargetTokenIds(targetTokenIds);
    return alignSourceToken(targetTokenIds[0] ?? similarMatch.token.id);
  }

  function scrollToVocabularyEntrySource(entry: VocabularyEntry): boolean {
    return scrollToBestSourceSentence(entry.sourceSentence, entry.word);
  }

  function canJumpToSourceSentence(sourceSentence: string): boolean {
    return sourceSentenceSet.has(normalizeForSourceMatch(sourceSentence));
  }

  useLayoutEffect(() => {
    if (!sourceSentenceToHighlight) {
      return;
    }
    let cancelled = false;
    let attempts = 0;

    function performPendingJump() {
      if (cancelled || scrollToBestSourceSentence(sourceSentenceToHighlight, sourceWordToHighlight)) {
        return;
      }
      attempts += 1;
      if (attempts < 12) {
        window.requestAnimationFrame(performPendingJump);
      }
    }

    performPendingJump();
    return () => {
      cancelled = true;
    };
  }, [sourceSentenceToHighlight, sourceWordToHighlight, sourceJumpRequestId, wordTokens]);

  useEffect(() => {
    if (!IMAGE_OCR_ENABLED || !effectiveImportedArticle?.blocks?.length || !onImportedArticleChange) {
      return;
    }

    const hasRecognizedImageText = effectiveImportedArticle.blocks.some(
      (block) => block.type === "image" && Boolean(block.ocrText?.trim()),
    );
    if (!hasRecognizedImageText) {
      return;
    }

    const signature = JSON.stringify(
      effectiveImportedArticle.blocks.map((block) => ({
        id: block.id,
        ocrText: block.type === "image" ? block.ocrText ?? "" : "",
      })),
    );
    if (signature === propagatedImportedArticleRef.current) {
      return;
    }

    propagatedImportedArticleRef.current = signature;
    onImportedArticleChange(effectiveImportedArticle);
  }, [effectiveImportedArticle, onImportedArticleChange]);

  useEffect(() => {
    if (!IMAGE_OCR_ENABLED || !currentImportedArticle?.blocks?.length) {
      return;
    }

    const imageBlocks = currentImportedArticle.blocks.filter((block) => block.type === "image" && block.src);
    for (const block of imageBlocks) {
      if (!block.src || block.ocrText?.trim() || imageOcr[block.id]) {
        continue;
      }

      setImageOcr((current) => ({
        ...current,
        [block.id]: {
          status: "loading",
          text: "",
          error: "",
        },
      }));

      void requestImageOcr(block.src)
        .then((text) => {
          setImageOcr((current) => ({
            ...current,
            [block.id]: {
              status: "ready",
              text,
              error: "",
            },
          }));
        })
        .catch((ocrError) => {
          setImageOcr((current) => ({
            ...current,
            [block.id]: {
              status: "error",
              text: "",
              error: ocrError instanceof Error ? ocrError.message : "图片文字识别失败。",
            },
          }));
        });
    }
  }, [imageOcr, currentImportedArticle]);

  useEffect(() => {
    if (!activeImageBlockId) {
      return;
    }

    setActiveImageZoom(1);
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveImageBlockId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", preventActiveImagePageWheel, { capture: true, passive: false });
    const scrollElement = activeImageScrollRef.current;
    scrollElement?.addEventListener("wheel", handleActiveImageNativeWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", preventActiveImagePageWheel, { capture: true });
      scrollElement?.removeEventListener("wheel", handleActiveImageNativeWheel);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [activeImageBlockId]);

  const savedCurrentArticle = findSavedArticle(currentArticle);
  const articleSaved = Boolean(savedCurrentArticle);
  const articleSummaryReady = Boolean(
    savedCurrentArticle?.summary?.trim() && isValidArticleSummary(savedCurrentArticle.summary),
  );

  function getTokenRange(startToken: ReaderToken, endToken: ReaderToken): ReaderToken[] {
    if (startToken.paragraphIndex !== endToken.paragraphIndex) {
      return [startToken];
    }

    const startIndex = Math.min(startToken.tokenIndex, endToken.tokenIndex);
    const endIndex = Math.max(startToken.tokenIndex, endToken.tokenIndex);

    return (wordTokensByParagraph.get(startToken.paragraphIndex) ?? []).filter(
      (token) =>
        token.paragraphIndex === startToken.paragraphIndex &&
        token.tokenIndex >= startIndex &&
        token.tokenIndex <= endIndex,
    );
  }

  function createRangeContext(tokens: ReaderToken[]): WordContext {
    const firstToken = tokens[0];
    const phrase = tokens.map((token) => token.value).join(" ");

    return {
      word: phrase,
      paragraphIndex: firstToken.paragraphIndex,
      tokenIndex: firstToken.tokenIndex,
      sentence: firstToken.sentence,
      previousSentence: firstToken.previousSentence,
      nextSentence: firstToken.nextSentence,
    };
  }

  const exactVocabularyMatch =
    explanation && selectedContext
      ? vocabularyEntries.find(
          (entry) =>
            vocabularyIdentity(entry) ===
            vocabularyIdentity({
              word: explanation.word,
              sourceSentence: selectedContext.sentence,
            }),
        ) ?? null
      : null;
  const similarVocabularyMatch =
    !exactVocabularyMatch && explanation && selectedContext
      ? findSimilarVocabularyEntry(vocabularyEntries, explanation.word, selectedContext.sentence)
      : null;
  const isInVocabulary = Boolean(exactVocabularyMatch || similarVocabularyMatch);
  const vocabularyMatchNotice =
    similarVocabularyMatch
      ? "已找到同词的相近生词条。原句可能被编辑过；点击 ↻ 重新生成可更新原生词条。"
      : "";

  async function explainContext(
    context: WordContext,
    tokenIds: string[],
    options: { force?: boolean; syncVocabulary?: boolean } = {},
  ) {
    if (!account.authenticated && !account.configured && !consumeFallbackGuestLookup()) {
      setError("今天的 10 次游客试用已用完；账号服务配置完成后即可登录继续。 ");
      openLogin("游客每天可试用 10 次划词解释；登录后可继续查词并同步学习数据。");
      return;
    }
    const cacheKey = createExplanationCacheKey(context.word, context.sentence);

    setSelectedTokenIds(tokenIds);
    setSelectedContext(context);
    setError("");
    setMobileExplanationOpen(true);
    setMobileExplanationHeight(50);
    setRightPanelMode("explanation");

    if (!options.force && loading && activeExplanationKeyRef.current === cacheKey) {
      return;
    }

    abortRef.current?.abort();
    activeExplanationKeyRef.current = "";

    const cached = options.force ? null : getCachedExplanation(cacheKey);
    if (cached) {
      if (!account.authenticated) {
        const cachedUsageResponse = await fetch("/api/usage/cache-lookup", {
          method: "POST",
          headers: { "x-context-action-id": crypto.randomUUID() },
        });
        const cachedUsage = await cachedUsageResponse.json().catch(() => null) as { error?: string } | null;
        if (!cachedUsageResponse.ok) {
          setError(cachedUsage?.error || "游客试用额度记录失败，请登录后继续。");
          openLogin("游客每天可试用 10 次划词解释；登录后可继续阅读并同步学习数据。");
          return;
        }
        void refreshAccount();
      }
      setExplanation(cached);
      setExplanationStreamText(explanationAsStreamText(cached));
      setExplanationStreaming(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const actionId = crypto.randomUUID();
    abortRef.current = controller;
    activeExplanationKeyRef.current = cacheKey;
    setLoading(true);
    setExplanation(null);
    setExplanationStreamText("");
    setExplanationStreaming(true);

    const streamPromise = requestExplanationStream(context, controller.signal, (chunk) => {
      if (!controller.signal.aborted) {
        setExplanationStreamText((current) => `${current}${chunk}`);
      }
    }, actionId).catch(() => "");

    try {
      const [structuredExplanation, completedStreamText] = await Promise.all([
        requestExplanation(context, controller.signal, actionId),
        streamPromise,
      ]);
      const nextExplanation = completedStreamText
        ? mergeStreamDisplayIntoExplanation(structuredExplanation, completedStreamText)
        : structuredExplanation;
      const durableDisplayText = completedStreamText || explanationAsStreamText(nextExplanation);

      setCachedExplanation(cacheKey, nextExplanation);
      setExplanation(nextExplanation);
      setExplanationStreamText(durableDisplayText);
      setExplanationStreaming(false);
      if (options.syncVocabulary) {
        if (account.authenticated) setVocabularyEntries(replaceMatchingVocabularyEntry(nextExplanation, context));
      }
      void refreshAccount();
    } catch (requestError) {
      if (controller.signal.aborted) {
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "解释失败，请稍后重试。");
      if (!account.authenticated && requestError instanceof Error && /登录|游客|额度/.test(requestError.message)) {
        openLogin("游客试用额度已用完，登录后可继续查词并跨设备同步学习数据。");
      }
    } finally {
      if (!controller.signal.aborted) {
        setExplanationStreaming(false);
        setLoading(false);
        if (activeExplanationKeyRef.current === cacheKey) {
          activeExplanationKeyRef.current = "";
        }
      }
    }
  }

  function generateArticleTranslation(force = false) {
    if (!requireAccount("全文翻译需要登录；公开推荐文章中管理员预先发布的翻译仍可直接查看。")) return;
    if ((!force && translationLoading) || translationBlocks.length === 0) {
      return;
    }
    const cacheKey = translationSourceKey;
    if (!force && articleTranslations.length > 0) {
      setRightPanelMode("translation");
      return;
    }
    const cached = force ? null : getCachedArticleTranslation(cacheKey);
    if (cached) {
      setRightPanelMode("translation");
      setArticleTranslations(cached);
      setTranslationError("");
      return;
    }

    setRightPanelMode("translation");
    const blocksToTranslate = translationBlocks;
    void startArticleTranslationJob(cacheKey, blocksToTranslate, {
      force,
      initialTranslations: [],
      allBlocks: translationBlocks,
    });
  }

  function handleRegenerateExplanation() {
    if (!selectedContext || selectedTokenIds.length === 0) {
      return;
    }
    void explainContext(selectedContext, selectedTokenIds, {
      force: true,
      syncVocabulary: true,
    });
  }

  function tokenFromEventTarget(target: EventTarget | null): ReaderToken | null {
    if (!(target instanceof Element)) {
      return null;
    }
    const tokenElement = target.closest<HTMLElement>("[data-token-id]");
    const tokenId = tokenElement?.dataset.tokenId;
    return tokenId ? tokenById.get(tokenId) ?? null : null;
  }

  function tokenFromPoint(x: number, y: number): ReaderToken | null {
    if (typeof document === "undefined") {
      return null;
    }
    return tokenFromEventTarget(document.elementFromPoint(x, y));
  }

  function clearTouchSelectTimer() {
    if (touchSelectTimerRef.current) {
      window.clearTimeout(touchSelectTimerRef.current);
      touchSelectTimerRef.current = null;
    }
  }

  function beginTouchSelection(interaction: TouchInteraction) {
    if (interaction.cancelled || interaction.selecting) {
      return;
    }
    interaction.selecting = true;
    setSelectedTokenIds([interaction.token.id]);
  }

  function handleTokenPointerDown(token: ReaderToken) {
    setDragStartToken(token);
    setDragCurrentToken(token);
    setSelectedTokenIds([token.id]);
  }

  function handleTokenPointerEnter(token: ReaderToken) {
    if (!dragStartToken) {
      return;
    }

    const range = getTokenRange(dragStartToken, token).slice(0, 8);
    setDragCurrentToken(token);
    setSelectedTokenIds(range.map((item) => item.id));
  }

  function handleTokenPointerUp(token: ReaderToken) {
    const startToken = dragStartToken ?? token;
    const currentToken = dragCurrentToken ?? token;
    const range = getTokenRange(startToken, currentToken).slice(0, 8);
    const context = range.length > 1 ? createRangeContext(range) : tokenToWordContext(token);

    setDragStartToken(null);
    setDragCurrentToken(null);
    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 0);
    void explainContext(context, range.map((item) => item.id));
  }

  function handleTokenClick(token: ReaderToken) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    void explainContext(tokenToWordContext(token), [token.id]);
  }

  function handleArticlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (editingArticle) {
      return;
    }
    const token = tokenFromEventTarget(event.target);
    if (token) {
      if (event.pointerType === "touch") {
        touchInteractionRef.current = {
          token,
          currentToken: token,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
          cancelled: false,
          selecting: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        clearTouchSelectTimer();
        touchSelectTimerRef.current = window.setTimeout(() => {
          const interaction = touchInteractionRef.current;
          if (!interaction || interaction.moved) {
            return;
          }
          beginTouchSelection(interaction);
        }, 260);
        return;
      }
      event.preventDefault();
      handleTokenPointerDown(token);
    }
  }

  function handleArticlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (editingArticle) {
      return;
    }
    if (event.pointerType === "touch") {
      const interaction = touchInteractionRef.current;
      if (interaction) {
        if (interaction.cancelled) {
          return;
        }
        const deltaX = event.clientX - interaction.x;
        const deltaY = event.clientY - interaction.y;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);
        const moved =
          absX > 10 ||
          absY > 10;
        if (moved) {
          interaction.moved = true;
        }

        if (!interaction.selecting && absX > 14 && absX > absY * 1.15) {
          clearTouchSelectTimer();
          beginTouchSelection(interaction);
        }

        if (moved && !interaction.selecting && absY > 10 && absY >= absX) {
          clearTouchSelectTimer();
          interaction.cancelled = true;
          return;
        }

        if (!interaction.selecting) {
          return;
        }

        const token = tokenFromPoint(event.clientX, event.clientY);
        if (token && token.paragraphIndex === interaction.token.paragraphIndex) {
          event.preventDefault();
          interaction.currentToken = token;
          const range = getTokenRange(interaction.token, token).slice(0, 8);
          setSelectedTokenIds(range.map((item) => item.id));
        }
      }
      return;
    }

    if (!dragStartToken) {
      return;
    }
    const token = tokenFromEventTarget(event.target);
    if (token) {
      handleTokenPointerEnter(token);
    }
  }

  function handleArticlePointerUp(event: React.PointerEvent<HTMLElement>) {
    if (editingArticle) {
      return;
    }
    const token = tokenFromEventTarget(event.target);
    if (event.pointerType === "touch") {
      clearTouchSelectTimer();
      const interaction = touchInteractionRef.current;
      touchInteractionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!interaction) {
        return;
      }
      if (interaction.cancelled) {
        return;
      }

      const pointToken = tokenFromPoint(event.clientX, event.clientY);
      const finalToken = pointToken?.paragraphIndex === interaction.token.paragraphIndex
        ? pointToken
        : interaction.currentToken;
      const range = getTokenRange(interaction.token, finalToken).slice(0, 8);
      if (interaction.selecting) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
        const context = range.length > 1 ? createRangeContext(range) : tokenToWordContext(interaction.token);
        void explainContext(context, range.length > 0 ? range.map((item) => item.id) : [interaction.token.id]);
        return;
      }

      if (token?.id === interaction.token.id && !interaction.moved) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
        void explainContext(tokenToWordContext(token), [token.id]);
      }
      return;
    }

    if (token) {
      handleTokenPointerUp(token);
    }
  }

  function handleArticleClick(event: React.MouseEvent<HTMLElement>) {
    if (editingArticle) {
      return;
    }
    const token = tokenFromEventTarget(event.target);
    if (token) {
      handleTokenClick(token);
    }
  }

  function handleArticlePointerCancel(event: React.PointerEvent<HTMLElement>) {
    clearTouchSelectTimer();
    touchInteractionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragStartToken(null);
    setDragCurrentToken(null);
  }

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    resizeInteractionRef.current = {
      startY: event.clientY,
      startHeight: mobileExplanationHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleResizePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const interaction = resizeInteractionRef.current;
    if (!interaction || typeof window === "undefined") {
      return;
    }
    const deltaY = interaction.startY - event.clientY;
    const deltaHeight = (deltaY / window.innerHeight) * 100;
    const nextHeight = Math.min(82, Math.max(32, interaction.startHeight + deltaHeight));
    setMobileExplanationHeight(nextHeight);
  }

  function handleResizePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    resizeInteractionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleAddToVocabulary() {
    if (!requireAccount("登录后才能把词条加入生词本并跨设备同步。")) return;
    if (!explanation || !selectedContext) {
      return;
    }

    const entry = createVocabularyEntry(explanation, selectedContext);
    setVocabularyEntries(addVocabularyEntry(entry));
  }

  function handleDeleteVocabulary(id: string) {
    setVocabularyEntries(deleteVocabularyEntry(id));
  }

  function handleOpenVocabulary() {
    if (!requireAccount("登录后才能使用生词本。")) return;
    setVocabularyEntries(getVocabularyEntries());
    setImportError("");
    setAnkiStatus("");
    setVocabularyOpen(true);
  }

  function handleCloseVocabulary() {
    setVocabularyOpen(false);
    setImportError("");
    setImportingId("");
    setAnkiStatus("");
  }

  function handleJumpToVocabularySource(entry: VocabularyEntry) {
    setVocabularyOpen(false);
    setImportError("");
    setImportingId("");
    setAnkiStatus("");
    window.setTimeout(() => {
      if (!scrollToVocabularyEntrySource(entry)) {
        const jumpedOutside = onJumpToVocabularySourceOutsideArticle?.(entry) ?? false;
        if (!jumpedOutside) {
          setImportError("当前文章和已保存文章里没有找到这个词条的原句。");
          setVocabularyOpen(true);
        }
      }
    }, 80);
  }

  function handleClearVocabulary() {
    const entryCount = vocabularyEntries.length;
    const confirmed = window.confirm(
      `将删除生词本中的 ${entryCount} 条词条，此操作无法撤销。\n\n确定要清空生词本吗？`,
    );
    if (!confirmed) {
      return;
    }
    clearVocabularyEntries();
    setVocabularyEntries([]);
  }

  function handleExportCsv() {
    try {
      downloadVocabularyCsv(vocabularyEntries);
    } catch (csvError) {
      setImportError(csvError instanceof Error ? csvError.message : "CSV 导出失败，请稍后重试。");
    }
  }

  async function handleCopyEntry(entry: VocabularyEntry) {
    try {
      await navigator.clipboard.writeText(buildEntryText(entry));
    } catch {
      window.alert("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  function beginArticleEditing() {
    setDraftPlainArticle(currentArticle);
    setDraftBlocks(
      currentImportedArticle?.blocks?.length
        ? currentImportedArticle.blocks.map((block) => ({ ...block }))
        : [],
    );
    setEditingArticle(true);
    setSelectedTokenIds([]);
    setSelectedContext(null);
    abortRef.current?.abort();
    activeExplanationKeyRef.current = "";
    setExplanation(null);
    setExplanationStreamText("");
    setExplanationStreaming(false);
    setError("");
    setEditStatus("");
  }

  function cancelArticleEditing() {
    if (window.confirm("放弃本次文章编辑吗？")) {
      setEditingArticle(false);
      setDraftPlainArticle("");
      setDraftBlocks([]);
      setEditStatus("");
    }
  }

  function updateDraftBlock(id: string, patch: Partial<ImportedArticleBlock>) {
    setDraftBlocks((current) =>
      current.map((block) => {
        if (block.id !== id) {
          return block;
        }
        const next = { ...block, ...patch };
        if (
          "text" in patch &&
          block.inline?.length &&
          patch.text !== inlinePlainText(block.inline)
        ) {
          return { ...next, inline: undefined };
        }
        return next;
      }),
    );
  }

  function articleFromDraftBlocks(blocks: ImportedArticleBlock[]): ArticleEditSnapshot {
    const nextImportedArticle = createImportedArticleFromBlocks(
      blocks,
      currentArticle,
      currentImportedArticle,
      currentImportedArticle?.style ?? DEFAULT_ARTICLE_STYLE,
    );
    return {
      article: nextImportedArticle.text,
      importedArticle: nextImportedArticle,
    };
  }

  function deleteDraftBlock(id: string) {
    const currentBlocks = importedDraftBlocksFromDom();
    const nextBlocks = currentBlocks.filter((block) => block.id !== id);
    setDraftBlocks(nextBlocks);
    pushArticleHistorySnapshot(articleFromDraftBlocks(nextBlocks));
  }

  function editableText(node: HTMLElement | null | undefined): string {
    return (node?.textContent ?? "").replace(/\u00a0/g, " ");
  }

  function plainDraftTextFromDom(): string {
    const root = plainArticleEditRef.current;
    if (!root) {
      return currentArticle;
    }

    const childBlocks = Array.from(root.children)
      .map((child) => editableText(child as HTMLElement));
    return childBlocks.length > 0 ? childBlocks.join("\n") : editableText(root);
  }

  function importedDraftBlocksFromDom(): ImportedArticleBlock[] {
    const root = importedArticleEditRef.current;
    if (!root) {
      return draftBlocks;
    }

    return Array.from(root.children)
      .map((child, index): ImportedArticleBlock | null => {
        const element = child as HTMLElement;
        const blockId = element.dataset.blockId || `edited-block-${Date.now()}-${index}`;
        const blockType = element.dataset.blockType as ImportedArticleBlock["type"] | undefined;
        const originalBlock = draftBlocks.find((block) => block.id === blockId);
        const type = blockType ?? originalBlock?.type ?? "paragraph";

        if (type === "image") {
          const src = element.dataset.src || originalBlock?.src || "";
          if (!src) {
            return null;
          }
          return {
            ...(originalBlock ?? {}),
            id: blockId,
            type: "image",
            src,
            alt: element.dataset.alt ?? originalBlock?.alt ?? "",
          };
        }

        const text = editableText(element);
        if (type === "list-item" && !text.trim()) {
          return null;
        }
        const nextBlock: ImportedArticleBlock = {
          ...(originalBlock ?? {}),
          id: blockId,
          type,
          text,
        };

        if (originalBlock?.inline?.length && text !== inlinePlainText(originalBlock.inline)) {
          return { ...nextBlock, inline: undefined };
        }

        return nextBlock;
      })
      .filter((block): block is ImportedArticleBlock => Boolean(block));
  }

  function normalizeArticleText(value: string): string {
    return value.replace(/\r\n/g, "\n");
  }

  function sameArticleSnapshot(left: ArticleEditSnapshot, right: ArticleEditSnapshot): boolean {
    return (
      normalizeArticleText(left.article) === normalizeArticleText(right.article) &&
      JSON.stringify(left.importedArticle ?? null) === JSON.stringify(right.importedArticle ?? null)
    );
  }

  function snapshotFromEditingSurface(): ArticleEditSnapshot {
    if (!editingArticle) {
      return {
        article: currentArticle,
        importedArticle: cloneImportedArticle(currentImportedArticle),
      };
    }

    if (!currentImportedArticle?.blocks?.length) {
      return {
        article: plainDraftTextFromDom(),
        importedArticle: null,
      };
    }

    const nextBlocks = importedDraftBlocksFromDom();
    const nextImportedArticle = createImportedArticleFromBlocks(
      nextBlocks,
      currentArticle,
      currentImportedArticle,
      currentImportedArticle?.style ?? DEFAULT_ARTICLE_STYLE,
    );
    return {
      article: nextImportedArticle.text,
      importedArticle: nextImportedArticle,
    };
  }

  function hasPendingArticleEditingChanges(): boolean {
    if (!editingArticle) {
      return false;
    }

    return !sameArticleSnapshot(
      snapshotFromEditingSurface(),
      {
        article: currentArticle,
        importedArticle: cloneImportedArticle(currentImportedArticle),
      },
    );
  }

  function syncArticleHistoryButtons(updateRenderedState = true) {
    const index = articleHistoryIndexRef.current;
    articleUndoStackRef.current = articleHistoryRef.current.slice(0, index);
    articleRedoStackRef.current = articleHistoryRef.current.slice(index + 1);
    if (updateRenderedState) {
      setArticleUndoStack([...articleUndoStackRef.current]);
      setArticleRedoStack([...articleRedoStackRef.current]);
    }
  }

  function pushArticleHistorySnapshot(snapshot: ArticleEditSnapshot, updateRenderedState = true) {
    const history = articleHistoryRef.current;
    const index = articleHistoryIndexRef.current;
    const currentSnapshot = history[index];

    if (currentSnapshot && sameArticleSnapshot(currentSnapshot, snapshot)) {
      return;
    }

    articleHistoryRef.current = [
      ...history.slice(0, index + 1),
      {
        article: snapshot.article,
        importedArticle: cloneImportedArticle(snapshot.importedArticle),
      },
    ];
    articleHistoryIndexRef.current = articleHistoryRef.current.length - 1;
    syncArticleHistoryButtons(updateRenderedState);
  }

  function handleArticleEditInput() {
    // The browser owns the live contentEditable DOM. Updating React state for
    // every keystroke can make React reconcile that DOM while the selection is
    // changing, which occasionally moves the caret or the edited paragraph.
    // Keep history in refs while typing and render button state only at an
    // explicit editing boundary (undo, redo, save, or block deletion).
    pushArticleHistorySnapshot(snapshotFromEditingSurface(), false);
  }

  function handleImportedArticleEditKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }

    const target = event.target as HTMLElement | null;
    const blockElement = target?.closest<HTMLElement>("[data-block-id]");
    if (!blockElement || blockElement.dataset.blockType === "image") {
      return;
    }
    if (editableText(blockElement).trim()) {
      return;
    }

    event.preventDefault();
    deleteDraftBlock(blockElement.dataset.blockId || "");
  }

  async function commitExternalArticleEdit(snapshot: ArticleEditSnapshot): Promise<boolean> {
    if (!onArticleEditCommit) {
      return true;
    }
    setSavingArticleEdit(true);
    setEditStatus("正在同步文章修改...");
    try {
      await onArticleEditCommit(snapshot.article, snapshot.importedArticle);
      setEditStatus("文章修改已同步");
      window.setTimeout(() => setEditStatus(""), 2200);
      return true;
    } catch (error) {
      setEditStatus(error instanceof Error ? error.message : "文章修改同步失败，请重试。");
      return false;
    } finally {
      setSavingArticleEdit(false);
    }
  }

  async function applyArticleSnapshot(snapshot: ArticleEditSnapshot): Promise<boolean> {
    if (!(await commitExternalArticleEdit(snapshot))) {
      return false;
    }
    saveEditedArticle(currentArticle, snapshot.article, snapshot.importedArticle);
    setCurrentArticle(snapshot.article);
    setCurrentImportedArticle(snapshot.importedArticle);
    if (editingArticle) {
      setDraftPlainArticle(snapshot.article);
      setDraftBlocks(snapshot.importedArticle?.blocks?.length
        ? snapshot.importedArticle.blocks.map((block) => ({ ...block }))
        : []);
    }
    onArticleChange?.(snapshot.article, snapshot.importedArticle);
    if (snapshot.importedArticle) {
      onImportedArticleChange?.(snapshot.importedArticle);
    }
    onArticleSaved();
    return true;
  }

  async function undoSavedArticleEdit() {
    const currentSnapshot = snapshotFromEditingSurface();
    const currentHistorySnapshot = articleHistoryRef.current[articleHistoryIndexRef.current];
    if (currentHistorySnapshot && !sameArticleSnapshot(currentHistorySnapshot, currentSnapshot)) {
      pushArticleHistorySnapshot(currentSnapshot);
    }

    const previousIndex = articleHistoryIndexRef.current - 1;
    const previous = articleHistoryRef.current[previousIndex];
    if (!previous) {
      return;
    }
    if (!(await applyArticleSnapshot(previous))) {
      return;
    }
    articleHistoryIndexRef.current = previousIndex;
    syncArticleHistoryButtons();
  }

  async function redoSavedArticleEdit() {
    const nextIndex = articleHistoryIndexRef.current + 1;
    const next = articleHistoryRef.current[nextIndex];
    if (!next) {
      return;
    }
    if (!(await applyArticleSnapshot(next))) {
      return;
    }
    articleHistoryIndexRef.current = nextIndex;
    syncArticleHistoryButtons();
  }

  function recordSavedArticleEditUndo() {
    pushArticleHistorySnapshot(snapshotFromEditingSurface());
  }

  async function saveArticleEditing(): Promise<boolean> {
    if (!currentImportedArticle?.blocks?.length) {
      const nextArticle = plainDraftTextFromDom();
      if (!nextArticle.trim()) {
        setEditStatus("至少保留一段英文正文。");
        return false;
      }
      if (nextArticle.replace(/\r\n/g, "\n") === currentArticle.replace(/\r\n/g, "\n")) {
        setEditingArticle(false);
        setDraftPlainArticle("");
        setDraftBlocks([]);
        setEditStatus("");
        return true;
      }
      if (!(await commitExternalArticleEdit({ article: nextArticle, importedArticle: null }))) {
        return false;
      }
      recordSavedArticleEditUndo();
      saveEditedArticle(currentArticle, nextArticle, null);
      setCurrentArticle(nextArticle);
      setCurrentImportedArticle(null);
      onArticleChange?.(nextArticle, null);
      onArticleSaved();
      setEditingArticle(false);
      setDraftPlainArticle("");
      setDraftBlocks([]);
      setEditStatus("");
      return true;
    }

    const normalizedBlocks = importedDraftBlocksFromDom();
    const hasText = normalizedBlocks.some((block) => block.type !== "image" && block.text?.trim());
    if (!hasText) {
      setEditStatus("至少保留一段英文正文。");
      return false;
    }
    const blocksUnchanged = JSON.stringify(
      normalizedBlocks.map((block) => [block.id, block.type, block.text ?? "", block.src ?? "", block.alt ?? ""]),
    ) === JSON.stringify(
      currentImportedArticle.blocks.map((block) => [block.id, block.type, block.text ?? "", block.src ?? "", block.alt ?? ""]),
    );
    if (blocksUnchanged) {
      setEditingArticle(false);
      setDraftPlainArticle("");
      setDraftBlocks([]);
      setEditStatus("");
      return true;
    }

    const nextImportedArticle = createImportedArticleFromBlocks(
      normalizedBlocks,
      currentArticle,
      currentImportedArticle,
      currentImportedArticle?.style ?? DEFAULT_ARTICLE_STYLE,
    );
    if (!(await commitExternalArticleEdit({ article: nextImportedArticle.text, importedArticle: nextImportedArticle }))) {
      return false;
    }
    recordSavedArticleEditUndo();
    saveEditedArticle(currentArticle, nextImportedArticle.text, nextImportedArticle);
    setCurrentArticle(nextImportedArticle.text);
    setCurrentImportedArticle(nextImportedArticle);
    onArticleChange?.(nextImportedArticle.text, nextImportedArticle);
    onImportedArticleChange?.(nextImportedArticle);
    onArticleSaved();
    setEditingArticle(false);
    setDraftPlainArticle("");
    setDraftBlocks([]);
    setEditStatus("");
    return true;
  }

  async function handleBackToHome() {
    if (!editingArticle) {
      onBack();
      return;
    }

    const shouldSave = window.confirm("是否保存当前文章修改后返回？\n\n确定：保存并返回\n取消：不保存，直接返回");
    if (shouldSave && hasPendingArticleEditingChanges() && !(await saveArticleEditing())) {
      return;
    }

    onBack();
  }

  async function handleCopyArticle() {
    try {
      await navigator.clipboard.writeText(currentArticle);
      setSaveStatus("文章内容已复制");
      window.setTimeout(() => setSaveStatus(""), 1800);
    } catch {
      setSaveStatus("复制文章失败，请检查浏览器剪贴板权限。");
      window.setTimeout(() => setSaveStatus(""), 2600);
    }
  }

  async function handleCheckAnki() {
    setCheckingAnki(true);
    setAnkiStatus("");
    try {
      const version = await checkAnki(ankiSettings.endpoint);
      setAnkiStatus(`连接成功，AnkiConnect version: ${version}`);
    } catch (checkError) {
      setAnkiStatus(checkError instanceof Error ? checkError.message : "AnkiConnect 检测失败。");
    } finally {
      setCheckingAnki(false);
    }
  }

  async function handleImportAnki(entry: VocabularyEntry) {
    if (entry.anki.ankiNoteId) {
      setImportError("这个词条已经导入过 Anki，不会重复导入。");
      return;
    }

    setImportingId(entry.id);
    setImportError("");
    try {
      const ankiNoteId = await addVocabularyNote(entry, ankiSettings.deckName, ankiSettings.endpoint);
      setVocabularyEntries(markVocabularyEntryImported(entry.id, ankiNoteId));
    } catch (ankiError) {
      setImportError(ankiError instanceof Error ? ankiError.message : "导入 Anki 失败，请稍后重试。");
    } finally {
      setImportingId("");
    }
  }

  async function handleImportAllAnki() {
    const unimportedEntries = vocabularyEntries.filter((entry) => !entry.anki.ankiNoteId);
    if (unimportedEntries.length === 0) {
      setImportError("没有未导入的词条。");
      return;
    }

    setImportingId("__all__");
    setImportError("");

    let importedCount = 0;
    try {
      for (const entry of unimportedEntries) {
        const ankiNoteId = await addVocabularyNote(entry, ankiSettings.deckName, ankiSettings.endpoint);
        const nextEntries = markVocabularyEntryImported(entry.id, ankiNoteId);
        setVocabularyEntries(nextEntries);
        importedCount += 1;
      }
    } catch (ankiError) {
      const message = ankiError instanceof Error ? ankiError.message : "批量导入 Anki 失败，请稍后重试。";
      setImportError(
        importedCount > 0 ? `已导入 ${importedCount} 个词条，随后失败：${message}` : message,
      );
    } finally {
      setImportingId("");
    }
  }

  async function handleSaveArticle() {
    if (!requireAccount("登录后才能保存文章；登录时会先合并本机已有数据。")) return;
    setSavingArticle(true);
    setSaveStatus("正在保存文章...");
    let articleStored = false;
    try {
      saveArticle(currentArticle, "", effectiveImportedArticle);
      articleStored = true;
      onArticleSaved();
      setSaveStatus("文章已保存，正在生成中文摘要...");

      const summary = await requestArticleSummary(currentArticle);
      saveArticle(currentArticle, summary, effectiveImportedArticle);
      onArticleSaved();
      setSaveStatus("文章已保存");
    } catch (summaryError) {
      const message = summaryError instanceof Error ? summaryError.message : "文章摘要生成失败，请稍后重试。";
      setSaveStatus(articleStored ? `文章已保存；${message}` : message);
    } finally {
      setSavingArticle(false);
      window.setTimeout(() => setSaveStatus(""), 2600);
    }
  }

  const saveButtonText = savingArticle
    ? "保存中"
    : articleSaved
      ? articleSummaryReady ? "重新生成首页摘要" : "生成首页摘要"
      : "保存文章";
  const hasExplanationPanelContent = Boolean(selectedContext || loading || explanation || error);
  const activeArticleStyle = DEFAULT_ARTICLE_STYLE;
  const articleShellClassName = [
    "mx-auto overflow-x-hidden break-words [overflow-wrap:anywhere]",
    editingArticle ? "select-text" : "select-none touch-pan-y",
    activeArticleStyle.contentWidth === "narrow" ? "max-w-2xl" : activeArticleStyle.contentWidth === "wide" ? "max-w-4xl" : "max-w-3xl",
    activeArticleStyle.fontFamily === "serif" ? "font-serif" : activeArticleStyle.fontFamily === "mono" ? "font-mono" : "font-sans",
  ].join(" ");
  const paragraphStyle = {
    "--reader-body-size": activeArticleStyle.fontSize === "small" ? "17px" : activeArticleStyle.fontSize === "large" ? "21px" : activeArticleStyle.fontSize === "xlarge" ? "23px" : "20px",
    "--reader-body-line": activeArticleStyle.lineHeight === "compact" ? "1.45" : activeArticleStyle.lineHeight === "relaxed" ? "1.78" : "1.6",
    "--reader-paragraph-space": activeArticleStyle.paragraphSpacing === "compact" ? "1rem" : activeArticleStyle.paragraphSpacing === "relaxed" ? "2rem" : "1.75rem",
  } as CSSProperties;
  const imageWidthClassName = activeArticleStyle.imageWidth === "small" ? "mx-auto max-w-md" : activeArticleStyle.imageWidth === "full" ? "max-w-none" : "mx-auto max-w-3xl";
  const activeImageBlock = useMemo(
    () => renderableBlocks.find((block) => block.type === "image" && block.id === activeImageBlockId) ?? null,
    [activeImageBlockId, renderableBlocks],
  );
  const activeImageLayout = useMemo(() => {
    if (!activeImageBlock) {
      return { status: "idle" as const, words: [], error: "" };
    }
    if (activeImageBlock.layoutWords?.length) {
      return { status: "ready" as const, words: activeImageBlock.layoutWords, error: "" };
    }
    if (activeImageBlock.layoutError) {
      return { status: "error" as const, words: [], error: activeImageBlock.layoutError };
    }
    return { status: "idle" as const, words: [], error: "" };
  }, [activeImageBlock]);
  const ACTIVE_IMAGE_MIN_ZOOM = 0.5;
  const ACTIVE_IMAGE_MAX_ZOOM = 3;
  const activeImageZoomPercent = Math.round(activeImageZoom * 100);

  function changeActiveImageZoom(delta: number) {
    setActiveImageZoomOrigin({ x: 50, y: 50 });
    setActiveImageZoom((current) => Math.min(ACTIVE_IMAGE_MAX_ZOOM, Math.max(ACTIVE_IMAGE_MIN_ZOOM, Number((current + delta).toFixed(2)))));
  }

  function zoomActiveImageAt(deltaY: number, clientX?: number, clientY?: number) {
    const container = activeImageScrollRef.current;
    if (container && typeof clientX === "number" && typeof clientY === "number") {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setActiveImageZoomOrigin({
          x: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
          y: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
        });
      }
    }

    const multiplier = deltaY < 0 ? 1.14 : 1 / 1.14;

    setActiveImageZoom((current) => {
      const next = Math.min(ACTIVE_IMAGE_MAX_ZOOM, Math.max(ACTIVE_IMAGE_MIN_ZOOM, Number((current * multiplier).toFixed(3))));
      if (next === current) {
        return current;
      }

      return next;
    });
  }

  function preventActiveImagePageWheel(event: WheelEvent) {
    if (!activeImageBlockId) {
      return;
    }
    event.preventDefault();
  }

  function handleActiveImageNativeWheel(event: WheelEvent) {
    const container = activeImageScrollRef.current;
    if (!container) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    zoomActiveImageAt(event.deltaY, event.clientX, event.clientY);
  }

  function handleActiveImageWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
  }

  function imageDownloadName(block: RenderableArticleBlock): string {
    const altName = block.alt?.trim().replace(/[\\/:*?"<>|]+/g, "-");
    return altName || `context-reader-image-${block.id}.jpg`;
  }

  function downloadImage(block: RenderableArticleBlock) {
    if (!block.src) {
      return;
    }

    const link = document.createElement("a");
    const filename = imageDownloadName(block);
    link.href = /^https?:\/\//i.test(block.src)
      ? `/api/download-image?url=${encodeURIComponent(block.src)}&filename=${encodeURIComponent(filename)}`
      : block.src;
    link.download = imageDownloadName(block);
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handleImageLayoutWordClick(word: ImageLayoutWord, index: number) {
    const sentence = word.lineText.trim() || word.text;
    const tokenId = `image-layout-${activeImageBlockId ?? "image"}-${index}`;
    setActiveImageBlockId(null);
    void explainContext(
      {
        word: word.text,
        paragraphIndex: -1,
        tokenIndex: index,
        sentence,
        previousSentence: "",
        nextSentence: "",
      },
      [tokenId],
    );
  }

  function renderTokenList(tokens?: ReaderToken[]) {
    return tokens?.map((token) => (
      <WordToken
        key={token.id}
        token={token}
        selected={selectedTokenIdSet.has(token.id)}
        highlighted={highlightedSentenceTokenIdSet.has(token.id)}
        targeted={highlightedTargetTokenIdSet.has(token.id)}
      />
    ));
  }

  function imageOcrStatusText(block: RenderableArticleBlock): string {
    if (block.ocrStatus === "loading") {
      return "正在识别图片文字...";
    }
    if (block.ocrStatus === "ready") {
      return "图片文字可划词";
    }
    if (block.ocrStatus === "error") {
      return block.ocrError || "图片文字识别暂不可用";
    }
    return "等待图片文字识别";
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f5f5f7] text-[#1d1d1f]">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-black/10 bg-[#f5f5f7]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-5">
          <button
            type="button"
            className="h-9 rounded-full border border-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
            onClick={() => void handleBackToHome()}
            disabled={savingArticleEdit}
          >
            {backLabel}
          </button>
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {editStatus && <span className="shrink-0 text-sm text-[#333333]">{editStatus}</span>}
            {saveStatus && <span className="shrink-0 text-sm text-[#333333]">{saveStatus}</span>}
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#0066cc] text-lg leading-none text-[#0066cc] transition hover:border-[#004f9f] hover:bg-[#f5f9ff] hover:text-[#004f9f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/25 active:scale-95 disabled:cursor-not-allowed disabled:border-[#d2d2d7] disabled:text-[#86868b] disabled:hover:bg-transparent"
              onClick={() => void undoSavedArticleEdit()}
              disabled={savingArticleEdit || (!editingArticle && articleUndoStack.length === 0)}
              aria-label="后退"
              title="后退"
            >
              ←
            </button>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#0066cc] text-lg leading-none text-[#0066cc] transition hover:border-[#004f9f] hover:bg-[#f5f9ff] hover:text-[#004f9f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/25 active:scale-95 disabled:cursor-not-allowed disabled:border-[#d2d2d7] disabled:text-[#86868b] disabled:hover:bg-transparent"
              onClick={() => void redoSavedArticleEdit()}
              disabled={savingArticleEdit || (!editingArticle && articleRedoStack.length === 0)}
              aria-label="前进"
              title="前进"
            >
              →
            </button>
            {editingArticle ? (
              <>
                <button
                  type="button"
                  className="h-9 shrink-0 rounded-full border border-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
                  onClick={cancelArticleEditing}
                  disabled={savingArticleEdit}
                >
                  取消编辑
                </button>
                <button
                  type="button"
                  className="h-9 shrink-0 rounded-full bg-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-white transition active:scale-95"
                  onClick={() => void saveArticleEditing()}
                  disabled={savingArticleEdit}
                >
                  {savingArticleEdit ? "保存中..." : "保存编辑"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="h-9 shrink-0 rounded-full border border-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
                onClick={beginArticleEditing}
              >
                编辑文章
              </button>
            )}
            <button
              type="button"
              className="hidden h-9 shrink-0 rounded-full border border-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-[#0066cc] transition active:scale-95 lg:inline-flex lg:items-center"
              onClick={handleCopyArticle}
              disabled={editingArticle}
            >
              复制文章内容
            </button>
            <button
              type="button"
              className="h-9 shrink-0 rounded-full border border-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-[#0066cc] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#d2d2d7] disabled:text-[#7a7a7a]"
              onClick={handleSaveArticle}
              disabled={savingArticle || savingArticleEdit || editingArticle}
            >
              {saveButtonText}
            </button>
            <button
              type="button"
              className="h-9 shrink-0 rounded-full bg-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-white transition active:scale-95"
              onClick={handleOpenVocabulary}
            >
              生词本
            </button>
          </div>
        </div>
      </header>

      <div
        className={`mx-auto grid max-w-7xl gap-5 overflow-x-hidden px-0 pt-20 sm:px-5 lg:grid-cols-[minmax(0,1fr)_360px] ${
          hasExplanationPanelContent && mobileExplanationOpen ? "pb-[calc(var(--mobile-sheet-height,50dvh)+2rem)] lg:pb-6" : "pb-6"
        }`}
        style={{ "--mobile-sheet-height": `${mobileExplanationHeight}dvh` } as CSSProperties}
      >
        <article className="min-w-0 overflow-x-hidden rounded-[24px] bg-white px-4 py-7 sm:min-h-[70vh] sm:px-10 sm:py-8 lg:px-16 lg:py-14">
          {currentImportedArticle && (
            <header className="mx-auto mb-10 max-w-3xl border-b border-[#e0e0e0] pb-6">
              <p className="text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                {currentImportedArticle.siteName}
              </p>
              {currentImportedArticle.url && (
                <a
                  className="mt-2 block break-all text-sm leading-5 tracking-[-0.224px] text-[#0066cc]"
                  href={currentImportedArticle.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {currentImportedArticle.url}
                </a>
              )}
            </header>
          )}
          <div
            className={articleShellClassName}
            style={paragraphStyle}
            onPointerDown={handleArticlePointerDown}
            onPointerMove={handleArticlePointerMove}
            onPointerUp={handleArticlePointerUp}
            onPointerCancel={handleArticlePointerCancel}
            onClick={handleArticleClick}
          >
            {editingArticle ? (
              !currentImportedArticle?.blocks?.length ? (
                <div
                  ref={plainArticleEditRef}
                  className="min-h-[65vh] outline-none"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onInput={handleArticleEditInput}
                >
                  {paragraphs.map((paragraph) => (
                    <p
                      key={paragraph.id}
                      className={`${textBlockClassName("paragraph")} min-w-0`}
                    >
                      {paragraph.tokens.map((token) => token.value).join("") || <br />}
                    </p>
                  ))}
                </div>
              ) : (
              <div
                ref={importedArticleEditRef}
                className="min-h-[65vh] outline-none"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onInput={handleArticleEditInput}
                onKeyDown={handleImportedArticleEditKeyDown}
              >
                {draftBlocks.map((block) => {
                  const dataProps = {
                    "data-block-id": block.id,
                    "data-block-type": block.type,
                    "data-src": block.src ?? "",
                    "data-alt": block.alt ?? "",
                  };

                  if (block.type === "image") {
                    return (
                      <figure
                        key={block.id}
                        {...dataProps}
                        className={`group relative my-8 min-w-0 overflow-hidden lg:my-10 ${imageWidthClassName}`}
                        contentEditable={false}
                      >
                        <button
                          type="button"
                          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-xl leading-none text-[#1d1d1f] shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0066cc] active:scale-95"
                          aria-label="删除图片"
                          title="删除图片"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            deleteDraftBlock(block.id);
                          }}
                        >
                          ×
                        </button>
                        {block.src && (
                          <img
                            alt={block.alt || ""}
                            className="h-auto max-h-[65vh] w-full max-w-full rounded-[14px] object-contain sm:max-h-[70vh]"
                            src={block.src}
                          />
                        )}
                        {block.alt && <figcaption className="mt-3 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">{block.alt}</figcaption>}
                      </figure>
                    );
                  }

                  const Tag = block.type === "heading" ? "h1" : block.type === "subheading" ? "h2" : block.type === "quote" ? "blockquote" : "p";
                  return (
                    <Tag
                      key={block.id}
                      {...dataProps}
                      className={`${textBlockClassName(block.type)} min-w-0 outline-none`}
                      suppressContentEditableWarning
                    >
                      {block.text ? block.text : <br />}
                    </Tag>
                  );
                })}
              </div>
              )
            ) : renderableBlocks.map((block) => {
              if (block.type === "image") {
                if (!block.src) {
                  return null;
                }
                return (
                  <figure
                    key={block.id}
                    data-reader-block={block.id}
                    className={`my-8 min-w-0 overflow-hidden lg:my-10 lg:[content-visibility:auto] lg:[contain-intrinsic-size:auto_720px] ${imageWidthClassName}`}
                  >
                    <div className="group relative overflow-hidden rounded-[14px] bg-[#f5f5f7]">
                      <img
                        alt={block.alt || ""}
                        className="h-auto max-h-[65vh] w-full max-w-full object-contain sm:max-h-[70vh]"
                        decoding="async"
                        data-reader-image={block.id}
                        height={block.height}
                        loading="lazy"
                        onError={(event) => preserveSourceAlignmentAfterImageLayout(event.currentTarget)}
                        onLoad={(event) => preserveSourceAlignmentAfterImageLayout(event.currentTarget)}
                        referrerPolicy="no-referrer"
                        sizes="(min-width: 1024px) 768px, calc(100vw - 40px)"
                        src={block.src}
                        width={block.width}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-medium leading-5 text-[#1d1d1f] opacity-95 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0066cc]"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveImageBlockId(block.id);
                        }}
                      >
                        点击放大
                      </button>
                    </div>
                    {block.alt && (
                      <figcaption className="mt-3 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                        {block.alt}
                      </figcaption>
                    )}
                    {IMAGE_OCR_ENABLED && (
                      <div className="mt-3 rounded-[12px] border border-[#e0e0e0] bg-[#fbfbfd] px-4 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-sm font-medium leading-5 text-[#1d1d1f]">图片文字</p>
                          <span className={`shrink-0 text-xs leading-5 ${block.ocrStatus === "error" ? "text-[#b42318]" : "text-[#6e6e73]"}`}>
                            {imageOcrStatusText(block)}
                          </span>
                        </div>
                        {block.tokens?.length ? (
                          <p className="whitespace-pre-wrap text-[16px] leading-7 tracking-normal text-[#1d1d1f]">
                            {renderTokenList(block.tokens)}
                          </p>
                        ) : (
                          <p className="text-sm leading-6 text-[#6e6e73]">
                            暂未识别到可划词的图片文字。
                          </p>
                        )}
                      </div>
                    )}
                  </figure>
                );
              }

              const Tag = block.type === "heading" ? "h1" : block.type === "subheading" ? "h2" : "p";
              return (
                <Tag
                  key={block.id}
                  data-reader-block={block.id}
                  className={`${textBlockClassName(block.type)} min-w-0 lg:[content-visibility:auto] lg:[contain-intrinsic-size:auto_120px]`}
                >
                  {block.tokenGroups?.length
                    ? block.tokenGroups.map((group) => {
                        const content = group.tokens.map((token) => (
                          <WordToken
                            key={token.id}
                            token={token}
                            selected={selectedTokenIdSet.has(token.id)}
                            highlighted={highlightedSentenceTokenIdSet.has(token.id)}
                            targeted={highlightedTargetTokenIdSet.has(token.id)}
                          />
                        ));
                        if (group.baseline === "sup") {
                          return (
                            <sup key={group.id} className="align-super text-[0.68em] leading-none">
                              {content}
                            </sup>
                          );
                        }
                        if (group.baseline === "sub") {
                          return (
                            <sub key={group.id} className="align-sub text-[0.68em] leading-none">
                              {content}
                            </sub>
                          );
                        }
                        return <span key={group.id}>{content}</span>;
                      })
                    : block.tokens?.length
                      ? block.tokens.map((token) => (
                        <WordToken
                          key={token.id}
                          token={token}
                          selected={selectedTokenIdSet.has(token.id)}
                          highlighted={highlightedSentenceTokenIdSet.has(token.id)}
                          targeted={highlightedTargetTokenIdSet.has(token.id)}
                        />
                      ))
                      : <br />}
                </Tag>
              );
            })}
          </div>
        </article>

        <div className="hidden lg:block" aria-hidden="true" />
        <div className="hidden lg:fixed lg:bottom-6 lg:right-[max(1.25rem,calc((100vw-80rem)/2+1.25rem))] lg:top-20 lg:z-20 lg:block lg:w-[360px]">
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="grid h-10 shrink-0 grid-cols-2 rounded-full border border-[#d2d2d7] bg-white p-1">
              <button
                type="button"
                className={`rounded-full text-sm leading-none tracking-[-0.224px] transition ${
                  rightPanelMode === "explanation" ? "bg-[#1d1d1f] text-white" : "text-[#333333] hover:bg-[#f5f5f7]"
                }`}
                onClick={() => setRightPanelMode("explanation")}
              >
                词句解释
              </button>
              <button
                type="button"
                className={`rounded-full text-sm leading-none tracking-[-0.224px] transition ${
                  rightPanelMode === "translation" ? "bg-[#1d1d1f] text-white" : "text-[#333333] hover:bg-[#f5f5f7]"
                }`}
                onClick={() => setRightPanelMode("translation")}
              >
                全文翻译
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <div className={rightPanelMode === "translation" ? "h-full min-h-0" : "hidden h-full min-h-0"}>
                <ArticleTranslationPanel
                  blocks={translationBlocks}
                  translations={articleTranslations}
                  loading={translationLoading}
                  error={translationError}
                  requested={translationRequested}
                  estimatedSecondsRemaining={translationEstimatedSecondsRemaining}
                  staleBlockIds={staleTranslationBlockIds}
                  removedTranslationCount={removedTranslationCount}
                  onGenerate={() => generateArticleTranslation(false)}
                  onRegenerate={() => generateArticleTranslation(true)}
                />
              </div>
              <div className={rightPanelMode === "explanation" ? "h-full min-h-0" : "hidden h-full min-h-0"}>
                <ExplanationPanel
                  explanation={explanation}
                  streamText={explanationStreamText}
                  streaming={explanationStreaming}
                  selectedContext={selectedContext}
                  loading={loading}
                  error={error}
                  isInVocabulary={Boolean(isInVocabulary)}
                  vocabularyMatchNotice={vocabularyMatchNotice}
                  onAddToVocabulary={handleAddToVocabulary}
                  onRegenerate={handleRegenerateExplanation}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeImageBlock?.src && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="放大图片"
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => setActiveImageBlockId(null)}
        >
          <div
            className={`relative grid max-h-[92dvh] w-full min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[18px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)] ${
              IMAGE_OCR_ENABLED ? "max-w-6xl lg:grid-cols-[minmax(0,1fr)_360px]" : "max-w-5xl"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute right-3 top-3 z-10 flex items-center justify-end gap-2">
              <button
                type="button"
                className="h-8 rounded-full bg-white/95 px-3 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b]"
                onClick={() => changeActiveImageZoom(-0.1)}
                disabled={activeImageZoom <= ACTIVE_IMAGE_MIN_ZOOM}
              >
                缩小
              </button>
              <span className="min-w-14 rounded-full bg-white/95 px-3 py-1.5 text-center text-sm leading-none text-[#1d1d1f]">
                {activeImageZoomPercent}%
              </span>
              <button
                type="button"
                className="h-8 rounded-full bg-white/95 px-3 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b]"
                onClick={() => changeActiveImageZoom(0.1)}
                disabled={activeImageZoom >= ACTIVE_IMAGE_MAX_ZOOM}
              >
                放大
              </button>
              <button
                type="button"
                className="h-8 rounded-full bg-white/95 px-3 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b]"
                onClick={() => {
                  setActiveImageZoom(1);
                  setActiveImageZoomOrigin({ x: 50, y: 50 });
                }}
                disabled={activeImageZoom === 1}
              >
                适合
              </button>
              <button
                type="button"
                className="h-8 rounded-full bg-white/95 px-3 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95"
                onClick={() => downloadImage(activeImageBlock)}
              >
                下载
              </button>
              {!IMAGE_OCR_ENABLED && (
                <button
                  type="button"
                  className="h-8 rounded-full bg-white/95 px-3 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95"
                  onClick={() => setActiveImageBlockId(null)}
                >
                  关闭
                </button>
              )}
            </div>
            <div
              ref={activeImageScrollRef}
              className="flex min-h-0 items-center justify-center overflow-hidden bg-[#111111] p-2 pt-14 sm:p-4 sm:pt-14"
              onWheel={handleActiveImageWheel}
            >
              <div
                className="relative flex h-full w-full items-center justify-center"
                style={{
                  transform: `scale(${activeImageZoom})`,
                  transformOrigin: `${activeImageZoomOrigin.x}% ${activeImageZoomOrigin.y}%`,
                  transition: "transform 150ms ease-out",
                  willChange: "transform",
                }}
              >
                <img
                  alt={activeImageBlock.alt || ""}
                  className="max-h-full max-w-full object-contain"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  src={activeImageBlock.src}
                />
                {activeImageLayout.status === "ready" && (
                  <div className="absolute inset-0">
                    {activeImageLayout.words.map((word, index) => (
                      <button
                        key={`${word.text}-${index}-${word.x}-${word.y}`}
                        type="button"
                        aria-label={`解释 ${word.text}`}
                        className="absolute rounded-[3px] border border-transparent bg-[#0066cc]/0 transition hover:border-[#0066cc]/70 hover:bg-[#0066cc]/15 focus-visible:border-[#0066cc] focus-visible:bg-[#0066cc]/18 focus-visible:outline-none"
                        style={{
                          left: `${word.x}%`,
                          top: `${word.y}%`,
                          width: `${word.width}%`,
                          height: `${word.height}%`,
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleImageLayoutWordClick(word, index);
                        }}
                        title={word.text}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            {IMAGE_OCR_ENABLED && (
              <aside className="flex min-h-0 flex-col border-t border-[#e0e0e0] bg-white lg:border-l lg:border-t-0">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e0e0e0] px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-5 text-[#1d1d1f]">图片文字</p>
                    <p className={`mt-0.5 truncate text-xs leading-5 ${activeImageBlock.ocrStatus === "error" ? "text-[#b42318]" : "text-[#6e6e73]"}`}>
                      {imageOcrStatusText(activeImageBlock)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="h-8 shrink-0 rounded-full border border-[#d2d2d7] px-3 text-sm leading-none text-[#1d1d1f] transition hover:border-[#86868b] active:scale-95"
                    onClick={() => setActiveImageBlockId(null)}
                  >
                    关闭
                  </button>
                </div>
                <div
                  className="min-h-0 overflow-auto px-4 py-4"
                  onPointerDown={handleArticlePointerDown}
                  onPointerMove={handleArticlePointerMove}
                  onPointerUp={handleArticlePointerUp}
                  onPointerCancel={handleArticlePointerCancel}
                  onClick={handleArticleClick}
                >
                  {activeImageBlock.tokens?.length ? (
                    <p className="whitespace-pre-wrap text-[18px] leading-8 tracking-normal text-[#1d1d1f]">
                      {renderTokenList(activeImageBlock.tokens)}
                    </p>
                  ) : (
                    <p className="text-sm leading-6 text-[#6e6e73]">
                      暂未识别到可划词的图片文字。
                    </p>
                  )}
                </div>
              </aside>
            )}
          </div>
        </div>
      )}

      {hasExplanationPanelContent && mobileExplanationOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 flex min-h-0 touch-pan-y flex-col overflow-hidden border-t border-gray-200 bg-white p-3 pt-1 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] overscroll-contain lg:hidden"
          style={{ height: `${mobileExplanationHeight}dvh` }}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          <div
            className="flex h-8 shrink-0 touch-none cursor-ns-resize items-center justify-center"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerEnd}
            onPointerCancel={handleResizePointerEnd}
          >
            <span className="h-1.5 w-8 rounded-full bg-[#d2d2d7]" />
          </div>
          <ExplanationPanel
            explanation={explanation}
            streamText={explanationStreamText}
            streaming={explanationStreaming}
            selectedContext={selectedContext}
            loading={loading}
            error={error}
            isInVocabulary={Boolean(isInVocabulary)}
            vocabularyMatchNotice={vocabularyMatchNotice}
            onAddToVocabulary={handleAddToVocabulary}
            onRegenerate={handleRegenerateExplanation}
            onCollapse={() => setMobileExplanationOpen(false)}
          />
        </div>
      )}

      <VocabularyPanel
        entries={vocabularyEntries}
        open={vocabularyOpen}
        importingId={importingId}
        importError={importError}
        onClose={handleCloseVocabulary}
        onDelete={handleDeleteVocabulary}
        onClear={handleClearVocabulary}
        onExportCsv={handleExportCsv}
        onCopy={handleCopyEntry}
        onJumpToSource={handleJumpToVocabularySource}
          canJumpToSource={(entry) =>
          canJumpToSourceSentence(entry.sourceSentence) ||
          Boolean(findBestSourceSentenceMatch(entry.sourceSentence, entry.word, wordTokens)) ||
          Boolean(canJumpToVocabularySourceOutsideArticle?.(entry))
        }
        onImportAnki={handleImportAnki}
        onImportAllAnki={handleImportAllAnki}
      />

      {vocabularyOpen && (
        <div className="fixed left-4 top-20 z-50 hidden w-[min(360px,calc(100vw-2rem))] lg:block">
          <AnkiSettingsPanel
            settings={ankiSettings}
            status={ankiStatus}
            checking={checkingAnki}
            onChange={setAnkiSettings}
            onCheck={handleCheckAnki}
          />
        </div>
      )}
    </main>
  );
}

