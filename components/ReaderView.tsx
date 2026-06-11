"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AnkiSettingsPanel, defaultAnkiSettings } from "@/components/AnkiSettingsPanel";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { VocabularyPanel } from "@/components/VocabularyPanel";
import { WordToken } from "@/components/WordToken";
import { addVocabularyNote, checkAnki } from "@/lib/ankiConnect";
import { findSavedArticle, isValidArticleSummary, saveArticle } from "@/lib/articles";
import { createExplanationCacheKey, getCachedExplanation, setCachedExplanation } from "@/lib/cache";
import { downloadVocabularyCsv } from "@/lib/csv";
import { tokenizeArticle, tokenToWordContext } from "@/lib/tokenizer";
import {
  addVocabularyEntry,
  clearVocabularyEntries,
  createVocabularyEntry,
  deleteVocabularyEntry,
  getVocabularyEntries,
  markVocabularyEntryImported,
  vocabularyIdentity,
} from "@/lib/vocabulary";
import type { AnkiSettings } from "@/types/anki";
import type { ImportedArticle, ImportedArticleBlock, ImportedArticleInlineBaseline, ImportedArticleInlineText } from "@/types/article";
import type { PublicExplanation } from "@/types/publicArticle";
import type { ReaderToken, WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";

interface ReaderViewProps {
  article: string;
  importedArticle?: ImportedArticle | null;
  preloadedExplanations?: PublicExplanation[];
  onBack: () => void;
  onArticleSaved: () => void;
  onImportedArticleChange?: (article: ImportedArticle) => void;
}

interface RenderableArticleBlock {
  id: string;
  type: ImportedArticleBlock["type"];
  tokens?: ReaderToken[];
  tokenGroups?: RenderableTokenGroup[];
  src?: string;
  alt?: string;
  ocrStatus?: ImageOcrStatus;
  ocrError?: string;
}

interface RenderableTokenGroup {
  id: string;
  baseline?: ImportedArticleInlineBaseline;
  tokens: ReaderToken[];
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

type ImageOcrStatus = "idle" | "loading" | "ready" | "error";

const IMAGE_OCR_ENABLED = false;

interface ImageOcrState {
  status: ImageOcrStatus;
  text: string;
  error: string;
}

async function requestExplanation(
  context: WordContext,
  signal: AbortSignal,
): Promise<WordExplanation> {
  const response = await fetch("/api/explain-word", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      word: context.word,
      sentence: context.sentence,
      previousSentence: context.previousSentence,
      nextSentence: context.nextSentence,
    }),
    signal,
  });

  const data = (await response.json().catch(() => null)) as
    | { explanation?: WordExplanation; error?: string }
    | null;

  if (!response.ok) {
    throw new Error(data?.error || "解释失败，请稍后重试。");
  }

  if (!data?.explanation?.anki) {
    throw new Error("解释结果缺少 Anki 制卡字段，请重新点击该词。");
  }

  return data.explanation;
}

function buildEntryText(entry: VocabularyEntry): string {
  return [
    `${entry.word} (${entry.lemma})`,
    entry.phonetic ? `音标：${entry.phonetic}` : "",
    `词性：${entry.partOfSpeech}`,
    `基础释义：${entry.basicMeaning}`,
    `语境含义：${entry.contextMeaning}`,
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
  const response = await fetch("/api/summarize-article", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ article }),
  });
  const data = (await response.json().catch(() => null)) as { summary?: string; error?: string } | null;

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
  onBack,
  onArticleSaved,
  onImportedArticleChange,
}: ReaderViewProps) {
  const [imageOcr, setImageOcr] = useState<Record<string, ImageOcrState>>({});
  const [activeImageBlockId, setActiveImageBlockId] = useState<string | null>(null);
  const [activeImageZoom, setActiveImageZoom] = useState(1);
  const paragraphs = useMemo(
    () => (importedArticle?.blocks?.length ? [] : tokenizeArticle(article)),
    [article, importedArticle?.blocks?.length],
  );
  const effectiveImportedArticle = useMemo<ImportedArticle | null>(() => {
    if (!importedArticle?.blocks?.length) {
      return importedArticle ?? null;
    }

    return {
      ...importedArticle,
      blocks: importedArticle.blocks.map((block) => {
        if (block.type !== "image") {
          return block;
        }
        const recognizedText = imageOcr[block.id]?.text || block.ocrText || "";
        return {
          ...block,
          ...(recognizedText ? { ocrText: recognizedText } : {}),
        };
      }),
    };
  }, [imageOcr, importedArticle]);
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
          const ocrText = ocrState?.text || block.ocrText?.trim() || "";
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
            tokens,
            ocrStatus: ocrText ? "ready" : ocrState?.status ?? "idle",
            ocrError: ocrState?.error,
          };
        }

        const text = block.text?.trim();
        if (!text) {
          return null;
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
  const [dragStartToken, setDragStartToken] = useState<ReaderToken | null>(null);
  const [dragCurrentToken, setDragCurrentToken] = useState<ReaderToken | null>(null);
  const [selectedContext, setSelectedContext] = useState<WordContext | null>(null);
  const [explanation, setExplanation] = useState<WordExplanation | null>(null);
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
  const abortRef = useRef<AbortController | null>(null);
  const suppressNextClickRef = useRef(false);
  const touchInteractionRef = useRef<TouchInteraction | null>(null);
  const touchSelectTimerRef = useRef<number | null>(null);
  const resizeInteractionRef = useRef<ResizeInteraction | null>(null);
  const propagatedImportedArticleRef = useRef("");

  useEffect(() => {
    setVocabularyEntries(getVocabularyEntries());
  }, []);

  useEffect(() => {
    for (const item of preloadedExplanations) {
      setCachedExplanation(item.cacheKey, item.explanation);
    }
  }, [preloadedExplanations]);

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
    if (!IMAGE_OCR_ENABLED || !importedArticle?.blocks?.length) {
      return;
    }

    const imageBlocks = importedArticle.blocks.filter((block) => block.type === "image" && block.src);
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
  }, [imageOcr, importedArticle]);

  useEffect(() => {
    if (!activeImageBlockId) {
      return;
    }

    setActiveImageZoom(1);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveImageBlockId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeImageBlockId]);

  const articleSaved = useMemo(() => {
    const savedArticle = findSavedArticle(article);
    const summary = savedArticle?.summary?.trim();
    return Boolean(summary && isValidArticleSummary(summary));
  }, [article]);

  function getTokenRange(startToken: ReaderToken, endToken: ReaderToken): ReaderToken[] {
    if (startToken.paragraphIndex !== endToken.paragraphIndex) {
      return [endToken];
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

  const isInVocabulary =
    explanation && selectedContext
      ? vocabularyEntries.some(
          (entry) =>
            vocabularyIdentity(entry) ===
            vocabularyIdentity({
              word: explanation.word,
              sourceSentence: selectedContext.sentence,
            }),
        )
      : false;

  async function explainContext(context: WordContext, tokenIds: string[]) {
    const cacheKey = createExplanationCacheKey(context.word, context.sentence);

    abortRef.current?.abort();
    setSelectedTokenIds(tokenIds);
    setSelectedContext(context);
    setError("");
    setMobileExplanationOpen(true);

    const cached = getCachedExplanation(cacheKey);
    if (cached) {
      setExplanation(cached);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setExplanation(null);

    try {
      const nextExplanation = await requestExplanation(context, controller.signal);
      setCachedExplanation(cacheKey, nextExplanation);
      setExplanation(nextExplanation);
    } catch (requestError) {
      if (controller.signal.aborted) {
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "解释失败，请稍后重试。");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
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
      handleTokenPointerDown(token);
    }
  }

  function handleArticlePointerMove(event: React.PointerEvent<HTMLElement>) {
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

      const finalToken = tokenFromPoint(event.clientX, event.clientY) ?? interaction.currentToken;
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
    if (!explanation || !selectedContext) {
      return;
    }

    const entry = createVocabularyEntry(explanation, selectedContext);
    setVocabularyEntries(addVocabularyEntry(entry));
  }

  function handleDeleteVocabulary(id: string) {
    setVocabularyEntries(deleteVocabularyEntry(id));
  }

  function handleClearVocabulary() {
    if (!window.confirm("确定要清空生词本吗？")) {
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

  async function handleCopyArticle() {
    try {
      await navigator.clipboard.writeText(article);
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
    setSavingArticle(true);
    setSaveStatus("正在生成中文摘要...");
    try {
      const summary = await requestArticleSummary(article);
      saveArticle(article, summary, effectiveImportedArticle);
      onArticleSaved();
      setSaveStatus("文章已保存");
    } catch (summaryError) {
      setSaveStatus(summaryError instanceof Error ? summaryError.message : "文章摘要生成失败，请稍后重试。");
    } finally {
      setSavingArticle(false);
      window.setTimeout(() => setSaveStatus(""), 2600);
    }
  }

  const saveButtonText = savingArticle ? "保存中" : articleSaved ? "重新生成摘要" : "保存文章";
  const hasExplanationPanelContent = Boolean(selectedContext || loading || explanation || error);
  const activeImageBlock = useMemo(
    () => renderableBlocks.find((block) => block.type === "image" && block.id === activeImageBlockId) ?? null,
    [activeImageBlockId, renderableBlocks],
  );
  const activeImageZoomPercent = Math.round(activeImageZoom * 100);
  const activeImageWidth = activeImageZoom === 1 ? "100%" : `${activeImageZoom * 100}%`;

  function changeActiveImageZoom(delta: number) {
    setActiveImageZoom((current) => Math.min(3, Math.max(1, Number((current + delta).toFixed(2)))));
  }

  function renderTokenList(tokens?: ReaderToken[]) {
    return tokens?.map((token) => (
      <WordToken
        key={token.id}
        token={token}
        selected={selectedTokenIdSet.has(token.id)}
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
            onClick={onBack}
          >
            返回编辑
          </button>
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {saveStatus && <span className="shrink-0 text-sm text-[#333333]">{saveStatus}</span>}
            <button
              type="button"
              className="hidden h-9 shrink-0 rounded-full border border-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-[#0066cc] transition active:scale-95 lg:inline-flex lg:items-center"
              onClick={handleCopyArticle}
            >
              复制文章内容
            </button>
            <button
              type="button"
              className="h-9 shrink-0 rounded-full border border-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-[#0066cc] transition active:scale-95 disabled:cursor-not-allowed disabled:border-[#d2d2d7] disabled:text-[#7a7a7a]"
              onClick={handleSaveArticle}
              disabled={savingArticle}
            >
              {saveButtonText}
            </button>
            <button
              type="button"
              className="h-9 shrink-0 rounded-full bg-[#0066cc] px-4 text-sm leading-none tracking-[-0.224px] text-white transition active:scale-95"
              onClick={() => setVocabularyOpen(true)}
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
          {importedArticle && (
            <header className="mx-auto mb-10 max-w-3xl border-b border-[#e0e0e0] pb-6">
              <p className="text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                {importedArticle.siteName}
              </p>
              <a
                className="mt-2 block break-all text-sm leading-5 tracking-[-0.224px] text-[#0066cc]"
                href={importedArticle.url}
                rel="noreferrer"
                target="_blank"
              >
                {importedArticle.url}
              </a>
            </header>
          )}
          <div
            className="mx-auto max-w-3xl overflow-x-hidden break-words [overflow-wrap:anywhere]"
            onPointerDown={handleArticlePointerDown}
            onPointerMove={handleArticlePointerMove}
            onPointerUp={handleArticlePointerUp}
            onPointerCancel={handleArticlePointerCancel}
            onClick={handleArticleClick}
          >
            {renderableBlocks.map((block) => {
              if (block.type === "image") {
                if (!block.src) {
                  return null;
                }
                return (
                  <figure key={block.id} className="my-8 min-w-0 overflow-hidden lg:my-10 lg:[content-visibility:auto] lg:[contain-intrinsic-size:720px]">
                    <button
                      type="button"
                      className="group relative block w-full overflow-hidden rounded-[14px] bg-[#f5f5f7] text-left outline-none ring-0 transition focus-visible:ring-2 focus-visible:ring-[#0066cc] active:scale-[0.998]"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveImageBlockId(block.id);
                      }}
                    >
                      <img
                        alt={block.alt || ""}
                        className="h-auto max-h-[65vh] w-full max-w-full object-contain sm:max-h-[70vh]"
                        decoding="async"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        sizes="(min-width: 1024px) 768px, calc(100vw - 40px)"
                        src={block.src}
                      />
                      <span className="absolute right-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-medium leading-5 text-[#1d1d1f] opacity-95 shadow-sm transition group-hover:bg-white">
                        点击放大
                      </span>
                    </button>
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
                <Tag key={block.id} className={`${textBlockClassName(block.type)} min-w-0 lg:[content-visibility:auto] lg:[contain-intrinsic-size:120px]`}>
                  {block.tokenGroups?.length
                    ? block.tokenGroups.map((group) => {
                        const content = group.tokens.map((token) => (
                          <WordToken
                            key={token.id}
                            token={token}
                            selected={selectedTokenIdSet.has(token.id)}
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
                    : block.tokens?.map((token) => (
                        <WordToken
                          key={token.id}
                          token={token}
                          selected={selectedTokenIdSet.has(token.id)}
                        />
                      ))}
                </Tag>
              );
            })}
          </div>
        </article>

        <div className="hidden lg:block" aria-hidden="true" />
        <div className="hidden lg:fixed lg:bottom-6 lg:right-[max(1.25rem,calc((100vw-80rem)/2+1.25rem))] lg:top-20 lg:z-20 lg:block lg:w-[360px]">
          <ExplanationPanel
            explanation={explanation}
            selectedContext={selectedContext}
            loading={loading}
            error={error}
            isInVocabulary={Boolean(isInVocabulary)}
            onAddToVocabulary={handleAddToVocabulary}
          />
        </div>
      </div>

      {activeImageBlock?.src && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="放大图片"
          onClick={() => setActiveImageBlockId(null)}
        >
          <div
            className={`grid max-h-[92dvh] w-full min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[18px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)] ${
              IMAGE_OCR_ENABLED ? "max-w-6xl lg:grid-cols-[minmax(0,1fr)_360px]" : "max-w-5xl"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="min-h-0 overflow-auto bg-[#111111] p-2 sm:p-4">
              <div className="sticky top-0 z-10 mb-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="h-8 rounded-full bg-white/95 px-3 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b]"
                  onClick={() => changeActiveImageZoom(-0.25)}
                  disabled={activeImageZoom <= 1}
                >
                  缩小
                </button>
                <span className="min-w-14 rounded-full bg-white/95 px-3 py-1.5 text-center text-sm leading-none text-[#1d1d1f]">
                  {activeImageZoomPercent}%
                </span>
                <button
                  type="button"
                  className="h-8 rounded-full bg-white/95 px-3 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b]"
                  onClick={() => changeActiveImageZoom(0.25)}
                  disabled={activeImageZoom >= 3}
                >
                  放大
                </button>
                <button
                  type="button"
                  className="h-8 rounded-full bg-white/95 px-3 text-sm leading-none text-[#1d1d1f] transition hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:text-[#86868b]"
                  onClick={() => setActiveImageZoom(1)}
                  disabled={activeImageZoom === 1}
                >
                  适合
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
              <img
                alt={activeImageBlock.alt || ""}
                className="mx-auto h-auto max-w-none object-contain"
                decoding="async"
                referrerPolicy="no-referrer"
                src={activeImageBlock.src}
                style={{
                  width: activeImageWidth,
                  minWidth: activeImageZoom === 1 ? "0" : activeImageWidth,
                }}
              />
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
            selectedContext={selectedContext}
            loading={loading}
            error={error}
            isInVocabulary={Boolean(isInVocabulary)}
            onAddToVocabulary={handleAddToVocabulary}
            onCollapse={() => setMobileExplanationOpen(false)}
          />
        </div>
      )}

      <VocabularyPanel
        entries={vocabularyEntries}
        open={vocabularyOpen}
        importingId={importingId}
        importError={importError}
        onClose={() => setVocabularyOpen(false)}
        onDelete={handleDeleteVocabulary}
        onClear={handleClearVocabulary}
        onExportCsv={handleExportCsv}
        onCopy={handleCopyEntry}
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
