"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnkiSettingsPanel, defaultAnkiSettings } from "@/components/AnkiSettingsPanel";
import { ExplanationPanel } from "@/components/ExplanationPanel";
import { VocabularyPanel } from "@/components/VocabularyPanel";
import { WordToken } from "@/components/WordToken";
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
import type { ReaderToken, WordContext, WordExplanation } from "@/types/reader";
import type { VocabularyEntry } from "@/types/vocabulary";

interface ReaderViewProps {
  article: string;
  onBack: () => void;
  onArticleSaved: () => void;
}

interface TouchInteraction {
  token: ReaderToken;
  x: number;
  y: number;
  moved: boolean;
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

export function ReaderView({ article, onBack, onArticleSaved }: ReaderViewProps) {
  const paragraphs = useMemo(() => tokenizeArticle(article), [article]);
  const wordTokens = useMemo(
    () => paragraphs.flatMap((paragraph) => paragraph.tokens.filter((token) => token.type === "word")),
    [paragraphs],
  );
  const tokenById = useMemo(
    () => new Map(wordTokens.map((token) => [token.id, token])),
    [wordTokens],
  );
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
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
  const abortRef = useRef<AbortController | null>(null);
  const suppressNextClickRef = useRef(false);
  const touchInteractionRef = useRef<TouchInteraction | null>(null);

  useEffect(() => {
    setVocabularyEntries(getVocabularyEntries());
  }, []);

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

    return wordTokens.filter(
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
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        return;
      }
      handleTokenPointerDown(token);
    }
  }

  function handleArticlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      const interaction = touchInteractionRef.current;
      if (interaction) {
        const moved =
          Math.abs(event.clientX - interaction.x) > 10 ||
          Math.abs(event.clientY - interaction.y) > 10;
        if (moved) {
          interaction.moved = true;
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
      const interaction = touchInteractionRef.current;
      touchInteractionRef.current = null;
      if (interaction && token?.id === interaction.token.id && !interaction.moved) {
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

  function handleArticlePointerCancel() {
    touchInteractionRef.current = null;
    setDragStartToken(null);
    setDragCurrentToken(null);
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
      const response = await fetch("/api/anki/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: ankiSettings.endpoint }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; version?: number; error?: string }
        | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "AnkiConnect 检测失败。");
      }
      setAnkiStatus(`连接成功，AnkiConnect version: ${data.version}`);
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
      const response = await fetch("/api/anki/add-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: ankiSettings.endpoint,
          deckName: ankiSettings.deckName,
          entry,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ankiNoteId?: number; error?: string }
        | null;

      if (!response.ok || typeof data?.ankiNoteId !== "number") {
        throw new Error(data?.error || "导入 Anki 失败，请稍后重试。");
      }

      setVocabularyEntries(markVocabularyEntryImported(entry.id, data.ankiNoteId));
    } catch (ankiError) {
      setImportError(ankiError instanceof Error ? ankiError.message : "导入 Anki 失败，请稍后重试。");
    } finally {
      setImportingId("");
    }
  }

  async function handleSaveArticle() {
    setSavingArticle(true);
    setSaveStatus("正在生成中文摘要...");
    try {
      const summary = await requestArticleSummary(article);
      saveArticle(article, summary);
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

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50"
            onClick={onBack}
          >
            返回编辑
          </button>
          <div className="flex items-center gap-2">
            {saveStatus && <span className="text-sm text-green-700">{saveStatus}</span>}
            <button
              type="button"
              className="hidden rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 lg:inline-flex"
              onClick={handleCopyArticle}
            >
              复制文章内容
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              onClick={handleSaveArticle}
              disabled={savingArticle}
            >
              {saveButtonText}
            </button>
            <button
              type="button"
              className="rounded-md bg-gray-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
              onClick={() => setVocabularyOpen(true)}
            >
              生词本
            </button>
          </div>
        </div>
      </header>

      <div
        className={`mx-auto grid max-w-7xl gap-5 px-4 pt-6 lg:grid-cols-[minmax(0,1fr)_360px] ${
          hasExplanationPanelContent && mobileExplanationOpen ? "pb-[54dvh] lg:pb-6" : "pb-6"
        }`}
      >
        <article className="min-h-[70vh] rounded-md border border-gray-200 bg-white px-5 py-6 shadow-sm sm:px-8 lg:px-12">
          <div
            className="mx-auto max-w-3xl font-serif text-xl leading-10 text-gray-900"
            onPointerDown={handleArticlePointerDown}
            onPointerMove={handleArticlePointerMove}
            onPointerUp={handleArticlePointerUp}
            onPointerCancel={handleArticlePointerCancel}
            onClick={handleArticleClick}
          >
            {paragraphs.map((paragraph) => (
              <p key={paragraph.id} className="mb-7 whitespace-pre-wrap">
                {paragraph.tokens.map((token) => (
                  <WordToken
                    key={token.id}
                    token={token}
                    selected={selectedTokenIds.includes(token.id)}
                  />
                ))}
              </p>
            ))}
          </div>
        </article>

        <div className="hidden lg:block">
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

      {hasExplanationPanelContent && mobileExplanationOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 flex h-[50dvh] min-h-0 touch-pan-y overflow-hidden border-t border-gray-200 bg-white p-3 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] overscroll-contain lg:hidden"
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
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
