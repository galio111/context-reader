"use client";

import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { defaultAnkiSettings } from "@/components/AnkiSettingsPanel";
import { ArticleTranslationPanel } from "@/components/ArticleTranslationPanel";
import { BookDictionary } from "@/components/BookDictionary";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { HomeOptionMenu, type PreviewKind } from "@/components/HomeOptionMenu";
import { PillNavAction } from "@/components/PillNavAction";
import { WordToken } from "@/components/WordToken";
import toolbarStyles from "@/components/ReaderToolbar.module.css";
import loadingStyles from "@/components/ReaderLoading.module.css";
import typographyStyles from "@/components/ReaderTypography.module.css";
import {
  addVocabularyNote,
  checkAnki,
  findImportedVocabularyNoteIds,
} from "@/lib/ankiConnect";
import { createArticleTranslationBlocks } from "@/lib/articleTranslationBlocks";
import { findSavedArticle, saveArticle, saveEditedArticle } from "@/lib/articles";
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
  explanationFromCompletedStream,
  mergeStreamDisplayIntoExplanation,
} from "@/lib/explanationDisplay";
import { EXPLANATION_STREAM_COMPLETE_MARKER } from "@/lib/explanationStreamProtocol";
import { currentFormPhonetic } from "@/lib/pronunciation";
import {
  findBestSourceSentenceMatch,
  findSimilarVocabularyEntry,
  normalizeForSourceMatch,
} from "@/lib/sourceMatching";
import { tokenizeArticle, tokenToWordContext } from "@/lib/tokenizer";
import { getArticleImageSources, primeArticleImage } from "@/lib/articleImagePreload";
import {
  addVocabularyEntry,
  clearVocabularyEntries,
  createVocabularyEntry,
  deleteVocabularyEntry,
  getVocabularyEntries,
  markVocabularyEntryImported,
  markVocabularyEntriesImported,
  replaceMatchingVocabularyEntry,
  vocabularyIdentity,
} from "@/lib/vocabulary";
import { createStandaloneVocabularyEntry } from "@/lib/standaloneDictionary";
import type { AnkiSettings } from "@/types/anki";
import type { ArticleReadingStyle, ImportedArticle, ImportedArticleBlock, ImportedArticleInlineBaseline, ImportedArticleInlineText, ImportedArticleTableCell, SavedArticle } from "@/types/article";
import type { PublicExplanation } from "@/types/publicArticle";
import type { ArticleTranslationBlock, ArticleTranslationItem, ReaderToken, ReaderViewportAnchor, WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry, VocabularySourceArticle } from "@/types/vocabulary";
import type { DictionaryResult } from "@/types/dictionary";
import { useAccount } from "@/components/AccountProvider";

interface ReaderViewProps {
  article: string;
  importedArticle?: ImportedArticle | null;
  preloadedExplanations?: PublicExplanation[];
  articleSource?: VocabularySourceArticle;
  sourceSentenceToHighlight?: string;
  sourceWordToHighlight?: string;
  sourceJumpRequestId?: number;
  onBack: () => void;
  backLabel?: string;
  onArticleSaved: () => void;
  onArticleChange?: (article: string, importedArticle: ImportedArticle | null) => void;
  onArticleEditCommit?: (article: string, importedArticle: ImportedArticle | null) => Promise<void> | void;
  onImportedArticleChange?: (article: ImportedArticle) => void;
  onJumpToVocabularySourceOutsideArticle?: (entry: VocabularyEntry) => boolean | Promise<boolean>;
  canJumpToVocabularySourceOutsideArticle?: (entry: VocabularyEntry) => boolean;
  desktopViewportInsetLeft?: number;
  initialViewportAnchor?: ReaderViewportAnchor | null;
  onViewportAnchorChange?: (anchor: ReaderViewportAnchor) => void;
  savedArticles?: SavedArticle[];
  onOpenSavedArticle?: (article: SavedArticle) => void;
  onOpenImportedArticle?: (
    article: string,
    importedArticle: ImportedArticle | null,
    kind: "text" | "url",
  ) => Promise<boolean> | boolean;
}

function getCombinedCachedArticleTranslation(
  key: string,
  blocks: ArticleTranslationBlock[],
): ArticleTranslationItem[] {
  const perBlock = getCachedArticleTranslationForBlocks(blocks);
  const exact = getCachedArticleTranslation(key) ?? [];
  const byId = new Map(perBlock.map((item) => [item.id, item]));
  for (const item of exact) {
    byId.set(item.id, item);
  }
  return blocks
    .map((block) => byId.get(block.id))
    .filter((item): item is ArticleTranslationItem => Boolean(item?.translation.trim()));
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
  listStyle?: ImportedArticleBlock["listStyle"];
  listLevel?: number;
  listOrdinal?: number;
  table?: ImportedArticleBlock["table"];
  tableRows?: RenderableTableCell[][];
  plainText?: string;
}

interface RenderableTableCell {
  cell: ImportedArticleTableCell;
  tokens: ReaderToken[];
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
type RightPanelMode = "explanation" | "translation" | "dictionary" | "article";
type ReaderWorkLayer = "import" | "articles" | null;

const IMAGE_OCR_ENABLED = false;
const INITIAL_INTERACTIVE_BLOCK_LIMIT = 8;
const SOURCE_JUMP_UNLOCK_TIMEOUT_MS = 2_000;
const READER_PROGRESS_SCROLL_SETTLE_MS = 180;
const READER_TOKEN_SCROLL_SETTLE_MS = 360;
const FALLBACK_READER_IMAGE_WIDTH = 1_600;
const FALLBACK_READER_IMAGE_HEIGHT = 1_200;
const DEFAULT_ARTICLE_STYLE: Required<ArticleReadingStyle> = {
  fontFamily: "system",
  fontSize: "default",
  lineHeight: "default",
  paragraphSpacing: "default",
  contentWidth: "default",
  imageWidth: "medium",
};

function restoreReaderViewport(root: HTMLElement, anchor: ReaderViewportAnchor): number | null {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-reader-block]"));
  const target = blocks.find((block) => block.dataset.readerBlock === anchor.blockId)
    ?? blocks.find((block) => (block.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120) === anchor.blockText)
    ?? blocks[anchor.blockIndex];
  if (!target) {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const fallbackTop = anchor.scrollRatio > 0 ? maxScroll * anchor.scrollRatio : anchor.scrollY;
    window.scrollTo({ top: fallbackTop, behavior: "auto" });
    return null;
  }
  const restoreTop = () => {
    const delta = target.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 0.5) {
      window.scrollBy({ top: delta, behavior: "auto" });
    }
  };
  restoreTop();
  return window.requestAnimationFrame(restoreTop);
}

function captureReaderViewportAnchor(root: HTMLElement): ReaderViewportAnchor | null {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-reader-block]"));
  if (blocks.length === 0) {
    return null;
  }

  const referenceTop = Math.min(112, Math.max(72, window.innerHeight * 0.12));
  const rootRect = root.getBoundingClientRect();
  const referenceLeft = Math.min(
    Math.max(rootRect.left + rootRect.width / 2, 1),
    Math.max(1, window.innerWidth - 2),
  );
  const hitBlock = document.elementsFromPoint(referenceLeft, referenceTop)
    .map((element) => element.closest<HTMLElement>("[data-reader-block]"))
    .find((element): element is HTMLElement => Boolean(element && root.contains(element)));

  let visibleBlock = hitBlock;
  if (!visibleBlock) {
    let low = 0;
    let high = blocks.length - 1;
    visibleBlock = blocks[blocks.length - 1];
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = blocks[middle];
      if (candidate.getBoundingClientRect().bottom >= referenceTop) {
        visibleBlock = candidate;
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }
  }

  const blockIndex = blocks.indexOf(visibleBlock);
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return {
    blockId: visibleBlock.dataset.readerBlock ?? "",
    blockIndex,
    blockText: (visibleBlock.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    top: visibleBlock.getBoundingClientRect().top,
    scrollY: window.scrollY,
    scrollRatio: maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0,
  };
}

interface ImageOcrState {
  status: ImageOcrStatus;
  text: string;
  error: string;
}

function isDocumentScrollLocked(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  return (
    document.documentElement.classList.contains("cr-overlay-locked") ||
    document.body.classList.contains("cr-overlay-locked") ||
    document.body.style.position === "fixed"
  );
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
    ...(importedArticle ?? {}),
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
  const { response, data } = await fetchJson<{ explanation?: WordExplanation; error?: string; code?: string }>("/api/explain-word", {
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
  }, "解释失败，请稍后重试。", {
    operation: "context_word_explanation",
    metadata: {
      selectedCharacters: context.word.length,
      sentenceCharacters: context.sentence.length,
    },
  });

  if (!response.ok) {
    if (data?.code === "quota_exhausted") {
      throw new GuestLookupQuotaError();
    }
    throw new Error(data?.error || "解释失败，请稍后重试。");
  }

  if (!data?.explanation?.anki) {
    throw new Error("解释结果缺少 Anki 制卡字段，请重新点击该词。");
  }

  return data.explanation;
}

class GuestLookupQuotaError extends Error {
  constructor() {
    super("今天的游客查词次数已用完，登录后可继续。");
    this.name = "GuestLookupQuotaError";
  }
}

async function requestExplanationStream(
  context: WordContext,
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
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
  let completionNotified = false;

  function acceptDecodedChunk(chunk: string) {
    const pieces = chunk.split(EXPLANATION_STREAM_COMPLETE_MARKER);
    for (let index = 0; index < pieces.length; index += 1) {
      if (index > 0 && !completionNotified) {
        completionNotified = true;
        onComplete(fullText);
      }
      const piece = pieces[index];
      if (piece) {
        fullText += piece;
        onChunk(piece);
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        acceptDecodedChunk(chunk);
      }
    }
    const tail = decoder.decode();
    if (tail) {
      acceptDecodedChunk(tail);
    }
  } finally {
    reader.releaseLock();
  }
  return fullText;
}

function buildEntryText(entry: VocabularyEntry): string {
  const phonetic = currentFormPhonetic(entry);
  const contextMeaningLabel = entry.word.trim().split(/\s+/).filter(Boolean).length > 1
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
  ]
    .filter(Boolean)
    .join("\n");
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
    return "my-7 border-l-2 border-[#0066cc] pl-4 text-[21px] font-normal leading-[1.5] tracking-normal text-[#333333] sm:pl-5 sm:text-[24px]";
  }
  if (type === "list-item") {
    return `${typographyStyles.list} list-item text-[#1d1d1f]`;
  }
  if (type === "caption") {
    return "mb-6 mt-[-0.75rem] text-[14px] leading-6 tracking-normal text-[#6e6e73]";
  }
  return `${typographyStyles.body} whitespace-pre-wrap text-[#1d1d1f]`;
}

function importedBlockText(block: ImportedArticleBlock): string {
  if (block.type !== "table") {
    return block.text ?? "";
  }
  return block.text || block.table?.rows.map((row) => row.map((cell) => cell.text).join(" | ")).join("\n") || "";
}

function editableArticleBlockType(
  element: HTMLElement,
  originalBlock?: ImportedArticleBlock,
): ImportedArticleBlock["type"] {
  const declaredType = element.dataset.blockType;
  if (
    declaredType === "heading" ||
    declaredType === "subheading" ||
    declaredType === "paragraph" ||
    declaredType === "list-item" ||
    declaredType === "quote" ||
    declaredType === "caption" ||
    declaredType === "table" ||
    declaredType === "image"
  ) {
    return declaredType;
  }
  if (originalBlock) {
    return originalBlock.type;
  }
  if (element.tagName === "H1") return "heading";
  if (element.tagName === "H2") return "subheading";
  if (element.tagName === "BLOCKQUOTE") return "quote";
  if (element.tagName === "LI") return "list-item";
  if (element.tagName === "FIGCAPTION") return "caption";
  if (element.tagName === "TABLE") return "table";
  return "paragraph";
}

function editableInlineContent(block: ImportedArticleBlock) {
  if (!block.text) {
    return <br />;
  }
  if (!block.inline?.length || inlinePlainText(block.inline) !== block.text) {
    return block.text;
  }
  return block.inline.map((item, index) => {
    if (item.baseline === "sup") {
      return <sup key={`${block.id}-inline-${index}`} className="align-super text-[0.68em] leading-none">{item.text}</sup>;
    }
    if (item.baseline === "sub") {
      return <sub key={`${block.id}-inline-${index}`} className="align-sub text-[0.68em] leading-none">{item.text}</sub>;
    }
    return <span key={`${block.id}-inline-${index}`}>{item.text}</span>;
  });
}

function inlinePlainText(inline: ImportedArticleInlineText[]): string {
  return inline.map((item) => item.text).join("");
}

function normalizeSentence(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function articleTextBlockEntries(article: ImportedArticle | null, plainArticle: string): Array<{ id: string; text: string }> {
  if (article?.blocks?.length) {
    return article.blocks
      .filter((block) => block.type !== "image")
      .map((block) => ({ id: block.id, text: importedBlockText(block) }));
  }
  return plainArticle.split(/\r?\n/).map((text, index) => ({ id: `paragraph-${index}`, text }));
}

function initialInteractiveBlockIds(
  article: ImportedArticle | null,
  plainArticle: string,
  sourceSentence = "",
): Set<string> {
  const entries = articleTextBlockEntries(article, plainArticle);
  const ids = entries.slice(0, INITIAL_INTERACTIVE_BLOCK_LIMIT).map((entry) => entry.id);
  const normalizedSource = normalizeForSourceMatch(sourceSentence);
  if (normalizedSource) {
    const sourceBlock = entries.find((entry) => normalizeForSourceMatch(entry.text).includes(normalizedSource));
    if (sourceBlock) ids.push(sourceBlock.id);
  }
  return new Set(ids);
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

function ReaderRailIcon({ kind }: { kind: "import" | "dictionary" | "vocabulary" | "articles" }) {
  if (kind === "import") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m0-9L6.5 6.5M10 3l3.5 3.5M4 11.5v3A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-3" /></svg>;
  }
  if (kind === "dictionary") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.2" cy="8.2" r="4.7" /><path d="m11.7 11.7 4 4M6.5 8.2h3.4M8.2 6.5v3.4" /></svg>;
  }
  if (kind === "vocabulary") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.2h8.7A2.3 2.3 0 0 1 15 6.5v9.3H6.3A2.3 2.3 0 0 1 4 13.5V4.2Z" /><path d="M6.3 15.8A2.3 2.3 0 0 1 4 13.5c0-1.3 1-2.3 2.3-2.3H15M7 7.2h5" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4.5h5l1.4 1.6H16v9.4H4V4.5Z" /><path d="M7 9h6M7 12h4" /></svg>;
}

export function ReaderView({
  article,
  importedArticle,
  preloadedExplanations = [],
  articleSource,
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
  desktopViewportInsetLeft = 0,
  initialViewportAnchor = null,
  onViewportAnchorChange,
  savedArticles = [],
  onOpenSavedArticle,
  onOpenImportedArticle,
}: ReaderViewProps) {
  const {
    account,
    hasLocalAccountAccess,
    isOffline,
    localAccount,
    openLogin,
    requireAccount,
    requireLocalAccount,
    refreshAccount,
  } = useAccount();
  const [currentArticle, setCurrentArticle] = useState(article);
  const [currentImportedArticle, setCurrentImportedArticle] = useState<ImportedArticle | null>(importedArticle ?? null);
  const [progressiveReaderReady] = useState(
    () => !sourceSentenceToHighlight && articleTextBlockEntries(importedArticle ?? null, article).length > INITIAL_INTERACTIVE_BLOCK_LIMIT * 2,
  );
  const [visibleBlockIds, setVisibleBlockIds] = useState<Set<string>>(
    () => initialInteractiveBlockIds(importedArticle ?? null, article, sourceSentenceToHighlight),
  );
  const interactiveBlockIds = useMemo(
    () => progressiveReaderReady
      ? visibleBlockIds
      : new Set(articleTextBlockEntries(currentImportedArticle, currentArticle).map((block) => block.id)),
    [currentArticle, currentImportedArticle, progressiveReaderReady, visibleBlockIds],
  );
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
  const articleImageSources = useMemo(
    () => getArticleImageSources(currentImportedArticle),
    [currentImportedArticle],
  );
  const articleImageGateSources = useMemo(
    () => articleImageSources.slice(0, 1),
    [articleImageSources],
  );
  const articleImageSourceKey = articleImageSources.join("\n");
  const [readyArticleImageSourceKey, setReadyArticleImageSourceKey] = useState(
    () => getArticleImageSources(importedArticle ?? null).length === 0 ? "" : "__pending__",
  );
  const articleMediaReady = readyArticleImageSourceKey === articleImageSourceKey;
  const plainArticleParagraphs = useMemo(
    () => currentImportedArticle?.blocks?.length ? [] : currentArticle.split(/\r?\n/),
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
      return plainArticleParagraphs.map((text, paragraphIndex) => {
        const id = `paragraph-${paragraphIndex}`;
        const tokens = interactiveBlockIds.has(id)
          ? (tokenizeArticle(text)[0]?.tokens ?? []).map((token) => ({ ...token, paragraphIndex }))
          : undefined;
        return {
          id,
          type: "paragraph",
          tokens,
          plainText: text,
        };
      });
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

        if (block.type === "table" && block.table) {
          const interactive = interactiveBlockIds.has(block.id);
          const tableTokens: ReaderToken[] = [];
          const tableRows = block.table.rows.map((row, rowIndex) => row.map((cell, cellIndex) => {
            const tokens = (interactive ? tokenizeArticle(cell.text)[0]?.tokens ?? [] : []).map((token) => ({
              ...token,
              id: `${block.id}-cell-${rowIndex}-${cellIndex}-${token.id}`,
              paragraphIndex: textBlockIndex,
            }));
            textBlockIndex += 1;
            tableTokens.push(...tokens);
            return { cell, tokens };
          }));
          return {
            id: block.id,
            type: "table",
            tokens: tableTokens,
            table: block.table,
            tableRows,
          };
        }

        const text = importedBlockText(block);
        if (!text.trim()) {
          textBlockIndex += 1;
          return {
            id: block.id,
            type: block.type,
            tokens: [],
          };
        }

        const interactive = interactiveBlockIds.has(block.id);
        const tokens = interactive
          ? tokenizeArticle(text)[0].tokens.map((token) => ({
              ...token,
              id: `${block.id}-${token.id}`,
              paragraphIndex: textBlockIndex,
            }))
          : undefined;
        const inline = block.inline?.length && inlinePlainText(block.inline) === text ? block.inline : null;
        textBlockIndex += 1;

        return {
          id: block.id,
          type: block.type,
          tokens,
          plainText: text,
          ...(inline && tokens ? { tokenGroups: groupTokensByInline(tokens, inline) } : {}),
          listStyle: block.listStyle,
          listLevel: block.listLevel,
          listOrdinal: block.listOrdinal,
          table: block.table,
        };
      })
      .filter((block): block is RenderableArticleBlock => Boolean(block));
  }, [effectiveImportedArticle, imageOcr, interactiveBlockIds, plainArticleParagraphs]);
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
  const [readerMenuOpen, setReaderMenuOpen] = useState(false);
  const [readerMenuInitialPreview, setReaderMenuInitialPreview] = useState<PreviewKind | null>(null);
  const [readerMenuPlacement, setReaderMenuPlacement] = useState<"left" | "right">("right");
  const [readerMenuStandalonePreview, setReaderMenuStandalonePreview] = useState(false);
  const [readerTheme, setReaderTheme] = useState<"day" | "night">("day");
  const [vocabularyEntries, setVocabularyEntries] = useState<VocabularyEntry[]>([]);
  const [ankiSettings, setAnkiSettings] = useState<AnkiSettings>(defaultAnkiSettings());
  const [ankiStatus, setAnkiStatus] = useState("");
  const [checkingAnki, setCheckingAnki] = useState(false);
  const [importingId, setImportingId] = useState("");
  const [importError, setImportError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [savingArticle, setSavingArticle] = useState(false);
  const [mobileExplanationOpen, setMobileExplanationOpen] = useState(false);
  const [mobileExplanationHeight, setMobileExplanationHeight] = useState(72);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("explanation");
  const [readerWorkLayer, setReaderWorkLayer] = useState<ReaderWorkLayer>(null);
  const [readerImportMode, setReaderImportMode] = useState<"text" | "url">("text");
  const [readerImportText, setReaderImportText] = useState("");
  const [readerImportUrl, setReaderImportUrl] = useState("");
  const [readerImportPreview, setReaderImportPreview] = useState<ImportedArticle | null>(null);
  const [readerImportStatus, setReaderImportStatus] = useState("");
  const [readerImportBusy, setReaderImportBusy] = useState(false);
  const [failedImageBlockIds, setFailedImageBlockIds] = useState<Set<string>>(() => new Set());
  const [dictionaryMounted, setDictionaryMounted] = useState(false);
  const [dictionaryClosing, setDictionaryClosing] = useState(false);
  const [guestLookupLocked, setGuestLookupLocked] = useState(false);
  const [articleTranslations, setArticleTranslations] = useState<ArticleTranslationItem[]>([]);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [translationRequested, setTranslationRequested] = useState(false);
  const [translationEstimatedSecondsRemaining, setTranslationEstimatedSecondsRemaining] = useState<number | null>(null);
  const [translationRetryAfterSeconds, setTranslationRetryAfterSeconds] = useState<number | null>(null);
  const [translationRetryReason, setTranslationRetryReason] = useState<string | null>(null);
  const [translationRegenerating, setTranslationRegenerating] = useState(false);
  const [translationCompletedTargetBlocks, setTranslationCompletedTargetBlocks] = useState(0);
  const [translationTotalTargetBlocks, setTranslationTotalTargetBlocks] = useState(0);
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
  const articleShellRef = useRef<HTMLDivElement | null>(null);
  const editingArticleBaselineRef = useRef<ArticleEditSnapshot | null>(null);
  const pendingArticleViewportAnchorRef = useRef<ReaderViewportAnchor | null>(null);
  const initialViewportRestoredRef = useRef(false);
  const activeImageScrollRef = useRef<HTMLDivElement | null>(null);
  const sourceAlignmentTargetIdRef = useRef("");
  const sourceAlignmentLockUntilRef = useRef(0);
  const sourceJumpAttemptIdRef = useRef(0);
  const blockEditRefs = useRef<Record<string, HTMLElement | null>>({});
  const dictionaryWindowRef = useRef<HTMLElement | null>(null);
  const dictionaryCloseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setReaderTheme(document.documentElement.dataset.contextTheme === "night" ? "night" : "day");
  }, []);

  useEffect(() => {
    setFailedImageBlockIds(new Set());
  }, [currentArticle, currentImportedArticle]);

  useEffect(() => () => {
    if (dictionaryCloseTimerRef.current !== null) window.clearTimeout(dictionaryCloseTimerRef.current);
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
      const width = Math.min(Math.max(saved?.width ?? 340, 300), window.innerWidth - 28);
      const height = Math.min(Math.max(saved?.height ?? 560, 380), window.innerHeight - 28);
      const visibleGrip = Math.min(104, width);
      const left = Math.min(
        Math.max(saved?.left ?? 132, visibleGrip - width),
        window.innerWidth - visibleGrip,
      );
      const top = Math.min(Math.max(saved?.top ?? 92, 14), window.innerHeight - 58);
      Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    } catch {
      // A stale window preference must never prevent dictionary access.
    }
  }, [dictionaryMounted]);

  useEffect(() => {
    if (account.authenticated) setGuestLookupLocked(false);
  }, [account.authenticated]);

  useEffect(() => {
    if (!readerWorkLayer) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [readerWorkLayer]);

  useEffect(() => {
    if (!readerWorkLayer && !dictionaryMounted) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (readerWorkLayer) setReaderWorkLayer(null);
      else closeDictionaryWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dictionaryMounted, readerWorkLayer]);

  useEffect(() => {
    const root = articleShellRef.current;
    if (!root || !articleMediaReady || editingArticle || !progressiveReaderReady) return;

    const pendingBlocks = new Map<string, HTMLElement>();
    let idleHandle = 0;
    let timeoutHandle = 0;
    let scrollSettleHandle = 0;
    let scrolling = false;
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const cancelScheduledFlush = () => {
      if (idleHandle) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
      idleHandle = 0;
      timeoutHandle = 0;
    };

    const flushEnteredBlocks = () => {
      idleHandle = 0;
      timeoutHandle = 0;
      if (scrolling || pendingBlocks.size === 0) return;
      const viewportTop = -window.innerHeight * 0.3;
      const viewportBottom = window.innerHeight * 1.45;
      const enteredBlocks = [...pendingBlocks.entries()].filter(([, block]) => {
        const rect = block.getBoundingClientRect();
        return rect.bottom >= viewportTop && rect.top <= viewportBottom;
      });
      pendingBlocks.clear();
      if (enteredBlocks.length === 0) return;
      enteredBlocks.forEach(([, block]) => observer.unobserve(block));
      const enteredIds = enteredBlocks.map(([id]) => id);
      startTransition(() => {
        setVisibleBlockIds((current) => {
          if (enteredIds.every((id) => current.has(id))) return current;
          const next = new Set(current);
          enteredIds.forEach((id) => next.add(id));
          return next;
        });
      });
    };

    const scheduleFlush = () => {
      if (scrolling || pendingBlocks.size === 0 || idleHandle || timeoutHandle) return;
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(flushEnteredBlocks, { timeout: 800 });
      } else {
        timeoutHandle = window.setTimeout(flushEnteredBlocks, 96);
      }
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const block = entry.target as HTMLElement;
        const id = block.dataset.readerBlock;
        if (!id) return;
        if (entry.isIntersecting) pendingBlocks.set(id, block);
        else pendingBlocks.delete(id);
      });
      scheduleFlush();
    }, { rootMargin: "30% 0px 45% 0px" });

    const finishScrolling = () => {
      scrolling = false;
      if (scrollSettleHandle) window.clearTimeout(scrollSettleHandle);
      scrollSettleHandle = 0;
      scheduleFlush();
    };
    const markScrolling = () => {
      scrolling = true;
      cancelScheduledFlush();
      if (scrollSettleHandle) window.clearTimeout(scrollSettleHandle);
      scrollSettleHandle = window.setTimeout(finishScrolling, READER_TOKEN_SCROLL_SETTLE_MS);
    };

    root.querySelectorAll<HTMLElement>("[data-reader-block]").forEach((block) => {
      if (!interactiveBlockIds.has(block.dataset.readerBlock ?? "")) observer.observe(block);
    });
    window.addEventListener("scroll", markScrolling, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", markScrolling);
      cancelScheduledFlush();
      if (scrollSettleHandle) window.clearTimeout(scrollSettleHandle);
    };
  }, [articleMediaReady, editingArticle, interactiveBlockIds, progressiveReaderReady]);

  useEffect(() => {
    if (editingArticle) {
      return;
    }
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
  }, [article, importedArticle, editingArticle]);

  useLayoutEffect(() => {
    const anchor = pendingArticleViewportAnchorRef.current;
    const root = articleShellRef.current;
    if (!anchor || !root) {
      return;
    }
    pendingArticleViewportAnchorRef.current = null;
    const frameId = restoreReaderViewport(root, anchor);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [editingArticle]);

  useLayoutEffect(() => {
    if (initialViewportRestoredRef.current || !initialViewportAnchor || !articleMediaReady) return;
    const root = articleShellRef.current;
    if (!root || !root.querySelector("[data-reader-block]")) return;
    initialViewportRestoredRef.current = true;
    const frameId = restoreReaderViewport(root, initialViewportAnchor);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [articleMediaReady, initialViewportAnchor]);

  useEffect(() => {
    if (!onViewportAnchorChange || editingArticle) return;
    let frameId = 0;
    let settleHandle = 0;
    const report = () => {
      frameId = 0;
      if (settleHandle) window.clearTimeout(settleHandle);
      settleHandle = 0;
      const anchor = captureArticleViewportAnchor();
      if (anchor) onViewportAnchorChange(anchor);
    };
    const scheduleReport = () => {
      if (settleHandle) window.clearTimeout(settleHandle);
      settleHandle = window.setTimeout(() => {
        settleHandle = 0;
        if (!frameId) frameId = window.requestAnimationFrame(report);
      }, READER_PROGRESS_SCROLL_SETTLE_MS);
    };
    const reportAfterScrollEnd = () => {
      if (settleHandle) window.clearTimeout(settleHandle);
      settleHandle = 0;
      if (!frameId) frameId = window.requestAnimationFrame(report);
    };
    const reportImmediately = () => {
      if (settleHandle) window.clearTimeout(settleHandle);
      settleHandle = 0;
      if (frameId) window.cancelAnimationFrame(frameId);
      report();
    };
    window.addEventListener("scroll", scheduleReport, { passive: true });
    window.addEventListener("scrollend", reportAfterScrollEnd);
    window.addEventListener("pagehide", reportImmediately);
    frameId = window.requestAnimationFrame(report);
    return () => {
      window.removeEventListener("scroll", scheduleReport);
      window.removeEventListener("scrollend", reportAfterScrollEnd);
      window.removeEventListener("pagehide", reportImmediately);
      if (settleHandle) window.clearTimeout(settleHandle);
      if (frameId) window.cancelAnimationFrame(frameId);
      const anchor = captureArticleViewportAnchor();
      if (anchor) onViewportAnchorChange(anchor);
    };
  }, [currentArticle, currentImportedArticle, editingArticle, onViewportAnchorChange]);

  useEffect(() => {
    if (articleImageGateSources.length === 0) {
      setReadyArticleImageSourceKey(articleImageSourceKey);
      return;
    }

    let cancelled = false;
    let frameId = 0;
    void Promise.all(articleImageGateSources.map(primeArticleImage)).then(() => {
      if (cancelled) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        setReadyArticleImageSourceKey(articleImageSourceKey);
      });
    });

    return () => {
      cancelled = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [articleImageGateSources, articleImageSourceKey]);

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
      retryAfterSeconds: number | null;
      retryReason: string | null;
      regenerating: boolean;
      completedTargetBlocks: number;
      totalTargetBlocks: number;
    }) {
      setArticleTranslations(snapshot.translations);
      setTranslationLoading(snapshot.loading);
      setTranslationError(snapshot.error);
      setTranslationRequested(snapshot.requested);
      setTranslationEstimatedSecondsRemaining(snapshot.estimatedSecondsRemaining);
      setTranslationRetryAfterSeconds(snapshot.retryAfterSeconds);
      setTranslationRetryReason(snapshot.retryReason);
      setTranslationRegenerating(snapshot.regenerating);
      setTranslationCompletedTargetBlocks(snapshot.completedTargetBlocks);
      setTranslationTotalTargetBlocks(snapshot.totalTargetBlocks);
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
      const exactBlockTranslations = getCombinedCachedArticleTranslation(
        translationSourceKey,
        translationBlocks,
      );
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
      setTranslationRetryAfterSeconds(null);
      setTranslationRetryReason(null);
      setTranslationRegenerating(false);
      setTranslationCompletedTargetBlocks(0);
      setTranslationTotalTargetBlocks(0);
    }

    return subscribeArticleTranslationJob(translationSourceKey, applyTranslationSnapshot);
  }, [translationSourceKey, translationBlocks]);

  useEffect(() => {
    if (!account.authenticated || translationBlocks.length === 0 || getArticleTranslationJobSnapshot(translationSourceKey)) {
      return;
    }

    const persisted = getCombinedCachedArticleTranslation(translationSourceKey, translationBlocks);
    if (persisted.length === 0) {
      return;
    }

    const persistedById = new Map(persisted.map((item) => [item.id, item]));
    const initialTranslations = translationBlocks
      .map((block) => persistedById.get(block.id))
      .filter((item): item is ArticleTranslationItem => Boolean(item?.translation.trim()));
    const completedIds = new Set(initialTranslations.map((item) => item.id));
    const missingBlocks = translationBlocks.filter((block) => !completedIds.has(block.id));
    if (missingBlocks.length === 0) {
      return;
    }

    void startArticleTranslationJob(translationSourceKey, missingBlocks, {
      initialTranslations,
      allBlocks: translationBlocks,
    });
  }, [account.authenticated, translationSourceKey, translationBlocks]);

  useEffect(() => {
    for (const item of preloadedExplanations) {
      if (!getCachedExplanation(item.cacheKey)) {
        setCachedExplanation(item.cacheKey, item.explanation);
      }
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
    if (typeof document === "undefined" || isDocumentScrollLocked()) {
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
    if (!sourceSentenceToHighlight || !articleMediaReady) {
      return;
    }
    let cancelled = false;
    let frameId = 0;
    const startedAt = performance.now();

    function performPendingJump() {
      if (cancelled) {
        return;
      }

      if (!isDocumentScrollLocked() && scrollToBestSourceSentence(sourceSentenceToHighlight, sourceWordToHighlight)) {
        return;
      }
      if (performance.now() - startedAt < SOURCE_JUMP_UNLOCK_TIMEOUT_MS) {
        frameId = window.requestAnimationFrame(performPendingJump);
      }
    }

    frameId = window.requestAnimationFrame(performPendingJump);
    return () => {
      cancelled = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [articleMediaReady, sourceSentenceToHighlight, sourceWordToHighlight, sourceJumpRequestId, wordTokens]);

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
    if (!account.authenticated && guestLookupLocked) {
      openLogin("今天的游客查词次数已用完，登录后可继续查词并同步学习数据。");
      return;
    }
    if (!account.authenticated && !account.configured && !consumeFallbackGuestLookup()) {
      setGuestLookupLocked(true);
      setError("今天的 10 次游客试用已用完；账号服务配置完成后即可登录继续。 ");
      openLogin("游客每天可试用 10 次划词解释；登录后可继续查词并同步学习数据。");
      return;
    }
    const cacheKey = createExplanationCacheKey(context.word, context.sentence);

    setSelectedTokenIds(tokenIds);
    setSelectedContext(context);
    setError("");
    setMobileExplanationOpen(true);
    setMobileExplanationHeight(82);
    setRightPanelMode("explanation");

    if (!options.force && loading && activeExplanationKeyRef.current === cacheKey) {
      return;
    }

    abortRef.current?.abort();
    activeExplanationKeyRef.current = "";

    const cached = options.force ? null : getCachedExplanation(cacheKey);
    if (cached) {
      if (!account.authenticated && !(isOffline && hasLocalAccountAccess)) {
        const cachedUsageResponse = await fetch("/api/usage/cache-lookup", {
          method: "POST",
          headers: { "x-context-action-id": crypto.randomUUID() },
        });
        const cachedUsage = await cachedUsageResponse.json().catch(() => null) as { error?: string; code?: string } | null;
        if (!cachedUsageResponse.ok) {
          if (cachedUsage?.code === "quota_exhausted") setGuestLookupLocked(true);
          setError(cachedUsage?.code === "quota_exhausted"
            ? "今天的游客查词次数已用完，登录后可继续。"
            : cachedUsage?.error || "游客试用额度记录失败，请登录后继续。");
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

    if (isOffline) {
      setError("当前离线，未找到这次选择的已有解释。联网后可生成新的查词结果。");
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

    const structuredPromise = requestExplanation(context, controller.signal, actionId).then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    let streamedExplanation: WordExplanation | null = null;

    function acceptCompletedStream(completedText: string) {
      if (controller.signal.aborted || streamedExplanation) {
        return;
      }
      const completedExplanation = explanationFromCompletedStream(completedText, context);
      if (!completedExplanation) {
        return;
      }

      streamedExplanation = completedExplanation;
      setCachedExplanation(cacheKey, completedExplanation);
      setExplanation(completedExplanation);
      setExplanationStreamText(completedText);
      setExplanationStreaming(false);
      if (options.syncVocabulary && account.authenticated) {
        setVocabularyEntries(replaceMatchingVocabularyEntry(completedExplanation, context, articleSource));
      }
    }

    const streamPromise = requestExplanationStream(
      context,
      controller.signal,
      (chunk) => {
        if (!controller.signal.aborted) {
          setExplanationStreamText((current) => `${current}${chunk}`);
        }
      },
      acceptCompletedStream,
      actionId,
    ).catch(() => "");

    try {
      const completedStreamText = await streamPromise;
      if (completedStreamText) {
        acceptCompletedStream(completedStreamText);
      }

      const structuredResult = await structuredPromise;
      if (structuredResult.error) {
        if (streamedExplanation) {
          void refreshAccount();
          return;
        }
        throw structuredResult.error;
      }

      const structuredExplanation = structuredResult.value;
      if (!structuredExplanation) {
        throw new Error("解释结果为空，请重新点击该词。");
      }
      const nextExplanation = completedStreamText
        ? mergeStreamDisplayIntoExplanation(structuredExplanation, completedStreamText)
        : structuredExplanation;
      const durableDisplayText = completedStreamText || explanationAsStreamText(nextExplanation);

      setCachedExplanation(cacheKey, nextExplanation);
      setExplanation(nextExplanation);
      setExplanationStreamText(durableDisplayText);
      setExplanationStreaming(false);
      if (options.syncVocabulary) {
        if (account.authenticated) {
          setVocabularyEntries(replaceMatchingVocabularyEntry(nextExplanation, context, articleSource));
        }
      }
      void refreshAccount();
    } catch (requestError) {
      if (controller.signal.aborted) {
        return;
      }
      const quotaExhausted = requestError instanceof GuestLookupQuotaError;
      if (quotaExhausted) setGuestLookupLocked(true);
      setError(quotaExhausted
        ? "今天的游客查词次数已用完，登录后可继续。"
        : requestError instanceof Error ? requestError.message : "解释失败，请稍后重试。");
      if (!account.authenticated && requestError instanceof Error && (quotaExhausted || /登录|游客|额度/.test(requestError.message))) {
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
    setRightPanelMode("translation");
    const cached = getCombinedCachedArticleTranslation(cacheKey, translationBlocks);
    const visibleTranslations = force ? [...cached, ...articleTranslations] : cached;
    const cachedById = new Map(visibleTranslations.map((item) => [item.id, item]));
    const initialTranslations = translationBlocks
      .map((block) => cachedById.get(block.id))
      .filter((item): item is ArticleTranslationItem => Boolean(item?.translation.trim()));
    const translatedIds = new Set(initialTranslations.map((item) => item.id));
    const blocksToTranslate = force
      ? translationBlocks
      : translationBlocks.filter((block) => !translatedIds.has(block.id));

    if (!force && blocksToTranslate.length === 0) {
      setArticleTranslations(initialTranslations);
      setTranslationError("");
      setTranslationRequested(true);
      return;
    }

    void startArticleTranslationJob(cacheKey, blocksToTranslate, {
      force,
      initialTranslations,
      allBlocks: translationBlocks,
    });
  }

  function handleRegenerateExplanation() {
    if (!account.authenticated && guestLookupLocked) {
      openLogin("今天的游客查词次数已用完，登录后可继续查词并同步学习数据。");
      return;
    }
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

    const finalToken = token ?? dragCurrentToken;
    if (dragStartToken && finalToken) {
      // Whitespace between or after words has no token element of its own.
      // Finish at the last word crossed so releasing there still submits the selection.
      handleTokenPointerUp(finalToken);
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
    if (!requireLocalAccount("登录后才能把词条加入生词本并跨设备同步。")) return;
    if (!explanation || !selectedContext) {
      return;
    }

    const entry = createVocabularyEntry(explanation, selectedContext, articleSource);
    setVocabularyEntries(addVocabularyEntry(entry));
  }

  function isStandaloneDictionaryInVocabulary(result: DictionaryResult) {
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

  function handleDeleteVocabulary(id: string) {
    setVocabularyEntries(deleteVocabularyEntry(id));
  }

  function handleOpenVocabulary() {
    if (!requireLocalAccount("登录后才能使用生词本。")) return;
    const entries = getVocabularyEntries();
    setVocabularyEntries(entries);
    setImportError("");
    setAnkiStatus("");
    setReaderMenuPlacement("left");
    setReaderMenuStandalonePreview(true);
    setReaderMenuInitialPreview("vocabulary");
    setReaderMenuOpen(true);
    if (entries.some((entry) => !entry.anki.ankiNoteId)) {
      void reconcileAnkiImportReceipts(entries);
    }
  }

  function handleOpenSavedArticlesMenu() {
    if (!requireLocalAccount("登录后才能查看我的文章。")) return;
    setReaderMenuPlacement("left");
    setReaderMenuStandalonePreview(true);
    setReaderMenuInitialPreview("saved");
    setReaderMenuOpen(true);
  }

  function handleOpenReaderMenu() {
    setReaderMenuPlacement("right");
    setReaderMenuStandalonePreview(false);
    setReaderMenuInitialPreview(null);
    setReaderMenuOpen(true);
  }

  function handleReaderThemeChange(nextTheme: "day" | "night") {
    setReaderTheme(nextTheme);
    if (nextTheme === "night") {
      document.documentElement.dataset.contextTheme = "night";
      document.documentElement.style.colorScheme = "dark";
    } else {
      delete document.documentElement.dataset.contextTheme;
      document.documentElement.style.colorScheme = "light";
    }
    try {
      const current = JSON.parse(window.localStorage.getItem("context-reader-home-ui-v1") || "null") as Record<string, unknown> | null;
      window.localStorage.setItem("context-reader-home-ui-v1", JSON.stringify({ ...(current ?? {}), theme: nextTheme }));
    } catch {
      // Theme still applies for the current visit when browser storage is unavailable.
    }
  }

  async function reconcileAnkiImportReceipts(entries: VocabularyEntry[]) {
    setImportingId("__reconcile__");
    try {
      const noteIdsByEntryId = await findImportedVocabularyNoteIds(
        entries,
        ankiSettings.deckName,
        ankiSettings.endpoint,
      );
      if (noteIdsByEntryId.size === 0) return;
      setVocabularyEntries(markVocabularyEntriesImported(noteIdsByEntryId));
      setAnkiStatus(`已与 Anki 核对，补回 ${noteIdsByEntryId.size} 条已导入记录。`);
    } catch {
      // Anki can be offline when the notebook opens. Keep the local status and
      // let the usual import controls report a connection problem if used.
    } finally {
      setImportingId((current) => current === "__reconcile__" ? "" : current);
    }
  }

  function openDictionaryWindow() {
    if (dictionaryCloseTimerRef.current !== null) window.clearTimeout(dictionaryCloseTimerRef.current);
    setDictionaryClosing(false);
    setDictionaryMounted(true);
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

  function closeDictionaryWindow() {
    setDictionaryClosing(true);
    dictionaryCloseTimerRef.current = window.setTimeout(() => {
      dictionaryCloseTimerRef.current = null;
      setDictionaryMounted(false);
      setDictionaryClosing(false);
    }, 220);
  }

  function startDictionaryDrag(event: ReactPointerEvent<HTMLElement>) {
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

  async function submitReaderImport() {
    if (!onOpenImportedArticle || readerImportBusy) return;
    if (readerImportMode === "text") {
      const text = readerImportText.trim();
      if (!text) {
        setReaderImportStatus("先粘贴一篇英文文章。");
        return;
      }
      const opened = await onOpenImportedArticle(text, null, "text");
      if (opened) setReaderWorkLayer(null);
      return;
    }

    if (readerImportPreview) {
      const opened = await onOpenImportedArticle(readerImportPreview.text, readerImportPreview, "url");
      if (opened) setReaderWorkLayer(null);
      return;
    }

    const url = readerImportUrl.trim();
    if (!url) {
      setReaderImportStatus("先输入文章网址。");
      return;
    }
    setReaderImportBusy(true);
    setReaderImportStatus("正在读取文章并把图片保存到本站…");
    try {
      const response = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json() as { article?: ImportedArticle; error?: string };
      if (!response.ok || !data.article?.text?.trim()) {
        throw new Error(data.error || "这个网址暂时无法读取。");
      }
      setReaderImportPreview(data.article);
      setReaderImportStatus("已读取，确认后进入新文章。");
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : "这个网址暂时无法读取。";
      setReaderImportStatus(`${message} 你仍可以切换到“粘贴文章”，直接带入正文。`);
    } finally {
      setReaderImportBusy(false);
    }
  }

  function openMobileTool(mode: RightPanelMode) {
    setRightPanelMode(mode);
    setMobileExplanationHeight(82);
    setMobileExplanationOpen(true);
  }

  function handleCloseVocabulary() {
    setReaderMenuOpen(false);
    setReaderMenuInitialPreview(null);
    setReaderMenuStandalonePreview(false);
  }

  function handleJumpToVocabularySource(entry: VocabularyEntry) {
    setReaderMenuOpen(false);
    setReaderMenuInitialPreview(null);
    setReaderMenuStandalonePreview(false);
    setImportError("");
    setAnkiStatus("");
    const attemptId = sourceJumpAttemptIdRef.current + 1;
    sourceJumpAttemptIdRef.current = attemptId;
    const startedAt = performance.now();

    async function jumpAfterOverlayUnlock() {
      if (sourceJumpAttemptIdRef.current !== attemptId) {
        return;
      }
      if (isDocumentScrollLocked() && performance.now() - startedAt < SOURCE_JUMP_UNLOCK_TIMEOUT_MS) {
        window.requestAnimationFrame(() => void jumpAfterOverlayUnlock());
        return;
      }
      if (scrollToVocabularyEntrySource(entry)) {
        return;
      }

      const jumpedOutside = await onJumpToVocabularySourceOutsideArticle?.(entry) ?? false;
      if (sourceJumpAttemptIdRef.current === attemptId && !jumpedOutside) {
        setImportError("当前文章、本地保存文章和推荐文章里都没有找到这个词条的原句。");
        setReaderMenuPlacement("left");
        setReaderMenuInitialPreview("vocabulary");
        setReaderMenuOpen(true);
      }
    }

    window.requestAnimationFrame(() => void jumpAfterOverlayUnlock());
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

  function captureArticleViewportAnchor(): ReaderViewportAnchor | null {
    const root = articleShellRef.current;
    if (!root) {
      return null;
    }
    return captureReaderViewportAnchor(root);
  }

  function preserveArticleViewportAcrossModeChange(anchor = captureArticleViewportAnchor()) {
    pendingArticleViewportAnchorRef.current = anchor;
  }

  function beginArticleEditing() {
    preserveArticleViewportAcrossModeChange();
    editingArticleBaselineRef.current = {
      article: currentArticle,
      importedArticle: cloneImportedArticle(currentImportedArticle),
    };
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
      preserveArticleViewportAcrossModeChange();
      setEditingArticle(false);
      setDraftPlainArticle("");
      setDraftBlocks([]);
      setEditStatus("");
      editingArticleBaselineRef.current = null;
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

    const baselineBlocks = editingArticleBaselineRef.current?.importedArticle?.blocks ?? draftBlocks;
    return Array.from(root.children)
      .map((child, index): ImportedArticleBlock | null => {
        const element = child as HTMLElement;
        const blockId = element.dataset.blockId || `edited-block-${Date.now()}-${index}`;
        const originalBlock = baselineBlocks.find((block) => block.id === blockId)
          ?? draftBlocks.find((block) => block.id === blockId);
        const type = editableArticleBlockType(element, originalBlock);

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

        if (type === "table") {
          return originalBlock?.type === "table" ? originalBlock : null;
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
    const viewportAnchor = captureArticleViewportAnchor();
    const editingBaseline = editingArticleBaselineRef.current;
    if (!currentImportedArticle?.blocks?.length) {
      const nextArticle = plainDraftTextFromDom();
      if (!nextArticle.trim()) {
        setEditStatus("至少保留一段英文正文。");
        return false;
      }
      if (nextArticle.replace(/\r\n/g, "\n") === currentArticle.replace(/\r\n/g, "\n")) {
        preserveArticleViewportAcrossModeChange(viewportAnchor);
        setEditingArticle(false);
        setDraftPlainArticle("");
        setDraftBlocks([]);
        setEditStatus("");
        editingArticleBaselineRef.current = null;
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
      preserveArticleViewportAcrossModeChange(viewportAnchor);
      setEditingArticle(false);
      setDraftPlainArticle("");
      setDraftBlocks([]);
      setEditStatus("");
      editingArticleBaselineRef.current = null;
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
      (editingBaseline?.importedArticle?.blocks ?? currentImportedArticle.blocks)
        .map((block) => [block.id, block.type, block.text ?? "", block.src ?? "", block.alt ?? ""]),
    );
    if (blocksUnchanged) {
      preserveArticleViewportAcrossModeChange(viewportAnchor);
      setEditingArticle(false);
      setDraftPlainArticle("");
      setDraftBlocks([]);
      setEditStatus("");
      editingArticleBaselineRef.current = null;
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
    preserveArticleViewportAcrossModeChange(viewportAnchor);
    setEditingArticle(false);
    setDraftPlainArticle("");
    setDraftBlocks([]);
    setEditStatus("");
    editingArticleBaselineRef.current = null;
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
    if (importingId) return;
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
    if (importingId) return;
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
    if (!requireLocalAccount("登录后才能保存文章；登录时会先合并本机已有数据。")) return;
    setSavingArticle(true);
    setSaveStatus("正在保存文章...");
    try {
      saveArticle(currentArticle, "", effectiveImportedArticle);
      onArticleSaved();
      setSaveStatus(isOffline ? "文章已保存到本机；联网后会自动同步" : "文章已保存");
    } catch (saveError) {
      setSaveStatus(saveError instanceof Error ? saveError.message : "文章保存失败，请稍后重试。");
    } finally {
      setSavingArticle(false);
      window.setTimeout(() => setSaveStatus(""), 2600);
    }
  }

  const saveButtonText = savingArticle
    ? "保存中"
    : articleSaved
      ? "已保存"
      : "保存文章";
  const toolbarStatus = [editStatus, saveStatus].filter(Boolean).join(" · ");
  const hasExplanationPanelContent = Boolean(selectedContext || loading || explanation || error);
  const activeArticleStyle = normalizeArticleStyle(currentImportedArticle?.style);
  const articleShellClassName = [
    "mx-auto overflow-x-hidden break-words [overflow-wrap:anywhere]",
    editingArticle ? "select-text" : "select-none touch-pan-y",
    activeArticleStyle.contentWidth === "narrow" ? "max-w-2xl" : activeArticleStyle.contentWidth === "wide" ? "max-w-4xl" : "max-w-[52rem]",
    activeArticleStyle.fontFamily === "serif" ? "font-serif" : activeArticleStyle.fontFamily === "mono" ? "font-mono" : "font-sans",
  ].join(" ");
  const paragraphStyle = {
    "--reader-body-size": activeArticleStyle.fontSize === "small" ? "18px" : activeArticleStyle.fontSize === "large" ? "22px" : activeArticleStyle.fontSize === "xlarge" ? "24px" : "21px",
    "--reader-body-size-mobile": activeArticleStyle.fontSize === "small" ? "17px" : activeArticleStyle.fontSize === "large" ? "21px" : activeArticleStyle.fontSize === "xlarge" ? "23px" : "19px",
    "--reader-list-size": activeArticleStyle.fontSize === "small" ? "17px" : activeArticleStyle.fontSize === "large" ? "19px" : activeArticleStyle.fontSize === "xlarge" ? "21px" : "18px",
    "--reader-body-weight": "450",
    "--reader-body-line": activeArticleStyle.lineHeight === "compact" ? "1.45" : activeArticleStyle.lineHeight === "relaxed" ? "1.78" : "1.6",
    "--reader-body-line-mobile": activeArticleStyle.lineHeight === "compact" ? "1.45" : activeArticleStyle.lineHeight === "relaxed" ? "1.78" : "1.58",
    "--reader-list-line": activeArticleStyle.lineHeight === "compact" ? "1.4" : activeArticleStyle.lineHeight === "relaxed" ? "1.65" : "1.47",
    "--reader-paragraph-space": activeArticleStyle.paragraphSpacing === "compact" ? "1rem" : activeArticleStyle.paragraphSpacing === "relaxed" ? "2rem" : "1.75rem",
    "--reader-paragraph-space-mobile": activeArticleStyle.paragraphSpacing === "compact" ? "1rem" : activeArticleStyle.paragraphSpacing === "relaxed" ? "1.75rem" : "1.5rem",
  } as CSSProperties;
  const imageWidthClassName = activeArticleStyle.imageWidth === "small" ? "mx-auto max-w-md" : activeArticleStyle.imageWidth === "full" ? "max-w-none" : "mx-auto max-w-[52rem]";
  const leadingImageBlockId = useMemo(
    () => renderableBlocks.find((block) => block.type === "image" && block.src)?.id ?? "",
    [renderableBlocks],
  );
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
    <main
      className="cr-reader-root min-h-screen overflow-x-hidden bg-[#f5f5f7] text-[#1d1d1f]"
      style={{ "--reader-desktop-inset-left": `${desktopViewportInsetLeft}px` } as CSSProperties}
    >
      <aside className={toolbarStyles.desktopRail} aria-label="阅读快捷入口">
        <PillNavAction
          className={`${toolbarStyles.action} ${toolbarStyles.backAction} ${toolbarStyles.railBackAction}`}
          label={backLabel}
          onClick={() => void handleBackToHome()}
          disabled={savingArticleEdit}
        />
        <div className={toolbarStyles.railActions}>
          <button type="button" onClick={() => setReaderWorkLayer("import")}>
            <ReaderRailIcon kind="import" /><span>导入</span><small>导入新的文章或网址</small>
          </button>
          <button type="button" onClick={openDictionaryWindow}>
            <ReaderRailIcon kind="dictionary" /><span>查词</span><small>打开可移动查词窗口</small>
          </button>
          <button type="button" onClick={handleOpenVocabulary}>
            <ReaderRailIcon kind="vocabulary" /><span>生词本</span><small>查看保存的词与原句</small>
          </button>
          <button type="button" onClick={handleOpenSavedArticlesMenu}>
            <ReaderRailIcon kind="articles" /><span>我的文章</span><small>打开保存文章</small>
          </button>
        </div>
      </aside>
      <header className={toolbarStyles.toolbar} aria-label="文章工具">
        <PillNavAction
          className={`${toolbarStyles.action} ${toolbarStyles.backAction} ${toolbarStyles.mobileBackAction}`}
          label={backLabel}
          onClick={() => void handleBackToHome()}
          disabled={savingArticleEdit}
        />
        <div className={toolbarStyles.actions}>
          {editingArticle ? (
            <>
              <PillNavAction
                className={`${toolbarStyles.action} ${toolbarStyles.historyAction}`}
                label="←"
                onClick={() => void undoSavedArticleEdit()}
                disabled={savingArticleEdit || articleUndoStack.length === 0}
                ariaLabel="撤销文章编辑"
                title="撤销文章编辑"
              />
              <PillNavAction
                className={`${toolbarStyles.action} ${toolbarStyles.historyAction}`}
                label="→"
                onClick={() => void redoSavedArticleEdit()}
                disabled={savingArticleEdit || articleRedoStack.length === 0}
                ariaLabel="重做文章编辑"
                title="重做文章编辑"
              />
              <PillNavAction
                className={toolbarStyles.action}
                label="取消编辑"
                onClick={cancelArticleEditing}
                disabled={savingArticleEdit}
              />
              <PillNavAction
                className={`${toolbarStyles.action} ${toolbarStyles.primaryAction}`}
                tone="dark"
                label={savingArticleEdit ? "保存中..." : "保存编辑"}
                onClick={() => void saveArticleEditing()}
                disabled={savingArticleEdit}
              />
            </>
          ) : (
            <PillNavAction
              className={toolbarStyles.action}
              label="编辑文章"
              onClick={beginArticleEditing}
            />
          )}
          <PillNavAction
            className={`${toolbarStyles.action} ${toolbarStyles.copyAction}`}
            label="复制文章内容"
            onClick={handleCopyArticle}
            disabled={editingArticle}
          />
          <PillNavAction
            className={toolbarStyles.action}
            label={saveButtonText}
            onClick={handleSaveArticle}
            disabled={articleSaved || savingArticle || savingArticleEdit || editingArticle}
          />
          <PillNavAction
            className={`${toolbarStyles.action} ${toolbarStyles.primaryAction}`}
            tone="dark"
            label="Menu"
            onClick={handleOpenReaderMenu}
            ariaExpanded={readerMenuOpen}
            ariaControls="home-option-menu"
          />
        </div>
      </header>
      {toolbarStatus && (
        <div className={toolbarStyles.status} role="status" aria-live="polite">
          {toolbarStatus}
        </div>
      )}

      <div
        className={`${toolbarStyles.readerLayout} mx-auto grid max-w-7xl gap-5 overflow-x-hidden px-0 pt-20 sm:px-5 lg:grid-cols-[minmax(0,1fr)_360px] ${
          mobileExplanationOpen ? "pb-[calc(var(--mobile-sheet-height,72dvh)+5.5rem)] lg:pb-6" : "pb-24 lg:pb-6"
        }`}
        style={{ "--mobile-sheet-height": `${mobileExplanationHeight}dvh` } as CSSProperties}
      >
        <article className="cr-reader-article min-w-0 overflow-x-hidden rounded-[16px] bg-white px-4 py-7 sm:min-h-[70vh] sm:px-10 sm:py-8 lg:px-12 lg:py-14">
          {!articleMediaReady ? (
            <div
              className={loadingStyles.stage}
              role="status"
              aria-live="polite"
            >
              <div className={loadingStyles.document} aria-hidden="true">
                <span className={`${loadingStyles.line} ${loadingStyles.lineTitle}`} />
                <div className={loadingStyles.content}>
                  <span className={loadingStyles.image} />
                  <span className={loadingStyles.copy}>
                    <span className={`${loadingStyles.line} ${loadingStyles.lineLong}`} />
                    <span className={`${loadingStyles.line} ${loadingStyles.lineMedium}`} />
                    <span className={`${loadingStyles.line} ${loadingStyles.lineShort}`} />
                  </span>
                </div>
              </div>
              <span className={loadingStyles.progress} aria-hidden="true">
                <span />
              </span>
              <p>正在排好文章与图片</p>
            </div>
          ) : (
          <>
          {currentImportedArticle && (
            <header className="mx-auto mb-10 max-w-[52rem] border-b border-[#e0e0e0] pb-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-5 tracking-[-0.1px] text-[#6e6e73]">
                <span>{currentImportedArticle.siteName}</span>
                {currentImportedArticle.byline && <span>作者：{currentImportedArticle.byline}</span>}
                {currentImportedArticle.publishedTime && <time>{currentImportedArticle.publishedTime}</time>}
              </div>
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
            ref={articleShellRef}
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
                  data-native-selection="blue"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onInput={handleArticleEditInput}
                >
                  {draftPlainArticle.split(/\r?\n/).map((text, paragraphIndex) => (
                    <p
                      key={`paragraph-${paragraphIndex}`}
                      data-reader-block={`paragraph-${paragraphIndex}`}
                      className={`${textBlockClassName("paragraph")} min-w-0`}
                    >
                      {text || <br />}
                    </p>
                  ))}
                </div>
              ) : (
              <div
                ref={importedArticleEditRef}
                className="min-h-[65vh] outline-none"
                data-native-selection="blue"
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
                        data-reader-block={block.id}
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
                            decoding="async"
                            height={block.height ?? FALLBACK_READER_IMAGE_HEIGHT}
                            src={block.src}
                            width={block.width ?? FALLBACK_READER_IMAGE_WIDTH}
                          />
                        )}
                        {block.alt && <figcaption className="mt-3 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">{block.alt}</figcaption>}
                      </figure>
                    );
                  }

                  if (block.type === "table" && block.table) {
                    return (
                      <figure
                        key={block.id}
                        {...dataProps}
                        className="group relative my-8 min-w-0"
                        contentEditable={false}
                      >
                        <button
                          type="button"
                          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-xl leading-none text-[#1d1d1f] shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0066cc] active:scale-95"
                          aria-label="删除表格"
                          title="删除表格"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            deleteDraftBlock(block.id);
                          }}
                        >
                          ×
                        </button>
                        {block.table.caption && <figcaption className="mb-3 pr-12 text-[15px] font-semibold leading-6 text-[#333333]">{block.table.caption}</figcaption>}
                        <div className="overflow-x-auto rounded-[10px] border border-[#d8d8dc]">
                          <table className="w-max min-w-full border-collapse bg-white text-left text-[15px] leading-6 text-[#1d1d1f]">
                            <tbody>
                              {block.table.rows.map((row, rowIndex) => (
                                <tr key={`${block.id}-edit-row-${rowIndex}`} className={rowIndex % 2 ? "bg-[#fafafa]" : "bg-white"}>
                                  {row.map((cell, cellIndex) => {
                                    const CellTag = cell.header ? "th" : "td";
                                    return (
                                      <CellTag
                                        key={`${block.id}-edit-cell-${rowIndex}-${cellIndex}`}
                                        className={`border-b border-r border-[#e3e3e6] px-3.5 py-2.5 align-top last:border-r-0 ${cell.header ? "bg-[#f3f4f5] font-semibold" : "font-normal"}`}
                                        colSpan={cell.colSpan}
                                        rowSpan={cell.rowSpan}
                                      >
                                        {cell.text || " "}
                                      </CellTag>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </figure>
                    );
                  }

                  const Tag = block.type === "heading" ? "h1" : block.type === "subheading" ? "h2" : block.type === "quote" ? "blockquote" : "p";
                  return (
                    <Tag
                      key={block.id}
                      {...dataProps}
                      data-reader-block={block.id}
                      className={`${textBlockClassName(block.type)} min-w-0 outline-none`}
                      suppressContentEditableWarning
                    >
                      {editableInlineContent(block)}
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
                if (failedImageBlockIds.has(block.id)) {
                  return (
                    <figure key={block.id} data-reader-block={block.id} className={`my-8 min-w-0 lg:my-10 ${imageWidthClassName}`}>
                      <div className="grid min-h-32 place-items-center rounded-[14px] bg-[#eef2f4] px-6 py-10 text-center text-sm leading-6 text-[#526873]">
                        <p>{currentImportedArticle?.siteName || "原文来源"} 的这张图片暂时无法显示，正文阅读不受影响。</p>
                      </div>
                    </figure>
                  );
                }
                return (
                  <figure
                    key={block.id}
                    data-reader-block={block.id}
                    className={`my-8 min-w-0 overflow-hidden lg:my-10 ${imageWidthClassName}`}
                  >
                    <div className="group relative overflow-hidden rounded-[14px] bg-[#f5f5f7]">
                      <img
                        alt={block.alt || ""}
                        className="h-auto max-h-[65vh] w-full max-w-full object-contain sm:max-h-[70vh]"
                        decoding="async"
                        data-reader-image={block.id}
                        height={block.height ?? FALLBACK_READER_IMAGE_HEIGHT}
                        fetchPriority={block.id === leadingImageBlockId ? "high" : "low"}
                        loading={block.id === leadingImageBlockId ? "eager" : "lazy"}
                        onError={(event) => {
                          preserveSourceAlignmentAfterImageLayout(event.currentTarget);
                          setFailedImageBlockIds((current) => new Set(current).add(block.id));
                        }}
                        onLoad={(event) => preserveSourceAlignmentAfterImageLayout(event.currentTarget)}
                        referrerPolicy="no-referrer"
                        sizes="(min-width: 1024px) 768px, calc(100vw - 40px)"
                        src={block.src}
                        width={block.width ?? FALLBACK_READER_IMAGE_WIDTH}
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

              if (block.type === "table" && block.table && block.tableRows) {
                return (
                  <figure key={block.id} data-reader-block={block.id} className="my-8 min-w-0 lg:my-10">
                    {block.table.caption && (
                      <figcaption className="mb-3 text-[15px] font-semibold leading-6 text-[#333333]">
                        {block.table.caption}
                      </figcaption>
                    )}
                    <div
                      className="overflow-x-auto overscroll-x-contain rounded-[10px] border border-[#d8d8dc] [scrollbar-gutter:stable]"
                      data-native-selection="blue"
                      tabIndex={0}
                      role="region"
                      aria-label={block.table.caption ? `表格：${block.table.caption}` : "文章表格，可横向滚动"}
                    >
                      <table className="w-max min-w-full border-collapse bg-white text-left text-[15px] leading-6 text-[#1d1d1f] sm:text-[16px]">
                        <tbody>
                          {block.tableRows.map((row, rowIndex) => (
                            <tr key={`${block.id}-row-${rowIndex}`} className={rowIndex % 2 ? "bg-[#fafafa]" : "bg-white"}>
                              {row.map(({ cell, tokens }, cellIndex) => {
                                const CellTag = cell.header ? "th" : "td";
                                return (
                                  <CellTag
                                    key={`${block.id}-cell-${rowIndex}-${cellIndex}`}
                                    className={`max-w-[34rem] whitespace-pre-wrap border-b border-r border-[#e3e3e6] px-3.5 py-2.5 align-top last:border-r-0 ${cell.header ? "bg-[#f3f4f5] font-semibold text-[#252525]" : "font-normal"}`}
                                    colSpan={cell.colSpan}
                                    rowSpan={cell.rowSpan}
                                    scope={cell.header ? cell.scope : undefined}
                                  >
                                    {tokens.length
                                      ? tokens.map((token) => (
                                          <WordToken
                                            key={token.id}
                                            token={token}
                                            selected={selectedTokenIdSet.has(token.id)}
                                            highlighted={highlightedSentenceTokenIdSet.has(token.id)}
                                            targeted={highlightedTargetTokenIdSet.has(token.id)}
                                          />
                                        ))
                                      : cell.text || <span aria-label="空单元格">&nbsp;</span>}
                                  </CellTag>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </figure>
                );
              }

              const Tag = block.type === "heading"
                ? "h1"
                : block.type === "subheading"
                  ? "h2"
                  : block.type === "quote"
                    ? "blockquote"
                    : block.type === "list-item"
                      ? "li"
                      : "p";
              return (
                <Tag
                  key={block.id}
                  data-reader-block={block.id}
                  className={`${textBlockClassName(block.type)} min-w-0 ${block.type === "list-item" ? block.listStyle === "ordered" ? "list-decimal" : "list-disc" : ""}`}
                  style={block.type === "list-item" ? { marginLeft: `${1.5 + Math.min(4, block.listLevel ?? 0) * 1.25}rem` } : undefined}
                  value={block.type === "list-item" && block.listStyle === "ordered" ? block.listOrdinal : undefined}
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
                      : block.plainText || <br />}
                </Tag>
              );
            })}
          </div>
          </>
          )}
        </article>

        <div className="hidden lg:block" aria-hidden="true" />
        <div
          className={`${toolbarStyles.readerSidePanel} hidden lg:fixed lg:bottom-6 lg:right-[max(1.25rem,calc((100vw-var(--reader-desktop-inset-left)-80rem)/2+1.25rem))] lg:top-20 lg:z-20 lg:block lg:w-[360px]`}
          data-native-selection="blue"
        >
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div data-reader-panel-tabs className="grid h-10 shrink-0 grid-cols-2 rounded-full border border-[#d2d2d7] bg-white p-1">
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
                  retryAfterSeconds={translationRetryAfterSeconds}
                  retryReason={translationRetryReason}
                  regenerating={translationRegenerating}
                  completedTargetBlocks={translationCompletedTargetBlocks}
                  totalTargetBlocks={translationTotalTargetBlocks}
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

      {dictionaryMounted && (
        <aside
          ref={dictionaryWindowRef}
          className={`${toolbarStyles.dictionaryWindow} ${dictionaryClosing ? toolbarStyles.dictionaryWindowClosing : ""}`}
          aria-label="单独查词窗口"
          onPointerUp={persistDictionaryWindow}
        >
          <header onPointerDown={startDictionaryDrag}>
            <span><ReaderRailIcon kind="dictionary" />单独查词</span>
            <button type="button" aria-label="隐藏单独查词窗口" onClick={closeDictionaryWindow}>×</button>
          </header>
          <div className={toolbarStyles.dictionaryWindowBody} data-local-scroll-surface>
            <BookDictionary
              embedded
              panel
              offline={isOffline}
              onAddToVocabulary={handleAddStandaloneDictionaryToVocabulary}
              isInVocabulary={isStandaloneDictionaryInVocabulary}
            />
          </div>
        </aside>
      )}

      {readerWorkLayer && (
        <div
          className={toolbarStyles.workLayerBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReaderWorkLayer(null);
          }}
        >
          <section className={toolbarStyles.workLayer} role="dialog" aria-modal="true" aria-label={readerWorkLayer === "import" ? "导入新文章" : "我的文章"}>
            <header>
              <div>
                <small>{readerWorkLayer === "import" ? "NEW READING" : "SAVED READING"}</small>
                <h2>{readerWorkLayer === "import" ? "换一篇文章继续读" : "我的文章"}</h2>
              </div>
              <button type="button" aria-label="关闭工作层" onClick={() => setReaderWorkLayer(null)}>×</button>
            </header>
            {readerWorkLayer === "import" ? (
              <div className={toolbarStyles.importWorkspace}>
                <div className={toolbarStyles.importTabs} role="tablist" aria-label="导入方式">
                  <button type="button" role="tab" aria-selected={readerImportMode === "text"} onClick={() => { setReaderImportMode("text"); setReaderImportStatus(""); }}>粘贴文章</button>
                  <button type="button" role="tab" aria-selected={readerImportMode === "url"} onClick={() => { setReaderImportMode("url"); setReaderImportStatus(""); }}>输入网址</button>
                </div>
                {readerImportMode === "text" ? (
                  <textarea
                    value={readerImportText}
                    onChange={(event) => { setReaderImportText(event.target.value); setReaderImportStatus(""); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        void submitReaderImport();
                      }
                    }}
                    placeholder="粘贴英文正文。段落与空行会被保留。"
                    data-native-selection="blue"
                  />
                ) : (
                  <div className={toolbarStyles.urlWorkspace}>
                    <input
                      type="url"
                      value={readerImportUrl}
                      onChange={(event) => { setReaderImportUrl(event.target.value); setReaderImportPreview(null); setReaderImportStatus(""); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void submitReaderImport();
                        }
                      }}
                      placeholder="https://example.com/article"
                      data-native-selection="blue"
                    />
                    {readerImportPreview && (
                      <article>
                        <small>{readerImportPreview.siteName || "文章预览"}</small>
                        <strong>{readerImportPreview.title || "未命名文章"}</strong>
                        <p>{readerImportPreview.text.slice(0, 180)}{readerImportPreview.text.length > 180 ? "…" : ""}</p>
                      </article>
                    )}
                  </div>
                )}
                <div className={toolbarStyles.importActionRow}>
                  <p role="status">{readerImportStatus || (readerImportMode === "text" ? "Ctrl / Cmd + Enter 也可以开始。" : "部分网站限制读取；失败时可以直接粘贴正文。")}</p>
                  <button type="button" disabled={readerImportBusy || !onOpenImportedArticle} onClick={() => void submitReaderImport()}>
                    {readerImportBusy ? "读取中…" : readerImportMode === "url" && !readerImportPreview ? "读取文章" : "开始阅读"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={toolbarStyles.savedWorkspace} data-local-scroll-surface>
                {savedArticles.length ? savedArticles.map((savedArticle) => (
                  <button
                    key={savedArticle.id}
                    type="button"
                    onClick={() => {
                      onOpenSavedArticle?.(savedArticle);
                      setReaderWorkLayer(null);
                    }}
                  >
                    <span>
                      <strong>{savedArticle.title || savedArticle.importedArticle?.title || "未命名文章"}</strong>
                      <small>{savedArticle.summary || savedArticle.body.slice(0, 96)}</small>
                    </span>
                  </button>
                )) : <p className={toolbarStyles.emptyWorkspace}>还没有保存文章。读到想留下的内容时，点击“保存文章”即可。</p>}
              </div>
            )}
          </section>
        </div>
      )}

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
            <div className="absolute inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-10 flex items-center gap-2 overflow-x-auto pb-1 sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:justify-end sm:overflow-visible sm:pb-0">
              <button
                type="button"
                className="h-11 shrink-0 rounded-full bg-white/95 px-4 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b] sm:h-8 sm:px-3"
                onClick={() => changeActiveImageZoom(-0.1)}
                disabled={activeImageZoom <= ACTIVE_IMAGE_MIN_ZOOM}
              >
                缩小
              </button>
              <span className="flex h-11 min-w-14 shrink-0 items-center justify-center rounded-full bg-white/95 px-3 text-center text-sm leading-none text-[#1d1d1f] sm:h-auto sm:py-1.5">
                {activeImageZoomPercent}%
              </span>
              <button
                type="button"
                className="h-11 shrink-0 rounded-full bg-white/95 px-4 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b] sm:h-8 sm:px-3"
                onClick={() => changeActiveImageZoom(0.1)}
                disabled={activeImageZoom >= ACTIVE_IMAGE_MAX_ZOOM}
              >
                放大
              </button>
              <button
                type="button"
                className="h-11 shrink-0 rounded-full bg-white/95 px-4 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b] sm:h-8 sm:px-3"
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
                className="h-11 shrink-0 rounded-full bg-white/95 px-4 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 sm:h-8 sm:px-3"
                onClick={() => downloadImage(activeImageBlock)}
              >
                下载
              </button>
              {!IMAGE_OCR_ENABLED && (
                <button
                  type="button"
                  className="h-11 shrink-0 rounded-full bg-white/95 px-4 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 sm:h-8 sm:px-3"
                  onClick={() => setActiveImageBlockId(null)}
                >
                  关闭
                </button>
              )}
            </div>
            <div
              ref={activeImageScrollRef}
              className="flex min-h-0 items-center justify-center overflow-hidden bg-[#111111] p-2 pb-20 sm:p-4 sm:pt-14"
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
                  height={activeImageBlock.height ?? FALLBACK_READER_IMAGE_HEIGHT}
                  referrerPolicy="no-referrer"
                  src={activeImageBlock.src}
                  width={activeImageBlock.width ?? FALLBACK_READER_IMAGE_WIDTH}
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

      {mobileExplanationOpen && (
        <div
          className={toolbarStyles.mobileToolSheet}
          style={{ height: `${mobileExplanationHeight}dvh` }}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          <div
            className={toolbarStyles.mobileSheetHandle}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerEnd}
            onPointerCancel={handleResizePointerEnd}
          >
            <span className="h-1.5 w-8 rounded-full bg-[#d2d2d7]" />
          </div>
          <div className={toolbarStyles.mobileSheetHeader}>
            <strong>
              {rightPanelMode === "explanation"
                ? "词句解释"
                : rightPanelMode === "translation"
                  ? "全文翻译"
                  : rightPanelMode === "dictionary"
                    ? "单独查词"
                    : "文章操作"}
            </strong>
            <button type="button" onClick={() => setMobileExplanationOpen(false)}>回到原文</button>
          </div>
          <div className={toolbarStyles.mobileSheetBody} data-local-scroll-surface>
            {rightPanelMode === "explanation" && (
              hasExplanationPanelContent ? (
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
              ) : (
                <div className={toolbarStyles.mobileToolEmpty}>
                  <strong>先点击一个英文词</strong>
                  <p>直接点击查单词；需要查短语时，横向拖动或长按后选择。上下滑动始终用于阅读。</p>
                </div>
              )
            )}
            {rightPanelMode === "translation" && (
              <ArticleTranslationPanel
                blocks={translationBlocks}
                translations={articleTranslations}
                loading={translationLoading}
                error={translationError}
                requested={translationRequested}
                estimatedSecondsRemaining={translationEstimatedSecondsRemaining}
                retryAfterSeconds={translationRetryAfterSeconds}
                retryReason={translationRetryReason}
                regenerating={translationRegenerating}
                completedTargetBlocks={translationCompletedTargetBlocks}
                totalTargetBlocks={translationTotalTargetBlocks}
                staleBlockIds={staleTranslationBlockIds}
                removedTranslationCount={removedTranslationCount}
                onGenerate={() => generateArticleTranslation(false)}
                onRegenerate={() => generateArticleTranslation(true)}
              />
            )}
            {rightPanelMode === "dictionary" && (
              <div className={toolbarStyles.mobileDictionary}>
                <BookDictionary
                  compact
                  panel
                  offline={isOffline}
                  onAddToVocabulary={handleAddStandaloneDictionaryToVocabulary}
                  isInVocabulary={isStandaloneDictionaryInVocabulary}
                />
              </div>
            )}
            {rightPanelMode === "article" && (
              <div className={toolbarStyles.mobileArticleActions}>
                <p>低频操作收在这里，正文仍保持完整宽度。</p>
                <div>
                  <button type="button" onClick={() => void undoSavedArticleEdit()} disabled={savingArticleEdit || (!editingArticle && articleUndoStack.length === 0)}>后退一步</button>
                  <button type="button" onClick={() => void redoSavedArticleEdit()} disabled={savingArticleEdit || (!editingArticle && articleRedoStack.length === 0)}>前进一步</button>
                  {editingArticle ? (
                    <>
                      <button type="button" onClick={cancelArticleEditing} disabled={savingArticleEdit}>取消编辑</button>
                      <button type="button" onClick={() => void saveArticleEditing()} disabled={savingArticleEdit}>{savingArticleEdit ? "保存中…" : "保存编辑"}</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => { beginArticleEditing(); setMobileExplanationOpen(false); }}>编辑文章</button>
                  )}
                  <button type="button" onClick={handleCopyArticle} disabled={editingArticle}>复制文章内容</button>
                  <button type="button" onClick={handleSaveArticle} disabled={articleSaved || savingArticle || savingArticleEdit || editingArticle}>{saveButtonText}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <nav className={toolbarStyles.mobileToolDock} aria-label="阅读工具">
        <button type="button" aria-pressed={mobileExplanationOpen && rightPanelMode === "explanation"} onClick={() => openMobileTool("explanation")}>解释</button>
        <button type="button" aria-pressed={mobileExplanationOpen && rightPanelMode === "translation"} onClick={() => openMobileTool("translation")}>翻译</button>
        <button type="button" aria-pressed={mobileExplanationOpen && rightPanelMode === "dictionary"} onClick={() => openMobileTool("dictionary")}>查词</button>
        <button type="button" onClick={handleOpenVocabulary}>生词本</button>
        <button type="button" aria-pressed={mobileExplanationOpen && rightPanelMode === "article"} onClick={() => openMobileTool("article")}>更多</button>
      </nav>

      <HomeOptionMenu
        open={readerMenuOpen}
        placement={readerMenuPlacement}
        initialPreview={readerMenuInitialPreview}
        standalonePreview={readerMenuStandalonePreview}
        isAdmin={account.plan?.id === "admin"}
        account={account}
        isOffline={isOffline}
        localAccount={localAccount}
        theme={readerTheme}
        onThemeChange={handleReaderThemeChange}
        savedArticles={hasLocalAccountAccess ? savedArticles : []}
        vocabularyEntries={hasLocalAccountAccess ? vocabularyEntries : []}
        onVocabularyEntriesChange={setVocabularyEntries}
        onClose={handleCloseVocabulary}
        onOpenSavedArticle={(savedArticle) => onOpenSavedArticle?.(savedArticle)}
        onJumpToVocabularySource={handleJumpToVocabularySource}
        canJumpToVocabularySource={(entry) =>
          canJumpToSourceSentence(entry.sourceSentence) ||
          Boolean(canJumpToVocabularySourceOutsideArticle?.(entry)) ||
          Boolean(findBestSourceSentenceMatch(entry.sourceSentence, entry.word, wordTokens))
        }
        onOpenImport={() => setReaderWorkLayer("import")}
        onOpenDictionary={openDictionaryWindow}
        ankiTools={{
          settings: ankiSettings,
          status: ankiStatus,
          checking: checkingAnki,
          importingId,
          importError,
          onSettingsChange: setAnkiSettings,
          onCheck: () => void handleCheckAnki(),
          onImport: (entry) => void handleImportAnki(entry),
          onImportAll: () => void handleImportAllAnki(),
        }}
        vocabularyTools={{
          onDelete: (id) => {
            if (window.confirm("确定删除这个生词吗？")) handleDeleteVocabulary(id);
          },
          onClear: handleClearVocabulary,
          onExportCsv: handleExportCsv,
          onCopy: (entry) => void handleCopyEntry(entry),
        }}
      />
    </main>
  );
}

