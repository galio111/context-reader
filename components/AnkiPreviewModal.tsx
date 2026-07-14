"use client";

import { normalizePartOfSpeechLabel, originalFormLabel } from "@/lib/displayLabels";
import type { VocabularyEntry } from "@/types/vocabulary";

interface AnkiPreviewModalProps {
  entry: VocabularyEntry | null;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-[#1d1d1f]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-[#333333]">{value || "无"}</dd>
    </div>
  );
}

function selectedTextKind(value: string): "word" | "phrase" {
  return value.trim().split(/\s+/).filter(Boolean).length > 1 ? "phrase" : "word";
}

function meaningLabel(value: string): string {
  return selectedTextKind(value) === "phrase" ? "所选短语在本句中的含义" : "所选词在本句中的含义";
}

export function AnkiPreviewModal({ entry, onClose }: AnkiPreviewModalProps) {
  if (!entry) {
    return null;
  }

  const isCloze = entry.anki.cardMode === "cloze_context";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[18px] bg-white">
        <header className="flex items-center justify-between border-b border-[#e0e0e0] px-5 py-4">
          <div>
            <h2 className="text-[21px] font-semibold leading-[1.19] tracking-[0.231px] text-[#1d1d1f]">Anki 卡片预览</h2>
            <p className="mt-1 text-sm leading-5 tracking-[-0.224px] text-[#7a7a7a]">
              {isCloze ? "语境挖空卡" : "基础释义中译英卡"}
            </p>
          </div>
          <button
            type="button"
            className="h-10 rounded-full border border-[#0066cc] px-4 text-sm tracking-[-0.224px] text-[#0066cc] transition active:scale-95"
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <section className="rounded-[18px] border border-[#e0e0e0] bg-[#f5f5f7] p-4">
            <h3 className="mb-4 text-sm font-semibold tracking-[-0.224px] text-[#333333]">正面</h3>
            {isCloze ? (
              <div className="space-y-4">
                <p className="text-xl font-semibold leading-8 text-[#1d1d1f]">
                  {entry.anki.clozeSentence}
                </p>
                <hr className="border-[#e0e0e0]" />
                <p className="text-lg font-semibold leading-7 text-[#0066cc]">
                  {entry.anki.contextCue}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-base text-[#333333]">请写出对应的英文单词：</p>
                <p className="text-xl font-semibold leading-8 text-[#0066cc]">
                  {entry.anki.basicCue || entry.basicMeaning}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-[18px] border border-[#e0e0e0] bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold tracking-[-0.224px] text-[#333333]">背面</h3>
            <div className="mb-4">
              <p className="text-2xl font-semibold text-[#1d1d1f]">{entry.word}</p>
              <p className="mt-1 text-sm text-[#7a7a7a]">
                {originalFormLabel(entry.lemma, entry.word)} · {normalizePartOfSpeechLabel(entry.partOfSpeech)}
                {entry.phonetic ? ` · ${entry.phonetic}` : ""}
              </p>
              <p className="mt-2 text-sm text-[#333333]">Anki 背面会显示美式 / 英式发音按钮。</p>
            </div>
            <dl className="space-y-3 text-sm leading-6">
              {isCloze ? (
                <>
                  <Field label="原句" value={entry.sourceSentence} />
                  <Field label="自然翻译" value={entry.sentenceTranslation} />
                  <Field label={meaningLabel(entry.word)} value={entry.contextMeaning} />
                  <Field label="基础释义" value={entry.basicMeaning} />
                </>
              ) : (
                <>
                  <Field label="基础释义" value={entry.basicMeaning} />
                  <Field label={meaningLabel(entry.word)} value={entry.contextMeaning} />
                  <Field label="原句" value={entry.sourceSentence} />
                  <Field label="自然翻译" value={entry.sentenceTranslation} />
                </>
              )}
              <Field label="用法说明" value={entry.usageNote} />
              <Field label="常见搭配" value={entry.collocation} />
              <Field
                label="补充例句"
                value={[entry.exampleEnglish, entry.exampleChinese].filter(Boolean).join("\n")}
              />
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
