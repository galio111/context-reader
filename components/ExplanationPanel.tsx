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

type PronunciationAccent = "en-US" | "en-GB";

interface PronunciationButtonsProps {
  text: string;
}

function pickVoice(voices: SpeechSynthesisVoice[], accent: PronunciationAccent): SpeechSynthesisVoice | undefined {
  return (
    voices.find((voice) => voice.lang === accent) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(accent.toLowerCase())) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en"))
  );
}

function PronunciationButtons({ text }: PronunciationButtonsProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supportsSpeech, setSupportsSpeech] = useState(false);

  useEffect(() => {
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance === "undefined") {
      return;
    }

    setSupportsSpeech(true);

    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      window.speechSynthesis.cancel();
    };
  }, []);

  function playPronunciation(accent: PronunciationAccent) {
    const spokenText = text.trim();
    if (!supportsSpeech || !spokenText) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = accent;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.voice = pickVoice(voices, accent) ?? null;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  if (!supportsSpeech) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5" aria-label="单词发音">
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-full border border-[#d2d2d7] bg-white px-2.5 text-xs font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
        onClick={() => playPronunciation("en-US")}
        aria-label={`播放 ${text} 的美式发音`}
        title="美式发音"
      >
        <span aria-hidden="true">▶</span>
        <span>美</span>
      </button>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1 rounded-full border border-[#d2d2d7] bg-white px-2.5 text-xs font-medium text-[#1d1d1f] transition hover:border-[#0066cc] hover:text-[#0066cc] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
        onClick={() => playPronunciation("en-GB")}
        aria-label={`播放 ${text} 的英式发音`}
        title="英式发音"
      >
        <span aria-hidden="true">▶</span>
        <span>英</span>
      </button>
    </div>
  );
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
    <aside className="relative h-full min-h-0 flex-1 overflow-y-auto rounded-[18px] border border-[#e0e0e0] bg-white p-5 overscroll-contain [-webkit-overflow-scrolling:touch] lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:w-[360px]">
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

      {loading && <p className="text-sm leading-6 tracking-[-0.224px] text-[#333333]">正在分析语境...</p>}

      {error && !loading && (
        <div className="rounded-[18px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {explanation && !loading && (
        <div className="space-y-5 pb-6">
          <header>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">{explanation.word}</h2>
                <p className="mt-1 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
                  lemma: {explanation.lemma}
                  {explanation.phonetic ? ` · ${explanation.phonetic}` : ""}
                </p>
              </div>
              <span className="rounded-full bg-[#f5f5f7] px-3 py-1 text-xs font-medium text-[#333333]">
                {explanation.difficulty}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold tracking-[-0.224px] text-[#333333]">{explanation.partOfSpeech}</p>
              <PronunciationButtons text={explanation.word} />
            </div>
          </header>

          <dl className="space-y-4 text-sm leading-6 tracking-[-0.224px]">
            <div>
              <dt className="font-semibold text-[#1d1d1f]">基础释义</dt>
              {explanation.phonetic && (
                <dd className="mt-1 text-[#7a7a7a]">音标：{explanation.phonetic}</dd>
              )}
              <dd className="mt-1 text-[#333333]">{explanation.basicMeaning}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">当前语境含义</dt>
              <dd className="mt-1 text-[#333333]">{explanation.contextMeaning}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">当前句子翻译</dt>
              <dd className="mt-1 text-[#333333]">{explanation.sentenceTranslation}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">用法说明</dt>
              <dd className="mt-1 text-[#333333]">{explanation.usageNote}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">常见搭配</dt>
              <dd className="mt-1 text-[#333333]">{explanation.collocation || "无"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">英文例句</dt>
              <dd className="mt-1 text-[#333333]">{explanation.exampleEnglish}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#1d1d1f]">例句中文翻译</dt>
              <dd className="mt-1 text-[#333333]">{explanation.exampleChinese}</dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="h-10 rounded-full bg-[#0066cc] px-4 text-sm tracking-[-0.224px] text-white transition active:scale-95 disabled:bg-[#d2d2d7]"
              onClick={onAddToVocabulary}
              disabled={isInVocabulary}
            >
              {isInVocabulary ? "已加入生词本" : "加入生词本"}
            </button>
            <button
              type="button"
              className="h-10 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
              onClick={handleCopy}
            >
              复制解释
            </button>
          </div>

          <section className="hidden border-t border-[#e0e0e0] pt-5 lg:block">
            <h3 className="text-sm font-semibold tracking-[-0.224px] text-[#1d1d1f]">向 AI 追问这句话</h3>
            <p className="mt-1 text-xs leading-5 tracking-[-0.12px] text-[#7a7a7a]">
              当前问题会带上所划词和它所在的完整句子。
            </p>
            <form className="mt-3 space-y-3" onSubmit={handleAskSentenceQuestion}>
              <textarea
                className="min-h-24 w-full resize-y rounded-[18px] border border-[#e0e0e0] px-3 py-2 text-sm leading-6 tracking-[-0.224px] text-[#1d1d1f] outline-none transition placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:ring-2 focus:ring-[#0071e3]/20"
                value={sentenceQuestion}
                onChange={(event) => setSentenceQuestion(event.target.value)}
                placeholder="例如：这个句子的主干是什么？这里的 which 指代什么？"
                maxLength={500}
              />
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
