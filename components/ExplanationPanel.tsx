"use client";

import { useEffect, useState } from "react";
import type { WordContext, WordExplanation } from "@/types/reader";

interface ExplanationPanelProps {
  explanation: WordExplanation | null;
  selectedContext: WordContext | null;
  loading: boolean;
  error: string;
  isInVocabulary: boolean;
  onAddToVocabulary: () => void;
  onCollapse?: () => void;
}

function buildExplanationText(explanation: WordExplanation, context: WordContext | null): string {
  return [
    `${explanation.word} (${explanation.lemma})`,
    explanation.phonetic ? `音标：${explanation.phonetic}` : "",
    `词性：${explanation.partOfSpeech}`,
    `基础释义：${explanation.basicMeaning}`,
    `语境含义：${explanation.contextMeaning}`,
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

export function ExplanationPanel({
  explanation,
  selectedContext,
  loading,
  error,
  isInVocabulary,
  onAddToVocabulary,
  onCollapse,
}: ExplanationPanelProps) {
  const [sentenceQuestion, setSentenceQuestion] = useState("");
  const [sentenceAnswer, setSentenceAnswer] = useState("");
  const [sentenceQuestionError, setSentenceQuestionError] = useState("");
  const [askingSentenceQuestion, setAskingSentenceQuestion] = useState(false);

  useEffect(() => {
    setSentenceQuestion("");
    setSentenceAnswer("");
    setSentenceQuestionError("");
    setAskingSentenceQuestion(false);
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
      const response = await fetch("/api/ask-sentence", {
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
      });
      const data = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string }
        | null;

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

  return (
    <aside className="h-full min-h-0 flex-1 overflow-y-auto rounded-md border border-gray-200 bg-white p-5 shadow-sm overscroll-contain [-webkit-overflow-scrolling:touch] lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:w-[360px]">
      <div className="mb-3 flex justify-end lg:hidden">
        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700"
          onClick={onCollapse}
        >
          收起翻译
        </button>
      </div>

      {!selectedContext && !loading && !explanation && (
        <p className="text-sm leading-6 text-gray-500">点击文章中的任意英文单词查看语境解释。</p>
      )}

      {loading && <p className="text-sm leading-6 text-gray-600">正在分析语境...</p>}

      {error && !loading && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {explanation && !loading && (
        <div className="space-y-5 pb-6">
          <header>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-3xl font-semibold text-gray-950">{explanation.word}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  lemma: {explanation.lemma}
                  {explanation.phonetic ? ` · ${explanation.phonetic}` : ""}
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                {explanation.difficulty}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium text-gray-700">{explanation.partOfSpeech}</p>
          </header>

          <dl className="space-y-4 text-sm leading-6">
            <div>
              <dt className="font-semibold text-gray-900">基础释义</dt>
              {explanation.phonetic && (
                <dd className="mt-1 text-gray-500">音标：{explanation.phonetic}</dd>
              )}
              <dd className="mt-1 text-gray-700">{explanation.basicMeaning}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">当前语境含义</dt>
              <dd className="mt-1 text-gray-700">{explanation.contextMeaning}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">当前句子翻译</dt>
              <dd className="mt-1 text-gray-700">{explanation.sentenceTranslation}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">用法说明</dt>
              <dd className="mt-1 text-gray-700">{explanation.usageNote}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">常见搭配</dt>
              <dd className="mt-1 text-gray-700">{explanation.collocation || "无"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">英文例句</dt>
              <dd className="mt-1 text-gray-700">{explanation.exampleEnglish}</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">例句中文翻译</dt>
              <dd className="mt-1 text-gray-700">{explanation.exampleChinese}</dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="rounded-md bg-gray-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              onClick={onAddToVocabulary}
              disabled={isInVocabulary}
            >
              {isInVocabulary ? "已加入生词本" : "加入生词本"}
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50"
              onClick={handleCopy}
            >
              复制解释
            </button>
          </div>

          <section className="hidden border-t border-gray-200 pt-5 lg:block">
            <h3 className="text-sm font-semibold text-gray-900">向 AI 追问这句话</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              当前问题会带上所划词和它所在的完整句子。
            </p>
            <form className="mt-3 space-y-3" onSubmit={handleAskSentenceQuestion}>
              <textarea
                className="min-h-24 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-200"
                value={sentenceQuestion}
                onChange={(event) => setSentenceQuestion(event.target.value)}
                placeholder="例如：这个句子的主干是什么？这里的 which 指代什么？"
                maxLength={500}
              />
              <button
                type="submit"
                className="w-full rounded-md bg-gray-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                disabled={askingSentenceQuestion || !sentenceQuestion.trim()}
              >
                {askingSentenceQuestion ? "正在回答..." : "提问"}
              </button>
            </form>

            {sentenceQuestionError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
                {sentenceQuestionError}
              </div>
            )}

            {sentenceAnswer && (
              <div className="mt-3 whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm leading-6 text-gray-800">
                {sentenceAnswer}
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
