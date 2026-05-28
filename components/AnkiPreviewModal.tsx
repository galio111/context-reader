"use client";

import type { VocabularyEntry } from "@/types/vocabulary";

interface AnkiPreviewModalProps {
  entry: VocabularyEntry | null;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-gray-950">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-gray-800">{value || "无"}</dd>
    </div>
  );
}

export function AnkiPreviewModal({ entry, onClose }: AnkiPreviewModalProps) {
  if (!entry) {
    return null;
  }

  const isCloze = entry.anki.cardMode === "cloze_context";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 px-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-950">Anki 卡片预览</h2>
            <p className="mt-1 text-sm text-gray-600">
              {isCloze ? "语境挖空卡" : "基础释义中译英卡"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <section className="rounded-md border border-gray-200 bg-slate-50 p-4">
            <h3 className="mb-4 text-sm font-semibold text-gray-700">正面</h3>
            {isCloze ? (
              <div className="space-y-4">
                <p className="text-xl font-bold leading-8 text-slate-950">
                  {entry.anki.clozeSentence}
                </p>
                <hr className="border-slate-300" />
                <p className="text-lg font-semibold leading-7 text-blue-700">
                  {entry.anki.contextCue}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-base font-medium text-gray-700">请写出对应的英文单词：</p>
                <p className="text-xl font-bold leading-8 text-blue-700">
                  {entry.anki.basicCue || entry.basicMeaning}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-md border border-gray-200 bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold text-gray-700">背面</h3>
            <div className="mb-4">
              <p className="text-2xl font-bold text-slate-950">{entry.word}</p>
              <p className="mt-1 text-sm text-gray-600">
                {entry.lemma} · {entry.phonetic} · {entry.partOfSpeech}
              </p>
            </div>
            <dl className="space-y-3 text-sm leading-6">
              {isCloze ? (
                <>
                  <Field label="原句" value={entry.sourceSentence} />
                  <Field label="自然翻译" value={entry.sentenceTranslation} />
                  <Field label="语境含义" value={entry.contextMeaning} />
                  <Field label="基础释义" value={entry.basicMeaning} />
                </>
              ) : (
                <>
                  <Field label="基础释义" value={entry.basicMeaning} />
                  <Field label="当前语境含义" value={entry.contextMeaning} />
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
