"use client";

import { useEffect, useRef, useState } from "react";
import { PronunciationButtons } from "@/components/PronunciationButtons";
import ClearableField from "@/components/ClearableField";
import { fetchJson } from "@/lib/apiClient";
import { normalizeDifficultyLabel, normalizePartOfSpeechLabel, originalFormLabel } from "@/lib/displayLabels";
import { explanationStreamValue, parseExplanationStream } from "@/lib/explanationDisplay";
import { currentFormPhonetic, pronunciationTargetMatches } from "@/lib/pronunciation";
import type { WordContext, WordExplanation } from "@/types/reader";

interface ExplanationPanelProps {
  explanation: WordExplanation | null;
  streamText?: string;
  streaming?: boolean;
  selectedContext: WordContext | null;
  loading: boolean;
  error: string;
  isInVocabulary: boolean;
  vocabularyMatchNotice?: string;
  showLearningActions?: boolean;
  onAddToVocabulary: () => void;
  onRegenerate?: () => void;
  onCollapse?: () => void;
}

function buildExplanationText(explanation: WordExplanation, context: WordContext | null): string {
  const selectedKind = selectedTextKind(context?.word ?? explanation.word);
  const phonetic = currentFormPhonetic(explanation);
  return [
    `当前词：${explanation.word}`,
    explanation.lemma ? `原型：${explanation.lemma}` : "",
    phonetic ? `当前词音标（${explanation.word}）：${phonetic}` : "",
    `词性：${explanation.partOfSpeech}`,
    `基础释义：${explanation.basicMeaning}`,
    `${meaningLabel(selectedKind)}：${explanation.contextMeaning}`,
    `原句：${context?.sentence ?? ""}`,
    `句子翻译：${explanation.sentenceTranslation}`,
    `用法说明：${explanation.usageNote}`,
    explanation.collocation ? `常见搭配：${explanation.collocation}` : "",
    `例句：${explanation.exampleEnglish}`,
    `例句翻译：${explanation.exampleChinese}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function selectedTextKind(value: string): "word" | "phrase" {
  return value.trim().split(/\s+/).filter(Boolean).length > 1 ? "phrase" : "word";
}

function meaningLabel(kind: "word" | "phrase"): string {
  return kind === "phrase" ? "所选短语在本句中的含义" : "所选词在本句中的含义";
}

function displaySectionLabel(label: string, kind: "word" | "phrase"): string {
  return label === "当前语境含义" ? meaningLabel(kind) : label;
}

export function ExplanationPanel({
  explanation,
  streamText = "",
  streaming = false,
  selectedContext,
  loading,
  error,
  isInVocabulary,
  vocabularyMatchNotice = "",
  showLearningActions = true,
  onAddToVocabulary,
  onRegenerate,
  onCollapse,
}: ExplanationPanelProps) {
  const [sentenceQuestion, setSentenceQuestion] = useState("");
  const [sentenceAnswer, setSentenceAnswer] = useState("");
  const [sentenceQuestionError, setSentenceQuestionError] = useState("");
  const [askingSentenceQuestion, setAskingSentenceQuestion] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const streamSections = parseExplanationStream(streamText);
  const displayStream = Boolean(streamText || streaming);
  const streamLemma = explanationStreamValue(streamSections, ["lemma", "Lemma", "词元", "原形", "原型"]);
  const rawStreamPhonetic = explanationStreamValue(streamSections, ["当前词音标", "音标", "phonetic", "Phonetic"]);
  const streamPhoneticFor = explanationStreamValue(streamSections, ["当前词音标归属", "音标归属", "phoneticFor"]);
  const streamPartOfSpeech = explanationStreamValue(streamSections, ["词性", "partOfSpeech"]);
  const streamDifficulty = explanationStreamValue(streamSections, ["难度", "difficulty"]);
  const selectedKind = selectedTextKind(selectedContext?.word ?? explanation?.word ?? "");
  const streamOriginalForm = selectedKind === "phrase"
    ? ""
    : originalFormLabel(streamLemma, selectedContext?.word ?? "");
  const streamWord = selectedContext?.word ?? "";
  const streamPhonetic = rawStreamPhonetic && (
    pronunciationTargetMatches(streamPhoneticFor, streamWord)
    || (!streamPhoneticFor && pronunciationTargetMatches(streamLemma, streamWord))
  ) ? rawStreamPhonetic : "";
  const visibleStreamSections = streamSections.filter(
    (section) => !["lemma", "Lemma", "词元", "原形", "原型", "当前词音标", "音标", "phonetic", "Phonetic", "当前词音标归属", "音标归属", "phoneticFor", "词性", "partOfSpeech", "难度", "difficulty"].includes(section.label.trim()),
  );
  const savedPhonetic = explanation
    ? currentFormPhonetic(explanation)
    : "";

  useEffect(() => {
    setSentenceQuestion("");
    setSentenceAnswer("");
    setSentenceQuestionError("");
    setAskingSentenceQuestion(false);
    panelRef.current?.scrollTo({ top: 0, left: 0 });
  }, [selectedContext?.word, selectedContext?.sentence]);

  async function handleCopy() {
    if (!explanation) {
      return;
    }

    try {
      await navigator.clipboard.writeText(buildExplanationText(explanation, selectedContext));
    } catch {
      window.alert("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  async function handleAskSentenceQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = sentenceQuestion.trim();
    if (!selectedContext || !question) {
      return;
    }

    setAskingSentenceQuestion(true);
    setSentenceQuestionError("");
    setSentenceAnswer("");

    try {
      const { response, data } = await fetchJson<{ answer?: string; error?: string }>("/api/ask-sentence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          word: selectedContext.word,
          sentence: selectedContext.sentence,
          previousSentence: selectedContext.previousSentence,
          nextSentence: selectedContext.nextSentence,
          question,
        }),
      }, "提问失败，请稍后重试。", {
        operation: "sentence_question",
        metadata: {
          sentenceCharacters: selectedContext.sentence.length,
          questionCharacters: question.length,
        },
      });

      if (!response.ok || !data?.answer?.trim()) {
        throw new Error(data?.error || "提问失败，请稍后重试。");
      }

      setSentenceAnswer(data.answer.trim());
    } catch (askError) {
      setSentenceQuestionError(askError instanceof Error ? askError.message : "提问失败，请稍后重试。");
    } finally {
      setAskingSentenceQuestion(false);
    }
  }

  function handleSentenceQuestionKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <aside ref={panelRef} className="cr-reader-panel relative h-full min-h-0 w-full flex-1 overflow-y-auto rounded-[14px] border border-[#e0e0e0] bg-white p-5 overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)]">
      <div className="sticky top-0 z-10 h-0 lg:hidden">
        <button
          type="button"
          className="float-right h-10 rounded-full border border-[#0066cc] bg-white px-4 text-sm tracking-[-0.224px] text-[#0066cc] shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
          onClick={onCollapse}
        >
          收起
        </button>
      </div>
      <div className="h-8 lg:hidden" />

      {!selectedContext && !loading && !explanation && (
        <p className="text-sm leading-6 tracking-[-0.224px] text-[#7a7a7a]">点击文章中的任意英文单词查看语境解释。</p>
      )}

      {loading && !streamText && <p className="text-sm leading-6 tracking-[-0.224px] text-[#333333]">正在分析语境...</p>}

      {displayStream && (
        <div className="space-y-4 pb-5">
          <header>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">{selectedContext?.word}</h2>
                {streamOriginalForm && (
                  <p className="mt-1 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                    原型：{streamOriginalForm}
                  </p>
                )}
              </div>
              {streamDifficulty && (
                <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-xs font-medium text-[#333333]">
                  {normalizeDifficultyLabel(streamDifficulty)}
                </span>
              )}
            </div>
            {streamPhonetic && (
              <p className="mt-2 text-sm leading-5 tracking-[-0.224px] text-[#555555]">
                <span className="font-medium text-[#7a7a7a]">当前词音标：</span>{streamPhonetic}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {streamPartOfSpeech && <p className="text-sm font-semibold tracking-[-0.224px] text-[#333333]">{normalizePartOfSpeechLabel(streamPartOfSpeech)}</p>}
              <PronunciationButtons text={selectedContext?.word ?? ""} preload />
              {onRegenerate && selectedContext && (
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#0066cc] text-base leading-none text-[#0066cc] transition hover:bg-[#f5f9ff] active:scale-95"
                  onClick={onRegenerate}
                  aria-label="重新生成解释和翻译"
                  title="重新生成解释和翻译"
                >
                  ↻
                </button>
              )}
            </div>
          </header>

          <dl className="space-y-3 text-sm leading-6 tracking-[-0.224px]">
            {visibleStreamSections.map((section, index) => (
              <div key={`${section.label}-${index}`}>
                <dt className="font-semibold text-[#1d1d1f]">{displaySectionLabel(section.label, selectedKind)}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-[#333333]">
                  {section.value}
                  {streaming && index === visibleStreamSections.length - 1 && (
                    <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse rounded-full bg-[#0066cc]" />
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {!streaming && explanation && (
            <>
              {showLearningActions && <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-10 min-w-[112px] shrink-0 whitespace-nowrap rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7]"
                  onClick={onAddToVocabulary}
                  disabled={isInVocabulary}
                >
                  {isInVocabulary ? "已加入生词本" : "加入生词本"}
                </button>
                <button
                  type="button"
                  className="h-10 min-w-[92px] shrink-0 whitespace-nowrap rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
                  onClick={handleCopy}
                >
                  复制解释
                </button>
              </div>}
              {showLearningActions && vocabularyMatchNotice && (
                <p className="text-xs leading-5 tracking-[-0.12px] text-[#7a7a7a]">{vocabularyMatchNotice}</p>
              )}

              <section className="hidden border-t border-[#e0e0e0] pt-5 lg:block">
                <h3 className="text-sm font-semibold tracking-[-0.224px] text-[#1d1d1f]">向 AI 追问这句</h3>
                <p className="mt-1 text-xs leading-5 tracking-[-0.12px] text-[#7a7a7a]">
                  当前问题会带上所划词和它所在的完整句子。
                </p>
                <form className="mt-3 space-y-3" onSubmit={handleAskSentenceQuestion}>
                  <ClearableField value={sentenceQuestion} onClear={() => setSentenceQuestion("")} label="清空追问内容" multiline>
                    <textarea
                      className="min-h-24 w-full resize-y rounded-[18px] border border-[#e0e0e0] px-3 py-2 text-sm leading-6 tracking-[-0.224px] text-[#1d1d1f] outline-none transition placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
                      value={sentenceQuestion}
                      onChange={(event) => setSentenceQuestion(event.target.value)}
                      onKeyDown={handleSentenceQuestionKeyDown}
                      placeholder="例如：为什么这里用 empowering？which 指代什么？这句怎么拆？"
                      maxLength={500}
                    />
                  </ClearableField>
                  <button
                    type="submit"
                    className="h-10 w-full rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7]"
                    disabled={askingSentenceQuestion || !sentenceQuestion.trim()}
                  >
                    {askingSentenceQuestion ? "正在回答..." : "提问"}
                  </button>
                </form>

                {sentenceQuestionError && (
                  <div className="mt-3 rounded-[18px] border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                    {sentenceQuestionError}
                  </div>
                )}

                {sentenceAnswer && (
                  <div className="mt-3 whitespace-pre-wrap rounded-[18px] border border-[#e0e0e0] bg-[#f5f5f7] p-3 text-sm leading-6 tracking-[-0.224px] text-[#333333]">
                    {sentenceAnswer}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {error && !loading && !displayStream && (
        <div className="rounded-[18px] border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0">{error}</p>
            {onRegenerate && selectedContext && (
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-300 bg-white text-base leading-none text-red-700 transition hover:bg-red-100 active:scale-95"
                onClick={onRegenerate}
                aria-label="重新生成解释和翻译"
                title="重新生成解释和翻译"
              >
                ↻
              </button>
            )}
          </div>
        </div>
      )}

      {explanation && !loading && !displayStream && (
        <div className="space-y-4 pb-5">
          <header>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">{explanation.word}</h2>
                <p className="mt-1 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                  原型：{originalFormLabel(explanation.lemma, explanation.word)}
                </p>
              </div>
              <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-xs font-medium text-[#333333]">
                {normalizeDifficultyLabel(explanation.difficulty)}
              </span>
            </div>
            {savedPhonetic && (
              <p className="mt-2 text-sm leading-5 tracking-[-0.224px] text-[#555555]">
                <span className="font-medium text-[#7a7a7a]">当前词音标：</span>{savedPhonetic}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold tracking-[-0.224px] text-[#333333]">{normalizePartOfSpeechLabel(explanation.partOfSpeech)}</p>
              <PronunciationButtons text={explanation.word} preload />
              {onRegenerate && (
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#0066cc] text-base leading-none text-[#0066cc] transition hover:bg-[#f5f9ff] active:scale-95"
                  onClick={onRegenerate}
                  aria-label="重新生成解释和翻译"
                  title="重新生成解释和翻译"
                >
                  ↻
                </button>
              )}
            </div>
          </header>

          <dl className="space-y-3 text-sm leading-6 tracking-[-0.224px]">
            <div>
              <dt className="font-semibold text-[#1d1d1f]">基础释义</dt>
              <dd className="mt-0.5 text-[#333333]">{explanation.basicMeaning}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">{meaningLabel(selectedKind)}</dt>
              <dd className="mt-0.5 text-[#333333]">{explanation.contextMeaning}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">当前句子翻译</dt>
              <dd className="mt-0.5 text-[#333333]">{explanation.sentenceTranslation}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">用法说明</dt>
              <dd className="mt-0.5 text-[#333333]">{explanation.usageNote}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">常见搭配</dt>
              <dd className="mt-0.5 text-[#333333]">{explanation.collocation || "无"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">英文例句</dt>
              <dd className="mt-0.5 text-[#333333]">{explanation.exampleEnglish}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">例句中文翻译</dt>
              <dd className="mt-0.5 text-[#333333]">{explanation.exampleChinese}</dd>
            </div>
          </dl>

          {showLearningActions && <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 min-w-[112px] shrink-0 whitespace-nowrap rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7]"
              onClick={onAddToVocabulary}
              disabled={isInVocabulary}
            >
              {isInVocabulary ? "已加入生词本" : "加入生词本"}
            </button>
            <button
              type="button"
              className="h-10 min-w-[92px] shrink-0 whitespace-nowrap rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
              onClick={handleCopy}
            >
              复制解释
            </button>
          </div>}
          {showLearningActions && vocabularyMatchNotice && (
            <p className="text-xs leading-5 tracking-[-0.12px] text-[#7a7a7a]">{vocabularyMatchNotice}</p>
          )}

          <section className="hidden border-t border-[#e0e0e0] pt-5 lg:block">
            <h3 className="text-sm font-semibold tracking-[-0.224px] text-[#1d1d1f]">向 AI 追问这句话</h3>
            <p className="mt-1 text-xs leading-5 tracking-[-0.12px] text-[#7a7a7a]">
              当前问题会带上所划词和它所在的完整句子。
            </p>
            <form className="mt-3 space-y-3" onSubmit={handleAskSentenceQuestion}>
              <ClearableField value={sentenceQuestion} onClear={() => setSentenceQuestion("")} label="清空追问内容" multiline>
                <textarea
                  className="min-h-24 w-full resize-y rounded-[18px] border border-[#e0e0e0] px-3 py-2 text-sm leading-6 tracking-[-0.224px] text-[#1d1d1f] outline-none transition placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
                  value={sentenceQuestion}
                  onChange={(event) => setSentenceQuestion(event.target.value)}
                  onKeyDown={handleSentenceQuestionKeyDown}
                  placeholder="例如：为什么这里用 empowering？which 指代什么？这句怎么拆？"
                  maxLength={500}
                />
              </ClearableField>
              <button
                type="submit"
                className="h-10 w-full rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7]"
                disabled={askingSentenceQuestion || !sentenceQuestion.trim()}
              >
                {askingSentenceQuestion ? "正在回答..." : "提问"}
              </button>
            </form>

            {sentenceQuestionError && (
              <div className="mt-3 rounded-[18px] border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                {sentenceQuestionError}
              </div>
            )}

            {sentenceAnswer && (
              <div className="mt-3 whitespace-pre-wrap rounded-[18px] border border-[#e0e0e0] bg-[#f5f5f7] p-3 text-sm leading-6 tracking-[-0.224px] text-[#333333]">
                {sentenceAnswer}
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
