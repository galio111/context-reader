import type { AnkiCardMode } from "@/types/anki";
import type { VocabularyEntry } from "@/types/vocabulary";
import { standaloneVocabularyPresentation } from "@/lib/vocabularyPresentation";
import { currentFormPhonetic } from "@/lib/pronunciation";

export const DEFAULT_ANKI_ENDPOINT = "http://127.0.0.1:8765";
export const DEFAULT_ANKI_DECK = "long term run";
export const CLOZE_MODEL_NAME = "Context Reader Cloze Context";
export const BASIC_MODEL_NAME = "Context Reader Basic CN-EN";
export const EN_TO_CN_MODEL_NAME = "Context Reader Basic EN-CN";
export const CN_TO_EN_DICTIONARY_MODEL_NAME = "Context Reader Dictionary CN-EN";

export const clozeFields = [
  "ContextReaderId",
  "Word",
  "Lemma",
  "Phonetic",
  "PartOfSpeech",
  "ClozeSentence",
  "ContextCue",
  "BasicMeaning",
  "ContextMeaning",
  "SourceSentence",
  "SentenceTranslation",
  "UsageNote",
  "Collocation",
  "ExampleEnglish",
  "ExampleChinese",
  "Difficulty",
  "CreatedAt",
  "AudioUS",
  "AudioUK",
] as const;

export const basicFields = [
  "ContextReaderId",
  "Word",
  "Lemma",
  "Phonetic",
  "PartOfSpeech",
  "BasicCue",
  "BasicMeaning",
  "ContextMeaning",
  "SourceSentence",
  "SentenceTranslation",
  "UsageNote",
  "Collocation",
  "ExampleEnglish",
  "ExampleChinese",
  "Difficulty",
  "CreatedAt",
  "AudioUS",
  "AudioUK",
] as const;

export const cardCss = `
.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif;
  font-size: 21px;
  line-height: 1.65;
  color: #111827;
  background: #ffffff;
  text-align: left;
  padding: 8px;
}
.sentence {
  color: #0f172a;
  font-size: 26px;
  font-weight: 700;
}
.context-cue,
.basic-cue {
  color: #1d4ed8;
  font-size: 24px;
  font-weight: 700;
}
.prompt {
  color: #374151;
  font-size: 20px;
  margin-bottom: 16px;
}
.word {
  color: #0f172a;
  font-size: 34px;
  font-weight: 800;
}
.meta {
  color: #475569;
  font-size: 18px;
  margin-top: 4px;
}
.meta-row {
  margin-top: 4px;
  color: #475569;
  font-size: 18px;
}
.meta-label {
  color: #64748b;
  font-weight: 700;
}
.audio-row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
  color: #475569;
  font-size: 17px;
}
.audio-label {
  font-weight: 700;
  color: #334155;
}
.study-section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid #d7e0e6;
}
.study-section h3 {
  margin: 0 0 8px;
  color: #25495d;
  font-size: 16px;
}
.study-section ul,
.meaning-list {
  margin: 0;
  padding-left: 1.2em;
}
.study-section li,
.meaning-list li {
  margin: 6px 0;
}
.study-section.mistake {
  padding: 14px 16px;
  border: 0;
  border-radius: 10px;
  background: #f7ece9;
}
.study-section.mistake h3 {
  color: #813f34;
}
.example-block {
  padding: 12px 14px;
  border-radius: 10px;
  background: #eef3f6;
}
.example-english {
  font-family: Georgia, "Times New Roman", serif;
  color: #243f50;
}
.example-chinese {
  margin-top: 4px;
  color: #5d707b;
}
b {
  color: #111827;
}
hr {
  border: 0;
  border-top: 2px solid #cbd5e1;
  margin: 20px 0;
}
hr.front-gap {
  margin: 96px 0;
}
`;

const usTts = `{{tts en_US voices=Microsoft_Jenny,Microsoft_Aria,Microsoft_Zira,Microsoft_David,Apple_Samantha,Apple_Alex,Google_US_English:Word}}`;
const ukTts = `{{tts en_GB:Word}}`;
const usAudio = `{{#AudioUS}}{{AudioUS}}{{/AudioUS}}{{^AudioUS}}${usTts}{{/AudioUS}}`;
const ukAudio = `{{#AudioUK}}{{AudioUK}}{{/AudioUK}}{{^AudioUK}}${ukTts}{{/AudioUK}}`;

export const clozeFrontTemplate = `<div class="card">
  <div class="sentence">{{ClozeSentence}}</div>
  <hr class="front-gap">
  <div class="context-cue">{{ContextCue}}</div>
</div>`;

export const clozeBackTemplate = `<div class="card">
  <div class="word" data-context-reader-word>{{Word}}</div>

  <div class="meta"><span class="meta-label">原型：</span>{{Lemma}} · {{PartOfSpeech}}</div>
  {{#Phonetic}}<div class="meta-row"><span class="meta-label">当前词音标：</span>{{Phonetic}}</div>{{/Phonetic}}

  <div class="audio-row" aria-label="单词发音">
    <span class="audio-label">发音：</span>
    <span><span class="audio-label">美：</span>${usAudio}</span>
    <span><span class="audio-label">英：</span>${ukAudio}</span>
  </div>

  <hr>

  <div>
    <b>原句：</b><br>
    {{SourceSentence}}
  </div>

  <br>

  <div>
    <b>自然翻译：</b><br>
    {{SentenceTranslation}}
  </div>

  <br>

  <div>
    <b>所选词/短语在本句中的含义：</b><br>
    {{ContextMeaning}}
  </div>

  <br>

  <div>
    <b>基础释义：</b><br>
    {{BasicMeaning}}
  </div>

  <br>

  <div>
    <b>用法说明：</b><br>
    {{UsageNote}}
  </div>

  <br>

  <div>
    <b>常见搭配：</b><br>
    {{Collocation}}
  </div>

  <br>

  <div>
    <b>补充例句：</b><br>
    {{ExampleEnglish}}<br>
    {{ExampleChinese}}
  </div>
</div>`;

export const basicFrontTemplate = `<div class="card">
  <div class="prompt">请写出对应的英文单词：</div>
  <div class="basic-cue">{{BasicCue}}</div>
</div>`;

export const basicBackTemplate = `<div class="card">
  <div class="word" data-context-reader-word>{{Word}}</div>

  <div class="meta"><span class="meta-label">原型：</span>{{Lemma}} · {{PartOfSpeech}}</div>
  {{#Phonetic}}<div class="meta-row"><span class="meta-label">当前词音标：</span>{{Phonetic}}</div>{{/Phonetic}}

  <div class="audio-row" aria-label="单词发音">
    <span class="audio-label">发音：</span>
    <span><span class="audio-label">美：</span>${usAudio}</span>
    <span><span class="audio-label">英：</span>${ukAudio}</span>
  </div>

  <hr>

  <div>
    <b>基础释义：</b><br>
    {{BasicMeaning}}
  </div>

  <br>

  <div>
    <b>所选词/短语在本句中的含义：</b><br>
    {{ContextMeaning}}
  </div>

  <br>

  <div>
    <b>原句：</b><br>
    {{SourceSentence}}
  </div>

  <br>

  <div>
    <b>自然翻译：</b><br>
    {{SentenceTranslation}}
  </div>

  <br>

  <div>
    <b>用法说明：</b><br>
    {{UsageNote}}
  </div>

  <br>

  <div>
    <b>常见搭配：</b><br>
    {{Collocation}}
  </div>

  <br>

  <div>
    <b>补充例句：</b><br>
    {{ExampleEnglish}}<br>
    {{ExampleChinese}}
  </div>
</div>`;

export const englishToChineseFrontTemplate = `<div class="card">
  <div class="word">{{Word}}</div>
</div>`;

export const englishToChineseBackTemplate = `<div class="card">
  <div class="word" data-context-reader-word>{{Word}}</div>
  <div class="meta"><span class="meta-label">原型：</span>{{Lemma}} · {{PartOfSpeech}}</div>
  {{#Phonetic}}<div class="meta-row"><span class="meta-label">当前词音标：</span>{{Phonetic}}</div>{{/Phonetic}}

  <div class="audio-row" aria-label="单词发音">
    <span class="audio-label">发音：</span>
    <span><span class="audio-label">美：</span>${usAudio}</span>
    <span><span class="audio-label">英：</span>${ukAudio}</span>
  </div>

  <hr>

  <section>
    <b>中文核心释义</b>
    {{BasicMeaning}}
  </section>

  {{UsageNote}}

  {{#Collocation}}
  <section class="study-section">
    <h3>常见搭配</h3>
    {{Collocation}}
  </section>
  {{/Collocation}}

  {{#ExampleEnglish}}
  <section class="study-section">
    <h3>例句</h3>
    <div class="example-block">
      <div class="example-english">{{ExampleEnglish}}</div>
      <div class="example-chinese">{{ExampleChinese}}</div>
    </div>
  </section>
  {{/ExampleEnglish}}
</div>`;

export const chineseToEnglishDictionaryFrontTemplate = `<div class="card">
  <div class="prompt">请写出自然的英文表达：</div>
  <div class="basic-cue">{{BasicCue}}</div>
</div>`;

export const chineseToEnglishDictionaryBackTemplate = `<div class="card">
  <div class="word" data-context-reader-word>{{Word}}</div>
  <div class="meta"><span class="meta-label">英文表达：</span>{{Lemma}} · {{PartOfSpeech}}</div>
  {{#Phonetic}}<div class="meta-row"><span class="meta-label">该表达音标：</span>{{Phonetic}}</div>{{/Phonetic}}

  <div class="audio-row" aria-label="英文发音">
    <span class="audio-label">发音：</span>
    <span><span class="audio-label">美：</span>${usAudio}</span>
    <span><span class="audio-label">英：</span>${ukAudio}</span>
  </div>

  <hr>

  <section>
    <b>常用英文表达</b>
    {{BasicMeaning}}
  </section>

  {{UsageNote}}

  {{#Collocation}}
  <section class="study-section">
    <h3>常见搭配</h3>
    {{Collocation}}
  </section>
  {{/Collocation}}

  {{#ExampleEnglish}}
  <section class="study-section">
    <h3>例句</h3>
    <div class="example-block">
      <div class="example-english">{{ExampleEnglish}}</div>
      <div class="example-chinese">{{ExampleChinese}}</div>
    </div>
  </section>
  {{/ExampleEnglish}}
</div>`;

export function modelNameForMode(mode: AnkiCardMode): string {
  if (mode === "cloze_context") return CLOZE_MODEL_NAME;
  if (mode === "basic_cn_to_en_dictionary") return CN_TO_EN_DICTIONARY_MODEL_NAME;
  return mode === "basic_en_to_cn" ? EN_TO_CN_MODEL_NAME : BASIC_MODEL_NAME;
}

export function fieldsForEntry(entry: VocabularyEntry): Record<string, string> {
  const common = {
    ContextReaderId: entry.id,
    Word: entry.word,
    Lemma: entry.lemma,
    Phonetic: currentFormPhonetic(entry),
    PartOfSpeech: entry.partOfSpeech,
    BasicMeaning: entry.basicMeaning,
    ContextMeaning: entry.contextMeaning,
    SourceSentence: entry.sourceSentence,
    SentenceTranslation: entry.sentenceTranslation,
    UsageNote: entry.usageNote,
    Collocation: entry.collocation,
    ExampleEnglish: entry.exampleEnglish,
    ExampleChinese: entry.exampleChinese,
    Difficulty: entry.difficulty,
    CreatedAt: entry.createdAt,
    AudioUS: "",
    AudioUK: "",
  };

  if (entry.anki.cardMode === "cloze_context") {
    return {
      ...common,
      ClozeSentence: entry.anki.clozeSentence,
      ContextCue: entry.anki.contextCue,
    };
  }

  if (
    entry.anki.cardMode === "basic_en_to_cn"
    || entry.anki.cardMode === "basic_cn_to_en_dictionary"
  ) {
    const presentation = standaloneVocabularyPresentation(entry);
    const list = (values: string[]) => values.length
      ? `<ul>${values.map((value) => `<li>${escapeAnkiHtml(value)}</li>`).join("")}</ul>`
      : "";
    const section = (label: string, values: string[], className = "") => values.length
      ? `<section class="study-section${className ? ` ${className}` : ""}"><h3>${label}</h3>${list(values)}</section>`
      : "";
    return {
      ...common,
      BasicCue: entry.anki.basicCue,
      BasicMeaning: list(entry.basicMeaning.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)),
      UsageNote: [
        section("用法提示", presentation.usagePoints),
        section("近义词辨析", presentation.synonymPoints),
        section("词族", presentation.wordFamilyPoints),
        section("易错点", presentation.mistakePoints, "mistake"),
        section("记忆提示", presentation.memoryPoints),
      ].filter(Boolean).join(""),
      Collocation: list(presentation.collocationPoints),
      ExampleEnglish: escapeAnkiHtml(entry.exampleEnglish),
      ExampleChinese: escapeAnkiHtml(entry.exampleChinese),
    };
  }

  return {
    ...common,
    BasicCue: entry.anki.basicCue || entry.basicMeaning,
  };
}

function escapeAnkiHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function modelDefinition(mode: AnkiCardMode) {
  if (mode === "cloze_context") {
    return {
      modelName: CLOZE_MODEL_NAME,
      inOrderFields: [...clozeFields],
      css: cardCss,
      cardTemplates: [
        {
          Name: "Cloze Context",
          Front: clozeFrontTemplate,
          Back: clozeBackTemplate,
        },
      ],
    };
  }

  if (mode === "basic_en_to_cn") {
    return {
      modelName: EN_TO_CN_MODEL_NAME,
      inOrderFields: [...basicFields],
      css: cardCss,
      cardTemplates: [
        {
          Name: "Basic EN-CN",
          Front: englishToChineseFrontTemplate,
          Back: englishToChineseBackTemplate,
        },
      ],
    };
  }

  if (mode === "basic_cn_to_en_dictionary") {
    return {
      modelName: CN_TO_EN_DICTIONARY_MODEL_NAME,
      inOrderFields: [...basicFields],
      css: cardCss,
      cardTemplates: [
        {
          Name: "Dictionary CN-EN",
          Front: chineseToEnglishDictionaryFrontTemplate,
          Back: chineseToEnglishDictionaryBackTemplate,
        },
      ],
    };
  }

  return {
    modelName: BASIC_MODEL_NAME,
    inOrderFields: [...basicFields],
    css: cardCss,
    cardTemplates: [
      {
        Name: "Basic CN-EN",
        Front: basicFrontTemplate,
        Back: basicBackTemplate,
      },
    ],
  };
}
